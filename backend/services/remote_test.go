package services

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// The listener against agent_docs/SECURITY_CHECKLIST.md § S8. Each test names
// the item it holds.

type stubAuthorizer struct {
	device string
	err    error
}

func (a stubAuthorizer) Authorize(*http.Request) (RemoteSession, error) {
	return RemoteSession{Device: a.device}, a.err
}

const testHost = "dash.test"

// newTestRemote builds a service whose allowlisted Host is testHost, with the
// dispatcher over remoteTarget, no assets and no authorizer unless set.
func newTestRemote(t *testing.T) (*RemoteService, *remoteTarget) {
	t.Helper()
	target := &remoteTarget{}
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	s := NewRemoteService(NewEventBus(), d)
	s.AllowHost(testHost)
	return s, target
}

func rpcRequest(method, body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/rpc", strings.NewReader(body))
	r.Host = testHost
	r.Header.Set("Origin", "http://"+testHost)
	r.Header.Set("Content-Type", "application/json")
	return r
}

func do(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// § S8.3: a foreign Host is DNS rebinding, a foreign or missing Origin on a
// socket or a write is a cross-site page. Each is refused before any handler.
func TestRemoteGuardRefusesForeignHostAndOrigin(t *testing.T) {
	s, target := newTestRemote(t)
	s.SetAuthorizer(stubAuthorizer{device: "phone"})
	h := s.Handler()

	cases := []struct {
		name   string
		mutate func(r *http.Request)
		want   int
	}{
		{"foreign host on rpc", func(r *http.Request) { r.Host = "evil.example" }, http.StatusForbidden},
		{"host with a different port", func(r *http.Request) { r.Host = testHost + ":8080" }, http.StatusForbidden},
		{"foreign origin on rpc", func(r *http.Request) { r.Header.Set("Origin", "http://evil.example") }, http.StatusForbidden},
		{"missing origin on rpc", func(r *http.Request) { r.Header.Del("Origin") }, http.StatusForbidden},
		{"null origin on rpc", func(r *http.Request) { r.Header.Set("Origin", "null") }, http.StatusForbidden},
		{"origin with a different port", func(r *http.Request) { r.Header.Set("Origin", "http://"+testHost+":81") }, http.StatusForbidden},
		{"matching host and origin", func(*http.Request) {}, http.StatusOK},
		{"host case does not matter", func(r *http.Request) { r.Host = strings.ToUpper(testHost) }, http.StatusOK},
	}
	for _, tc := range cases {
		r := rpcRequest("Echo", `{"method":"Echo","args":["x"]}`)
		tc.mutate(r)
		if w := do(h, r); w.Code != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", tc.name, w.Code, tc.want, strings.TrimSpace(w.Body.String()))
		}
	}
	if len(target.calls) != 2 {
		t.Errorf("target saw %v; only the two accepted requests should have reached it", target.calls)
	}

	ws := func(origin string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/ws", nil)
		r.Host = testHost
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}
	if w := do(h, ws("http://evil.example")); w.Code != http.StatusForbidden {
		t.Errorf("foreign Origin on /ws: status %d, want 403", w.Code)
	}
	if w := do(h, ws("")); w.Code != http.StatusForbidden {
		t.Errorf("missing Origin on /ws: status %d, want 403", w.Code)
	}
	foreign := httptest.NewRequest(http.MethodGet, "/ws", nil)
	foreign.Host = "evil.example"
	foreign.Header.Set("Origin", "http://evil.example")
	if w := do(h, foreign); w.Code != http.StatusForbidden {
		t.Errorf("foreign Host on /ws: status %d, want 403", w.Code)
	}
}

// § S8.3: no decision reads the source address. Held by grep rather than by
// behaviour, since behaviour cannot show an absence.
func TestRemoteNeverConsultsTheSourceAddress(t *testing.T) {
	for _, name := range []string{"remote.go", "remote_ws.go", "remote_dispatch.go"} {
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(src), "RemoteAddr") {
			t.Errorf("%s reads RemoteAddr; every tunnelled request arrives from loopback, so it decides nothing", name)
		}
		if strings.Contains(string(src), "math/rand") {
			t.Errorf("%s imports math/rand (§ S8.5)", name)
		}
	}
}

// § S8.7: the headers are headers. frame-ancestors in particular cannot come
// from the <meta> tag.
func TestRemoteResponsesCarrySecurityHeaders(t *testing.T) {
	s, _ := newTestRemote(t)
	s.SetAssets(fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>x</title>")}})
	h := s.Handler()

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Host = testHost
	w := do(h, r)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /: %d", w.Code)
	}
	csp := w.Header().Get("Content-Security-Policy")
	for _, want := range []string{"frame-ancestors 'none'", "default-src 'self'", "object-src 'none'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q lacks %q", csp, want)
		}
	}
	if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q", got)
	}
	if got := w.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("Referrer-Policy = %q", got)
	}
	// A refusal carries them too: the guard sets them before it decides.
	r = httptest.NewRequest(http.MethodGet, "/", nil)
	r.Host = "evil.example"
	if w := do(h, r); w.Header().Get("Content-Security-Policy") == "" {
		t.Error("a refused request has no CSP header")
	}
}

