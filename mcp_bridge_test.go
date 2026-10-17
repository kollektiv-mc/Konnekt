package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"konnekt/backend/services"
)

// `konnekt mcp` end to end (#511): the catalog with no app, a call through
// the real catalog over a local endpoint, and the bridge finding the app
// again after it stopped and started.

// startBridge runs the bridge over an in-memory transport and returns a
// client on it. The bridge ends with the test.
func startBridge(t *testing.T, dataDir string) *mcp.ClientSession {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	st, ct := mcp.NewInMemoryTransports()
	done := make(chan error, 1)
	go func() { done <- runMCPBridge(ctx, dataDir, st) }()
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "claude-code", Version: "2"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cs.Close(); err != nil {
			t.Error(err)
		}
		cancel()
		select {
		case err := <-done:
			if err != nil && !strings.Contains(err.Error(), "closed") && err != context.Canceled {
				t.Errorf("bridge ended: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Error("the bridge did not stop")
		}
	})
	return cs
}

func bridgeCall(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return res
}

func bridgeText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	var parts []string
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			parts = append(parts, tc.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// newLocalEndpoint runs the real catalog over the stub behind a
// LocalMCPService in dir, as the app does.
func newLocalEndpoint(t *testing.T, dir string, stub *mcpStubApp) *services.LocalMCPService {
	t.Helper()
	allow := map[string]services.RemoteMethod{}
	for _, tool := range mcpTools {
		allow[tool.Method] = remoteMethods[tool.Method]
	}
	dispatcher, err := services.NewRemoteDispatcher(stub, allow)
	if err != nil {
		t.Fatal(err)
	}
	server, err := services.NewMCPServer(dispatcher, mcpTools, Version,
		services.MCPServerOptions{Caller: services.LocalMCPCaller, Instructions: mcpInstructions})
	if err != nil {
		t.Fatal(err)
	}
	svc := services.NewLocalMCPService(server)
	svc.SetDataDir(dir)
	t.Cleanup(func() {
		if err := svc.Stop(); err != nil {
			t.Error(err)
		}
	})
	return svc
}

// With no app the bridge still lists every tool, so `claude mcp add` can be
// run with Konnekt closed, and a call says what is missing.
func TestMCPBridgeListsTheCatalogWithoutTheApp(t *testing.T) {
	cs := startBridge(t, t.TempDir())
	listed, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != len(mcpTools) {
		t.Errorf("%d tools, %d in the catalog", len(listed.Tools), len(mcpTools))
	}
	if got := cs.InitializeResult().Instructions; got != mcpInstructions {
		t.Errorf("instructions differ from the app's")
	}
	res := bridgeCall(t, cs, "list_servers", nil)
	if !res.IsError || !strings.Contains(bridgeText(t, res), "Konnekt is not running") {
		t.Errorf("call with no app: %+v", res)
	}
}

func TestMCPBridgeForwardsAndFindsTheAppAgain(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	dir := t.TempDir()
	stub := &mcpStubApp{}
	app := newLocalEndpoint(t, dir, stub)
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	cs := startBridge(t, dir)

	res := bridgeCall(t, cs, "list_servers", nil)
	if res.IsError {
		t.Fatalf("list_servers: %s", bridgeText(t, res))
	}
	var structured map[string]json.RawMessage
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &structured); err != nil || structured["servers"] == nil {
		t.Errorf("structured content %s", raw)
	}
	res = bridgeCall(t, cs, "server_status", map[string]any{"serverID": "srv-1"})
	if res.IsError {
		t.Fatalf("server_status: %s", bridgeText(t, res))
	}
	if !strings.Contains(buf.String(), `tool=server_status client=claude-code server=srv-1 ok=true`) {
		t.Errorf("the app's log does not name the real client:\n%s", buf.String())
	}

	// The app quits: the next call says so, through the session the bridge
	// still held.
	if err := app.Stop(); err != nil {
		t.Fatal(err)
	}
	res = bridgeCall(t, cs, "list_servers", nil)
	if !res.IsError || !strings.Contains(bridgeText(t, res), "Konnekt is not running") {
		t.Errorf("call after stop: %+v", res)
	}

	// The app comes back on another port with another secret: the same bridge
	// process finds it without being restarted.
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	res = bridgeCall(t, cs, "list_servers", nil)
	if res.IsError {
		t.Fatalf("call after restart: %s", bridgeText(t, res))
	}
}

// A port in the file and nothing listening on it (the app was killed) reads
// as the app being off, not as a transport error.
func TestMCPBridgeTreatsADeadPortAsOff(t *testing.T) {
	dir := t.TempDir()
	app := newLocalEndpoint(t, dir, &mcpStubApp{})
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	endpoint, _, err := services.LocalMCPEndpoint(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Stop(); err != nil {
		t.Fatal(err)
	}
	// Put the stale record back, as a crash would have left it.
	if err := services.WritePrivateDataFile(dir, "mcp-local.json",
		[]byte(`{"enabled":true,"port":`+endpoint[strings.LastIndex(endpoint, ":")+1:len(endpoint)-1]+`,"secret":"stale"}`)); err != nil {
		t.Fatal(err)
	}
	cs := startBridge(t, dir)
	res := bridgeCall(t, cs, "list_servers", nil)
	if !res.IsError || !strings.Contains(bridgeText(t, res), "Konnekt is not running") {
		t.Errorf("stale port: %+v", res)
	}
}

func TestMCPBridgeCommandQuotesTheExecutable(t *testing.T) {
	cmd := mcpBridgeCommand()
	if !strings.HasPrefix(cmd, `"`) || !strings.HasSuffix(cmd, `" mcp`) {
		t.Errorf("command %q", cmd)
	}
}
