package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The MCP endpoint on the listener against § S9.5 and § S9.10: each refusal
// the item names, a real client through the bearer check, and the idle hold.

// cookieAuth accepts any request that carries the dashboard's cookie, so a
// test can show that /mcp never asks it, and checks bearer tokens with the
// real grant store.
type cookieAuth struct{ *RemoteAuth }

func (a cookieAuth) Authorize(r *http.Request) (RemoteSession, error) {
	if remoteCookieValue(r, remoteSessionCookie) == "" {
		return RemoteSession{}, errNoCookie
	}
	return RemoteSession{ID: "s1", Device: "phone"}, nil
}

var errNoCookie = &http.ProtocolError{ErrorString: "no cookie"}

type mcpEndpointFixture struct {
	svc    *RemoteService
	auth   *RemoteAuth
	target *remoteTarget
	asked  []RemoteApprovalRequest
}

func newMCPEndpointFixture(t *testing.T) *mcpEndpointFixture {
	t.Helper()
	svc, target := newTestRemote(t)
	f := &mcpEndpointFixture{svc: svc, auth: newTestAuth(t), target: target}
	svc.SetAuthorizer(cookieAuth{f.auth})
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewMCPServer(d, mcpTestTools, "0.0.0-test", MCPServerOptions{
		Caller: "connector",
		Approve: func(_ context.Context, req RemoteApprovalRequest) error {
			f.asked = append(f.asked, req)
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	svc.SetMCPServer(server)
	svc.SetMCPEnabled(true)
	return f
}

func (f *mcpEndpointFixture) token(t *testing.T, resource string, scopes ...string) string {
	t.Helper()
	_, token, err := f.auth.IssueGrant("Claude Code", scopes, resource)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// mcpPost is an initialize at /mcp with the given headers, on testHost.
func mcpPost(mutate func(r *http.Request)) *http.Request {
	r := httptest.NewRequest(http.MethodPost, RemoteMCPPath, strings.NewReader(initializeBody))
	r.Host = testHost
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	mutate(r)
	return r
}

func TestRemoteMCPRefusesEverythingButABearer(t *testing.T) {
	f := newMCPEndpointFixture(t)
	h := f.svc.Handler()
	good := f.token(t, "https://"+testHost+RemoteMCPPath, RemoteScopeRead)
	bearer := func(tok string) func(*http.Request) {
		return func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+tok) }
	}
	const challenge = `Bearer resource_metadata="https://` + testHost + `/.well-known/oauth-protected-resource"`

	cases := []struct {
		name   string
		mutate func(r *http.Request)
		want   int
	}{
		{"no token", func(*http.Request) {}, http.StatusUnauthorized},
		{"token and no origin", bearer(good), http.StatusOK},
		{"token and own origin", func(r *http.Request) {
			bearer(good)(r)
			r.Header.Set("Origin", "https://"+testHost)
		}, http.StatusOK},
		{"token and foreign origin", func(r *http.Request) {
			bearer(good)(r)
			r.Header.Set("Origin", "https://evil.example")
		}, http.StatusForbidden},
		{"token and null origin", func(r *http.Request) {
			bearer(good)(r)
			r.Header.Set("Origin", "null")
		}, http.StatusForbidden},
		{"token for another resource", bearer(f.token(t, "https://other.test/mcp", RemoteScopeRead)), http.StatusUnauthorized},
		{"cookie only", func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: remoteSessionCookie, Value: "a-real-looking-session"})
		}, http.StatusUnauthorized},
		{"token in the query string", func(r *http.Request) {
			r.URL.RawQuery = "access_token=" + good
		}, http.StatusUnauthorized},
		{"token in a cookie", func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: "access_token", Value: good})
		}, http.StatusUnauthorized},
		{"basic auth", func(r *http.Request) { r.Header.Set("Authorization", "Basic "+good) }, http.StatusUnauthorized},
		{"foreign host", func(r *http.Request) {
			bearer(good)(r)
			r.Host = "evil.example"
		}, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(h, mcpPost(tc.mutate))
			if w.Code != tc.want {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
			if tc.want == http.StatusUnauthorized && w.Header().Get("WWW-Authenticate") != challenge {
				t.Errorf("WWW-Authenticate %q", w.Header().Get("WWW-Authenticate"))
			}
			// The guard's own refusals (Host, Origin) carry what every route
			// gets; the endpoint's answers are never cached.
			if tc.want == http.StatusUnauthorized && w.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("Cache-Control %q", w.Header().Get("Cache-Control"))
			}
		})
	}
}

// One credential per surface: the dashboard's RPC never reads a bearer token.
func TestRemoteRPCIgnoresBearerTokens(t *testing.T) {
	f := newMCPEndpointFixture(t)
	good := f.token(t, "https://"+testHost+RemoteMCPPath, RemoteScopeRead, RemoteScopeOperate)
	r := rpcRequest("Echo", `{"method":"Echo","args":["hi"]}`)
	r.Header.Set("Authorization", "Bearer "+good)
	if w := do(f.svc.Handler(), r); w.Code != http.StatusUnauthorized {
		t.Errorf("bearer on /api/rpc: %d, want 401", w.Code)
	}
	if len(f.target.calls) != 0 {
		t.Errorf("the method ran: %v", f.target.calls)
	}
}

