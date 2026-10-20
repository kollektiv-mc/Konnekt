package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"konnekt/backend/services"
)

// `konnekt mcp` (#511): the stdio bridge between a local MCP client and the
// running app. Phase A of #507: no network exposure and no OAuth, because the
// client is on the same machine as the app and the app's loopback endpoint is
// keyed by a secret only this user can read (§ S9.4).
//
// The bridge answers tools/list itself, from the catalog compiled into this
// binary, so `claude mcp add` works with Konnekt closed. Each call is
// forwarded to the endpoint named in mcp-local.json; with none, or with the
// app gone, the call comes back as a plain error that says so. The bridge
// never launches the GUI.

const mcpBridgeDial = 5 * time.Second

// runMCPBridge serves MCP over t until the client hangs up or ctx ends. It
// reads mcp-local.json under dataDir to find the app. Logging is the caller's
// to set up: main points it at stderr, the tests capture it.
func runMCPBridge(ctx context.Context, dataDir string, t mcp.Transport) error {
	up := &mcpUpstream{dataDir: dataDir}
	defer up.close()
	server, err := services.NewMCPBridgeServer(mcpTools, Version, mcpInstructions, up.call)
	if err != nil {
		return err
	}
	return server.Run(ctx, t)
}

// mcpUpstream is the bridge's one session with the app, opened on the first
// call and reopened when a call finds it gone: the app may be started, quit
// and started again while a Claude Code session lives.
type mcpUpstream struct {
	dataDir string

	mu      sync.Mutex
	session *mcp.ClientSession
}

func (u *mcpUpstream) call(ctx context.Context, client *mcp.Implementation, name string, args any) (*mcp.CallToolResult, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	params := &mcp.CallToolParams{Name: name, Arguments: args}
	if u.session != nil {
		res, err := u.session.CallTool(ctx, params)
		if err == nil {
			return res, nil
		}
		u.dropLocked()
		if !callNeverSent(err) {
			// A timeout or a connection lost mid-call can follow the app
			// running the tool, and these tools restart servers and ban
			// players: sending it again could do that twice (#621).
			return nil, fmt.Errorf("Konnekt did not answer, so the call was not sent again; it may have run: %w", err)
		}
		// The app restarted or was switched off, and never saw the call.
		// Connect once more before giving up.
	}
	if err := u.connectLocked(ctx, client); err != nil {
		return nil, err
	}
	res, err := u.session.CallTool(ctx, params)
	if err != nil {
		u.dropLocked()
		return nil, fmt.Errorf("Konnekt did not answer: %w", err)
	}
	return res, nil
}

// callNeverSent reports whether err proves the app never received the call,
// the one case in which sending it again cannot run a tool twice. The app's
// endpoint answers 404 for a session it does not know before it dispatches
// anything, which the SDK reports as ErrSessionMissing, and a dial that
// found nothing listening never sent a byte: the app quit, or came back on
// another port.
func callNeverSent(err error) bool {
	if errors.Is(err, mcp.ErrSessionMissing) {
		return true
	}
	var op *net.OpError
	return errors.As(err, &op) && op.Op == "dial"
}

// connectLocked reads the endpoint and opens a session, introducing the
// bridge to the app as the client that introduced itself to the bridge, so
// the app's log line names Claude's client and not "konnekt mcp".
func (u *mcpUpstream) connectLocked(ctx context.Context, client *mcp.Implementation) error {
	endpoint, secret, err := services.LocalMCPEndpoint(u.dataDir)
	if err != nil {
		return err
	}
	if client == nil || client.Name == "" {
		client = &mcp.Implementation{Name: "unknown", Version: "0"}
	}
	transport := &mcp.StreamableClientTransport{
		Endpoint:             endpoint,
		HTTPClient:           &http.Client{Transport: bearerTransport{secret: secret}, Timeout: 0},
		DisableStandaloneSSE: true,
		MaxRetries:           -1,
	}
	dialCtx, cancel := context.WithTimeout(ctx, mcpBridgeDial)
	defer cancel()
	session, err := mcp.NewClient(&mcp.Implementation{Name: client.Name, Version: client.Version}, nil).Connect(dialCtx, transport, nil)
	if err != nil {
		// A port in the file and nothing on it is an app that quit without
		// its close hook running (a crash, a kill): the same answer as off.
		return fmt.Errorf("%w (%v)", services.ErrLocalMCPOff, errors.Unwrap(err))
	}
	u.session = session
	return nil
}

func (u *mcpUpstream) dropLocked() {
	if u.session != nil {
		if err := u.session.Close(); err != nil {
			slog.Debug("mcp bridge: close session", "error", err)
		}
		u.session = nil
	}
}

func (u *mcpUpstream) close() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.dropLocked()
}

// bearerTransport puts the endpoint's secret on every request. The client is
// built for one loopback endpoint and nothing else, so the header goes on
// every request it makes.
type bearerTransport struct {
	secret string
}

func (b bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.secret)
	return http.DefaultTransport.RoundTrip(r)
}

// mcpBridgeCommand is what a client registers: this executable, then "mcp".
// Settings shows it (#515) beside the `claude mcp add` line.
func mcpBridgeCommand() string {
	return fmt.Sprintf("%q mcp", mcpBridgeExecutable())
}

// mcpBridgeExecutable is this executable's path, or "konnekt" when the OS
// will not say.
func mcpBridgeExecutable() string {
	exe, err := os.Executable()
	if err != nil {
		return "konnekt"
	}
	return exe
}
