package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The loopback endpoint the bridge calls (#511, § S9.4): the guard in front of
// it, the file that names it, and a real client through both.

type localMCPFixture struct {
	svc    *LocalMCPService
	target *remoteTarget
	dir    string
}

func newLocalMCPFixture(t *testing.T) *localMCPFixture {
	t.Helper()
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewMCPServer(d, mcpTestTools, "0.0.0-test", MCPServerOptions{Caller: LocalMCPCaller})
	if err != nil {
		t.Fatal(err)
	}
	f := &localMCPFixture{svc: NewLocalMCPService(server), target: target, dir: t.TempDir()}
	f.svc.SetDataDir(f.dir)
	t.Cleanup(func() {
		if err := f.svc.Stop(); err != nil {
			t.Errorf("stop: %v", err)
		}
	})
	return f
}

func (f *localMCPFixture) start(t *testing.T) {
	t.Helper()
	if err := f.svc.Start(); err != nil {
		t.Fatal(err)
	}
}

func (f *localMCPFixture) record(t *testing.T) localMCPRecord {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(f.dir, localMCPFile))
	if err != nil {
		t.Fatal(err)
	}
	var rec localMCPRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

// initializeBody is a request the MCP handler accepts, so a 200 means the
// guard let it through rather than the handler refusing the shape.
const initializeBody = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}`

// post sends an initialize to the live listener with the given Host,
// Authorization and Origin and returns the status.
func (f *localMCPFixture) post(t *testing.T, host, auth, origin string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "http://"+f.svc.Addr()+"/", strings.NewReader(initializeBody))
	if err != nil {
		t.Fatal(err)
	}
	req.Host = host
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := res.Body.Close(); err != nil {
			t.Error(err)
		}
	})
	return res
}

// bearerRoundTripper is the test's copy of what the bridge does: the secret
// on every request.
type bearerRoundTripper struct{ secret string }

func (b bearerRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.secret)
	return http.DefaultTransport.RoundTrip(r)
}

// Right secret in, wrong and missing out, and a browser (Origin) or a rebound
// name (Host) out whatever it carries.
func TestLocalMCPGuardChecksHostOriginAndSecret(t *testing.T) {
	f := newLocalMCPFixture(t)
	f.start(t)
	addr := f.svc.Addr()
	port := addr[strings.LastIndex(addr, ":")+1:]
	good := "Bearer " + f.record(t).Secret

	cases := map[string]struct {
		host, auth, origin string
		want               int
	}{
		"right secret":          {addr, good, "", http.StatusOK},
		"localhost host":        {"localhost:" + port, good, "", http.StatusOK},
		"wrong secret":          {addr, "Bearer " + strings.Repeat("x", 43), "", http.StatusUnauthorized},
		"no secret":             {addr, "", "", http.StatusUnauthorized},
		"basic auth":            {addr, "Basic abc", "", http.StatusUnauthorized},
		"origin with secret":    {addr, good, "http://127.0.0.1:" + port, http.StatusForbidden},
		"null origin":           {addr, good, "null", http.StatusForbidden},
		"foreign host":          {"konnekt.example:" + port, good, "", http.StatusForbidden},
		"foreign host no token": {"konnekt.example:" + port, "", "", http.StatusForbidden},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			res := f.post(t, tc.host, tc.auth, tc.origin)
			if res.StatusCode != tc.want {
				t.Fatalf("status %d, want %d", res.StatusCode, tc.want)
			}
			if tc.want == http.StatusUnauthorized && res.Header.Get("WWW-Authenticate") != "Bearer" {
				t.Errorf("no WWW-Authenticate challenge")
			}
			// The MCP handler sets its own on a response it writes; the
			// guard's is what a refusal carries.
			if tc.want != http.StatusOK && res.Header.Get("Cache-Control") != "no-store" {
				t.Errorf("Cache-Control %q", res.Header.Get("Cache-Control"))
			}
		})
	}
}

// The file is the bridge's whole knowledge of the app: 0600, the port and the
// secret while listening, neither afterwards, and the switch either way.
func TestLocalMCPRecordNamesTheEndpointWhileUp(t *testing.T) {
	f := newLocalMCPFixture(t)
	if _, _, err := LocalMCPEndpoint(f.dir); !errors.Is(err, ErrLocalMCPOff) {
		t.Fatalf("no file: %v, want ErrLocalMCPOff", err)
	}
	if err := f.svc.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if !f.svc.Running() || f.svc.Addr() == "" {
		t.Fatalf("not running after SetEnabled: %+v", f.svc.State(""))
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(f.dir, localMCPFile))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("mode %o, want 600", info.Mode().Perm())
		}
	}
	rec := f.record(t)
	if !rec.Enabled || rec.Port == 0 || rec.Secret == "" {
		t.Fatalf("record while up: %+v", rec)
	}
	if !strings.HasSuffix(f.svc.Addr(), ":"+itoa(rec.Port)) {
		t.Errorf("file says port %d, listener is %s", rec.Port, f.svc.Addr())
	}
	endpoint, secret, err := LocalMCPEndpoint(f.dir)
	if err != nil || endpoint != "http://127.0.0.1:"+itoa(rec.Port)+"/" || secret != rec.Secret {
		t.Errorf("LocalMCPEndpoint = %q, %q, %v", endpoint, secret, err)
	}

	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	rec = f.record(t)
	if !rec.Enabled || rec.Port != 0 || rec.Secret != "" {
		t.Errorf("record after stop: %+v", rec)
	}
	if _, _, err := LocalMCPEndpoint(f.dir); !errors.Is(err, ErrLocalMCPOff) {
		t.Errorf("after stop: %v, want ErrLocalMCPOff", err)
	}
	if f.svc.Running() || !f.svc.Enabled() {
		t.Errorf("after stop: running=%v enabled=%v", f.svc.Running(), f.svc.Enabled())
	}

	if err := f.svc.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	if rec := f.record(t); rec.Enabled {
		t.Errorf("switch still on in the file: %+v", rec)
	}
}

func itoa(n int) string { return strconv.Itoa(n) }

// The switch survives a restart, the port and secret do not: each Start mints
// a new secret and the old one is refused.
func TestLocalMCPSwitchPersistsSecretDoesNot(t *testing.T) {
	f := newLocalMCPFixture(t)
	if err := f.svc.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	first := f.record(t).Secret
	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}

	again := NewLocalMCPService(f.svc.server)
	again.SetDataDir(f.dir)
	if !again.Enabled() || again.Running() {
		t.Fatalf("after restart: enabled=%v running=%v", again.Enabled(), again.Running())
	}
	if err := again.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := again.Stop(); err != nil {
			t.Error(err)
		}
	})
	second := f.record(t).Secret
	if second == "" || second == first {
		t.Fatalf("secret not regenerated: %q then %q", first, second)
	}
	g := &localMCPFixture{svc: again, dir: f.dir}
	if res := g.post(t, again.Addr(), "Bearer "+first, ""); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("old secret: status %d", res.StatusCode)
	}
	if res := g.post(t, again.Addr(), "Bearer "+second, ""); res.StatusCode != http.StatusOK {
		t.Errorf("new secret: status %d", res.StatusCode)
	}
}

func TestLocalMCPStartRefusesWithNothingToServe(t *testing.T) {
	none := NewLocalMCPService(nil)
	none.SetDataDir(t.TempDir())
	if err := none.Start(); !errors.Is(err, ErrLocalMCPNoServer) {
		t.Errorf("nil server: %v", err)
	}
	f := newLocalMCPFixture(t)
	bare := NewLocalMCPService(f.svc.server)
	if err := bare.Start(); !errors.Is(err, ErrLocalMCPNoDataDir) {
		t.Errorf("no data dir: %v", err)
	}
	if err := bare.SetEnabled(true); !errors.Is(err, ErrLocalMCPNoDataDir) {
		t.Errorf("SetEnabled with no data dir: %v", err)
	}
	if err := bare.Stop(); err != nil {
		t.Errorf("stop while never started: %v", err)
	}
	if state := bare.State("x mcp"); state.Enabled || state.Running || state.Command != "x mcp" {
		t.Errorf("state %+v", state)
	}
}

func TestLocalMCPTellsTheDesktopOnStartAndStop(t *testing.T) {
	f := newLocalMCPFixture(t)
	changes := 0
	f.svc.OnChange(func() { changes++ })
	f.start(t)
	f.start(t) // a second Start is a no-op, and still a notification
	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if changes != 3 {
		t.Errorf("%d notifications, want 3 (start, no-op start, stop)", changes)
	}
}

// A real MCP client with the secret lists and calls through the guard, and
// the app's log line names the client it introduced itself as, not the
// bridge.
func TestLocalMCPServesAnAuthorizedClient(t *testing.T) {
	f := newLocalMCPFixture(t)
	f.start(t)
	endpoint, secret, err := LocalMCPEndpoint(f.dir)
	if err != nil {
		t.Fatal(err)
	}
	transport := &mcp.StreamableClientTransport{
		Endpoint:             endpoint,
		HTTPClient:           &http.Client{Transport: bearerRoundTripper{secret: secret}},
		DisableStandaloneSSE: true,
		MaxRetries:           -1,
	}
	ctx := context.Background()
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "claude-code", Version: "2"}, nil).Connect(ctx, transport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cs.Close(); err != nil {
			t.Error(err)
		}
	})
	listed, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != len(mcpTestTools) {
		t.Errorf("%d tools, want %d", len(listed.Tools), len(mcpTestTools))
	}
	res := callMCPTool(t, cs, "echo", map[string]any{"s": "hi"})
	if res.IsError || !strings.Contains(mcpText(t, res), "echo:hi") {
		t.Errorf("echo: %+v", res)
	}
	if len(f.target.calls) != 1 || f.target.calls[0] != "Echo" {
		t.Errorf("target saw %v", f.target.calls)
	}

	wrong := &mcp.StreamableClientTransport{Endpoint: endpoint,
		HTTPClient: &http.Client{Transport: bearerRoundTripper{secret: "not-it"}}, MaxRetries: -1}
	if _, err := mcp.NewClient(&mcp.Implementation{Name: "x", Version: "0"}, nil).Connect(ctx, wrong, nil); err == nil {
		t.Error("a client with the wrong secret connected")
	}
}