func TestRemoteMCPIsAbsentUntilSwitchedOn(t *testing.T) {
	f := newMCPEndpointFixture(t)
	good := f.token(t, "https://"+testHost+RemoteMCPPath, RemoteScopeRead)
	with := func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+good) }
	get := httptest.NewRequest(http.MethodGet, RemoteMCPPath, nil)
	get.Host = testHost

	if w := do(f.svc.Handler(), get); w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") != "POST" {
		t.Errorf("GET while on: %d Allow=%q", w.Code, w.Header().Get("Allow"))
	}
	f.svc.SetMCPEnabled(false)
	if w := do(f.svc.Handler(), mcpPost(with)); w.Code != http.StatusNotFound {
		t.Errorf("POST while off: %d", w.Code)
	}
	if w := do(f.svc.Handler(), mcpPost(func(*http.Request) {})); w.Header().Get("WWW-Authenticate") != "" {
		t.Error("a challenge while off tells a stranger the endpoint exists")
	}
	if w := do(f.svc.Handler(), get); w.Code != http.StatusNotFound {
		t.Errorf("GET while off: %d", w.Code)
	}
	f.svc.SetMCPEnabled(true)
	f.svc.SetMCPServer(nil)
	if w := do(f.svc.Handler(), mcpPost(with)); w.Code != http.StatusNotFound {
		t.Errorf("no catalog: %d", w.Code)
	}
}

// bearerClient connects a real SDK client to the fixture over a loopback
// server, with the token on every request.
func (f *mcpEndpointFixture) bearerClient(t *testing.T, srv *httptest.Server, token string) *mcp.ClientSession {
	t.Helper()
	transport := &mcp.StreamableClientTransport{
		Endpoint:   srv.URL + RemoteMCPPath,
		HTTPClient: &http.Client{Transport: bearerRoundTripper{secret: token}},
		MaxRetries: -1,
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "spoofed name", Version: "0"}, nil).Connect(context.Background(), transport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cs.Close(); err != nil && !strings.Contains(err.Error(), "405") {
			t.Error(err)
		}
	})
	return cs
}

// A connector is named for its grant, held to its scopes, and asked about
// under that name; the clientInfo it sent names nothing.
func TestRemoteMCPCallsAreNamedAndScopedByTheGrant(t *testing.T) {
	logs := captureLogs(t)
	f := newMCPEndpointFixture(t)
	srv := httptest.NewServer(f.svc.Handler())
	t.Cleanup(srv.Close)
	f.svc.AllowHost(strings.TrimPrefix(srv.URL, "http://"))
	resource := RemoteResource(strings.TrimPrefix(srv.URL, "http://"))

	reader := f.bearerClient(t, srv, f.token(t, resource, RemoteScopeRead))
	listed, err := reader.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != len(mcpTestTools) {
		t.Errorf("%d tools, want %d", len(listed.Tools), len(mcpTestTools))
	}
	if res := callMCPTool(t, reader, "echo", map[string]any{"s": "hi"}); res.IsError || !strings.Contains(mcpText(t, res), "echo:hi") {
		t.Errorf("echo as reader: %+v", res)
	}
	if res := callMCPTool(t, reader, "fail", nil); !res.IsError || !strings.Contains(mcpText(t, res), "insufficient scope") {
		t.Errorf("operate tool as reader: %+v", res)
	}
	if res := callMCPTool(t, reader, "gated", map[string]any{"s": "x"}); res.IsError {
		t.Errorf("gated read tool as reader: %+v", res)
	}

	operator := f.bearerClient(t, srv, f.token(t, resource, RemoteScopeOperate))
	if res := callMCPTool(t, operator, "fail", nil); !res.IsError || !strings.Contains(mcpText(t, res), "it failed") {
		t.Errorf("operate tool as operator: %+v", res)
	}
	if res := callMCPTool(t, operator, "echo", map[string]any{"s": "also reads"}); res.IsError {
		t.Errorf("read tool as operator: %+v", res)
	}

	if len(f.asked) != 1 || f.asked[0].Device != "Claude Code" {
		t.Errorf("the desktop was asked as %+v, want the grant's client", f.asked)
	}
	out := logs.String()
	if !strings.Contains(out, `tool=echo client="spoofed name" server="" ok=true`) {
		t.Errorf("no call line:\n%s", out)
	}
	if !strings.Contains(out, "remote: grant issued") || strings.Contains(out, "echo:hi") || strings.Contains(out, "also reads") {
		t.Errorf("the log carries an argument or no grant line:\n%s", out)
	}
}

// § S8.8: an authorized MCP call is activity, a refused one is not.
func TestRemoteMCPCallCountsAsActivity(t *testing.T) {
	f := newMCPEndpointFixture(t)
	good := f.token(t, "https://"+testHost+RemoteMCPPath, RemoteScopeRead)
	h := f.svc.Handler()
	f.svc.lastActive.Store(0)
	do(h, mcpPost(func(*http.Request) {}))
	if f.svc.lastActive.Load() != 0 {
		t.Error("a refused call touched the listener")
	}
	do(h, mcpPost(func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+good) }))
	if f.svc.lastActive.Load() == 0 {
		t.Error("an authorized call did not touch the listener")
	}
}

// § S9.10: held open, the listener outlives the idle period; released, the
// stop comes back.
func TestRemoteHoldOpenSuspendsTheIdleStop(t *testing.T) {
	s, _ := newTestRemote(t)
	s.SetIdleTimeout(80 * time.Millisecond)
	s.SetHoldOpen(true)
	if _, err := s.Start(0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	time.Sleep(400 * time.Millisecond)
	if !s.Running() {
		t.Fatal("stopped while held open")
	}
	s.SetHoldOpen(false)
	deadline := time.Now().Add(3 * time.Second)
	for s.Running() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if s.Running() {
		t.Fatal("still running after the hold was released")
	}
}