// The header is frontend/index.html's policy plus frame-ancestors, so the
// WebView and the browser enforce the same thing and a change to one is a
// change to both.
func TestRemoteCSPMatchesIndexHTML(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "frontend", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`http-equiv="Content-Security-Policy"\s+content="([^"]+)"`).FindStringSubmatch(string(src))
	if m == nil {
		t.Fatal("frontend/index.html has no Content-Security-Policy meta tag")
	}
	want := m[1] + "; frame-ancestors 'none'"
	if remoteCSP != want {
		t.Errorf("remoteCSP is\n  %s\nwant index.html's policy plus frame-ancestors:\n  %s", remoteCSP, want)
	}
}

// § S8.5 and § S8.6 in their Phase 1 form: with nobody to say who a caller
// is, nobody is anybody.
func TestRemoteRefusesEveryAPICallWithoutAnAuthorizer(t *testing.T) {
	s, target := newTestRemote(t)
	h := s.Handler()
	if w := do(h, rpcRequest("Echo", `{"method":"Echo","args":["x"]}`)); w.Code != http.StatusUnauthorized {
		t.Errorf("rpc without an authorizer: %d, want 401", w.Code)
	}
	ws := httptest.NewRequest(http.MethodGet, "/ws", nil)
	ws.Host = testHost
	ws.Header.Set("Origin", "http://"+testHost)
	if w := do(h, ws); w.Code != http.StatusUnauthorized {
		t.Errorf("ws without an authorizer: %d, want 401", w.Code)
	}
	s.SetAuthorizer(stubAuthorizer{err: errors.New("no session")})
	if w := do(h, rpcRequest("Echo", `{"method":"Echo","args":["x"]}`)); w.Code != http.StatusUnauthorized {
		t.Errorf("rpc with a refusing authorizer: %d, want 401", w.Code)
	}
	if len(target.calls) != 0 {
		t.Errorf("an unauthorized call reached the target: %v", target.calls)
	}
}

func TestRemoteRPCAnswersInTheBindingsShape(t *testing.T) {
	s, _ := newTestRemote(t)
	s.SetAuthorizer(stubAuthorizer{device: "phone"})
	h := s.Handler()

	type resp struct {
		Result any    `json:"result"`
		Error  string `json:"error"`
	}
	call := func(body string) (int, resp) {
		w := do(h, rpcRequest("", body))
		var r resp
		if err := json.Unmarshal(w.Body.Bytes(), &r); err != nil && w.Code == http.StatusOK {
			t.Fatalf("not JSON: %s", w.Body.String())
		}
		return w.Code, r
	}

	if code, r := call(`{"method":"Echo","args":["x"]}`); code != 200 || r.Result != "echo:x" || r.Error != "" {
		t.Errorf("Echo: %d %+v", code, r)
	}
	// The method's own error is a 200 with the message: that is the rejected
	// promise the binding would have produced.
	if code, r := call(`{"method":"Fail","args":[]}`); code != 200 || r.Error != "it failed" {
		t.Errorf("Fail: %d %+v", code, r)
	}
	// Refusals are statuses, so the shim can tell them from a method saying no.
	if code, r := call(`{"method":"Hidden","args":[]}`); code != http.StatusNotFound || r.Error == "" {
		t.Errorf("Hidden: %d %+v, want 404", code, r)
	}
	if code, _ := call(`{"method":"Danger","args":[]}`); code != http.StatusForbidden {
		t.Errorf("Danger without approval: %d, want 403", code)
	}
	if code, _ := call(`{"method":"Add","args":[1]}`); code != http.StatusBadRequest {
		t.Errorf("wrong arity: %d, want 400", code)
	}
	if code, _ := call(`{"method":"Echo","args":["x"],"extra":1}`); code != http.StatusBadRequest {
		t.Errorf("unknown field: %d, want 400", code)
	}
	if code, _ := call(`not json`); code != http.StatusBadRequest {
		t.Errorf("malformed body: %d, want 400", code)
	}

	// A form cannot send application/json, so the type is the second line
	// behind the Origin check.
	r := rpcRequest("", `{"method":"Echo","args":["x"]}`)
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if w := do(h, r); w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("form content type: %d, want 415", w.Code)
	}
	r = rpcRequest("", `{"method":"Echo","args":["`+strings.Repeat("x", remoteMaxBody)+`"]}`)
	if w := do(h, r); w.Code != http.StatusBadRequest {
		t.Errorf("oversized body: %d, want 400", w.Code)
	}
	if w := do(h, rpcRequest("", `{"method":"Echo","args":["x"]}`)); w.Header().Get("Cache-Control") != "no-store" {
		t.Error("an RPC response is cacheable")
	}
}

// § S8.9: one line per call, naming the method and the device, and never an
// argument.
func TestRemoteLogsEachCallWithoutItsArguments(t *testing.T) {
	logs := captureLog(t)
	s, _ := newTestRemote(t)
	s.SetAuthorizer(stubAuthorizer{device: "sandros-phone"})
	h := s.Handler()

	const secret = "hunter2-would-be-a-credential"
	if w := do(h, rpcRequest("", `{"method":"Echo","args":["`+secret+`"]}`)); w.Code != 200 {
		t.Fatalf("Echo: %d", w.Code)
	}
	lines := logs.all()
	var calls []string
	for _, l := range lines {
		if strings.HasPrefix(l, "remote: call") {
			calls = append(calls, l)
		}
	}
	if len(calls) != 1 {
		t.Fatalf("got %d call lines, want one: %v", len(calls), lines)
	}
	for _, want := range []string{"method=Echo", "device=sandros-phone", "tier=read", "ok=true"} {
		if !strings.Contains(calls[0], want) {
			t.Errorf("call line %q lacks %q", calls[0], want)
		}
	}
	for _, l := range lines {
		if strings.Contains(l, secret) {
			t.Errorf("an argument reached the log: %q", l)
		}
	}
}

func TestRemoteStaticServesFilesOnlyFromTheBundle(t *testing.T) {
	s, _ := newTestRemote(t)
	s.SetAssets(fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>Konnekt</title>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
	})
	h := s.Handler()
	get := func(p string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, p, nil)
		r.Host = testHost
		return do(h, r)
	}
	if w := get("/"); w.Code != 200 || !strings.Contains(w.Body.String(), "Konnekt") {
		t.Errorf("GET /: %d %q", w.Code, w.Body.String())
	}
	if w := get("/assets/app.js"); w.Code != 200 {
		t.Errorf("GET /assets/app.js: %d", w.Code)
	}
	if w := get("/assets/"); w.Code != http.StatusNotFound {
		t.Errorf("a directory listed: %d", w.Code)
	}
	if w := get("/assets"); w.Code != http.StatusNotFound {
		t.Errorf("a directory served: %d", w.Code)
	}
	if w := get("/nope"); w.Code != http.StatusNotFound {
		t.Errorf("an unknown path: %d, want 404", w.Code)
	}
	// The mux redirects a path with ".." to its cleaned form before any
	// handler runs, and the cleaned form is inside the bundle or a 404: nothing
	// outside it can be named.
	for _, p := range []string{"/../index.html", "/../../etc/passwd"} {
		if w := get(p); w.Code < 300 || w.Code > 399 {
			t.Errorf("%s: %d, want a redirect to the cleaned path", p, w.Code)
		}
	}
	if w := get("/etc/passwd"); w.Code != http.StatusNotFound {
		t.Errorf("/etc/passwd: %d, want 404", w.Code)
	}
	// A page request with a foreign Origin is refused like any other.
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Host = testHost
	r.Header.Set("Origin", "http://evil.example")
	if w := do(h, r); w.Code != http.StatusForbidden {
		t.Errorf("GET / with a foreign Origin: %d", w.Code)
	}
}

// § S8.3: loopback and nothing else.
func TestRemoteStartBindsLoopbackOnly(t *testing.T) {
	s, _ := newTestRemote(t)
	addr, err := s.Start(0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		t.Errorf("bound %q; want a loopback address", addr)
	}
	if !s.Running() || s.Addr() != addr {
		t.Errorf("Running=%v Addr=%q after Start", s.Running(), s.Addr())
	}
	if _, err := s.Start(0); err == nil {
		t.Error("a second Start succeeded")
	}
	// The bound address is the allowlisted Host, in both spellings.
	for _, hostHeader := range []string{addr, "localhost:" + port} {
		req, err := http.NewRequest(http.MethodGet, "http://"+addr+"/", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Host = hostHeader
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if err := resp.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusNotFound { // no assets, but past the guard
			t.Errorf("Host %q: %d, want 404 from the static handler", hostHeader, resp.StatusCode)
		}
	}
	req, err := http.NewRequest(http.MethodGet, "http://"+addr+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "evil.example"
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("rebinding Host over the real listener: %d, want 403", resp.StatusCode)
	}
}

// § S8.8: a listener nobody uses stops itself.
func TestRemoteStopsWhenIdle(t *testing.T) {
	logs := captureLog(t)
	s, _ := newTestRemote(t)
	s.SetIdleTimeout(80 * time.Millisecond)
	if _, err := s.Start(0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Stop(); err != nil {
			t.Error(err)
		}
	})
	deadline := time.Now().Add(3 * time.Second)
	for s.Running() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if s.Running() {
		t.Fatal("still running after the idle period")
	}
	if s.Addr() != "" {
		t.Errorf("Addr = %q after the idle stop", s.Addr())
	}
	found := false
	for _, l := range logs.all() {
		if strings.Contains(l, "remote: idle") {
			found = true
		}
	}
	if !found {
		t.Errorf("no log line for the idle stop: %v", logs.all())
	}
	// Stop on a stopped service is a no-op, not an error.
	if err := s.Stop(); err != nil {
		t.Errorf("Stop after idle: %v", err)
	}
}

func TestRemoteStartRefusesWithoutADispatcher(t *testing.T) {
	s := NewRemoteService(NewEventBus(), nil)
	if _, err := s.Start(0); err == nil {
		t.Fatal("started with no dispatcher")
	}
}
