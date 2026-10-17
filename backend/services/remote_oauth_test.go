package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// The authorization server against § S9.6 and § S9.7: discovery, a client's
// registration, the consent page, the code exchange, refresh rotation, and
// the pinned metadata fetch. Every request goes through the listener's
// guard, so the Origin rules are exercised as a client meets them.

type oauthFixture struct {
	svc   *RemoteService
	auth  *RemoteAuth
	clock *time.Time
	h     http.Handler

	mu     sync.Mutex
	asked  []RemoteApprovalRequest
	answer error
}

func newOAuthFixture(t *testing.T) *oauthFixture {
	t.Helper()
	svc, target := newTestRemote(t)
	a, clock := newPasswordAuthClock(t)
	svc.SetAuthorizer(a)
	d, err := NewRemoteDispatcher(target, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewMCPServer(d, mcpTestTools, "0.0.0-test", MCPServerOptions{Caller: "connector"})
	if err != nil {
		t.Fatal(err)
	}
	svc.SetMCPServer(server)
	svc.SetMCPEnabled(true)
	svc.SetMCPOperateTools(MCPOperateTools(d, mcpTestTools))
	f := &oauthFixture{svc: svc, auth: a, clock: clock, h: svc.Handler()}
	a.SetConsentApprover(func(_ context.Context, req RemoteApprovalRequest) error {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.asked = append(f.asked, req)
		return f.answer
	})
	return f
}

func (f *oauthFixture) get(path string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r.Host = testHost
	return do(f.h, r)
}

// postForm is a browser's form submission when origin is set, a client's
// otherwise.
func (f *oauthFixture) postForm(path string, form url.Values, origin bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(form.Encode()))
	r.Host = testHost
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if origin {
		r.Header.Set("Origin", "https://"+testHost)
	}
	return do(f.h, r)
}

func (f *oauthFixture) postJSON(path string, body any) *httptest.ResponseRecorder {
	b, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	r.Host = testHost
	r.Header.Set("Content-Type", "application/json")
	return do(f.h, r)
}

func decodeJSON(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("not JSON (%d): %s", w.Code, w.Body.String())
	}
	return out
}

func (f *oauthFixture) register(t *testing.T, redirects ...string) string {
	t.Helper()
	w := f.postJSON(RemoteRegisterPath, map[string]any{
		"client_name": "Claude", "redirect_uris": redirects, "token_endpoint_auth_method": "none",
		"grant_types": []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"}})
	if w.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", w.Code, w.Body.String())
	}
	id, ok := decodeJSON(t, w)["client_id"].(string)
	if !ok || id == "" {
		t.Fatalf("no client_id in %s", w.Body.String())
	}
	return id
}

func pkce() (verifier, challenge string) {
	verifier = strings.Repeat("v", 43)
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

func authorizeURL(client, redirect, challenge, scope, state string) string {
	q := url.Values{"response_type": {"code"}, "client_id": {client}, "redirect_uri": {redirect},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {state}}
	if scope != "" {
		q.Set("scope", scope)
	}
	return RemoteAuthorizePath + "?" + q.Encode()
}

var (
	requestField = regexp.MustCompile(`name="request" value="([^"]+)"`)
	csrfField    = regexp.MustCompile(`name="csrf" value="([^"]+)"`)
)

// startConsent opens the page and returns the form's request id and CSRF
// token.
func (f *oauthFixture) startConsent(t *testing.T, path string) (id, csrf string, body string) {
	t.Helper()
	w := f.get(path)
	if w.Code != http.StatusOK {
		t.Fatalf("authorize: %d %s", w.Code, w.Body.String())
	}
	if csp := w.Header().Get("Content-Security-Policy"); csp != remoteConsentCSP {
		t.Errorf("consent CSP %q", csp)
	}
	body = w.Body.String()
	idm, cm := requestField.FindStringSubmatch(body), csrfField.FindStringSubmatch(body)
	if idm == nil || cm == nil {
		t.Fatalf("no form fields in:\n%s", body)
	}
	return idm[1], cm[1], body
}

func (f *oauthFixture) consent(id, csrf, password, action string, scopes ...string) *httptest.ResponseRecorder {
	form := url.Values{"request": {id}, "csrf": {csrf}, "password": {password}, "action": {action}}
	for _, s := range scopes {
		form.Add("scope", s)
	}
	return f.postForm(RemoteAuthorizePath, form, true)
}

// waitForRedirect polls the waiting page as the browser would and returns
// the redirect it ends in.
func (f *oauthFixture) waitForRedirect(t *testing.T, w *httptest.ResponseRecorder) *url.URL {
	t.Helper()
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), RemoteAuthorizeWaitPath) {
		t.Fatalf("not the waiting page: %d %s", w.Code, w.Body.String())
	}
	m := regexp.MustCompile(`href="([^"]+)"`).FindStringSubmatch(w.Body.String())
	if m == nil {
		t.Fatal("no wait link")
	}
	waitURL := strings.ReplaceAll(m[1], "&amp;", "&")
	for range 200 {
		w := f.get(waitURL)
		if w.Code == http.StatusSeeOther {
			u, err := url.Parse(w.Header().Get("Location"))
			if err != nil {
				t.Fatal(err)
			}
			return u
		}
		if w.Code != http.StatusOK {
			t.Fatalf("wait: %d %s", w.Code, w.Body.String())
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the desktop never answered")
	return nil
}

func (f *oauthFixture) exchange(code, verifier, client, redirect string) *httptest.ResponseRecorder {
	return f.postForm(RemoteTokenPath, url.Values{"grant_type": {"authorization_code"}, "code": {code},
		"code_verifier": {verifier}, "client_id": {client}, "redirect_uri": {redirect}}, false)
}

// signIn runs the whole flow for client and returns the token response.
func (f *oauthFixture) signIn(t *testing.T, client, redirect string, scopes ...string) map[string]any {
	t.Helper()
	verifier, challenge := pkce()
	id, csrf, _ := f.startConsent(t, authorizeURL(client, redirect, challenge, strings.Join(scopes, " "), "s1"))
	back := f.waitForRedirect(t, f.consent(id, csrf, testPassword, "allow", scopes...))
	if back.Query().Get("error") != "" {
		t.Fatalf("redirected with %s", back.RawQuery)
	}
	w := f.exchange(back.Query().Get("code"), verifier, client, redirect)
	if w.Code != http.StatusOK {
		t.Fatalf("token: %d %s", w.Code, w.Body.String())
	}
	return decodeJSON(t, w)
}

func TestOAuthMetadataNamesThisListener(t *testing.T) {
	f := newOAuthFixture(t)
	for _, p := range []string{RemotePRMPath, RemotePRMPath + RemoteMCPPath} {
		w := f.get(p)
		prm := decodeJSON(t, w)
		if w.Code != http.StatusOK || prm["resource"] != "https://dash.test/mcp" {
			t.Errorf("%s: %d %v", p, w.Code, prm)
		}
		if as, _ := prm["authorization_servers"].([]any); len(as) != 1 || as[0] != "https://dash.test" {
			t.Errorf("authorization_servers %v", prm["authorization_servers"])
		}
	}
	w := f.get(RemoteASMPath)
	asm := decodeJSON(t, w)
	want := map[string]any{
		"issuer": "https://dash.test", "authorization_endpoint": "https://dash.test/authorize",
		"token_endpoint": "https://dash.test/token", "registration_endpoint": "https://dash.test/register",
		"client_id_metadata_document_supported": true, "authorization_response_iss_parameter_supported": true,
	}
	for k, v := range want {
		if asm[k] != v {
			t.Errorf("%s = %v, want %v", k, asm[k], v)
		}
	}
	lists := map[string]string{"code_challenge_methods_supported": "S256", "token_endpoint_auth_methods_supported": "none",
		"scopes_supported": RemoteScopeOperate, "grant_types_supported": "refresh_token"}
	for k, v := range lists {
		if l, _ := asm[k].([]any); len(l) == 0 || !strings.Contains(fmt.Sprint(l), v) {
			t.Errorf("%s = %v, want %s in it", k, asm[k], v)
		}
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("metadata is cacheable")
	}
}

func TestOAuthRegistrationIsBoundedAndPublic(t *testing.T) {
	f := newOAuthFixture(t)
	refused := map[string]map[string]any{
		"no redirects":      {"client_name": "x"},
		"foreign redirect":  {"redirect_uris": []string{"https://evil.example/callback"}},
		"claude plus slash": {"redirect_uris": []string{RemoteClaudeRedirect + "/"}},
		"loopback query":    {"redirect_uris": []string{"http://localhost:8/callback?x=1"}},
		"confidential":      {"redirect_uris": []string{RemoteClaudeRedirect}, "token_endpoint_auth_method": "client_secret_basic"},
		"implicit":          {"redirect_uris": []string{RemoteClaudeRedirect}, "response_types": []string{"token"}},
		"client credentials": {"redirect_uris": []string{RemoteClaudeRedirect},
			"grant_types": []string{"client_credentials"}},
	}
	for name, body := range refused {
		if w := f.postJSON(RemoteRegisterPath, body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", name, w.Code, w.Body.String())
		}
	}
	w := f.postJSON(RemoteRegisterPath, map[string]any{"client_name": "Claude Code\x1b[31m", "redirect_uris": []string{"http://localhost/callback", "http://127.0.0.1/callback"}})
	reg := decodeJSON(t, w)
	if w.Code != http.StatusCreated || reg["token_endpoint_auth_method"] != "none" || reg["client_secret"] != nil || reg["client_name"] != "Claude Code[31m" {
		t.Fatalf("registration: %d %v", w.Code, reg)
	}
	for range remoteMaxClients - 1 {
		f.register(t, RemoteClaudeRedirect)
	}
	if w := f.postJSON(RemoteRegisterPath, map[string]any{"redirect_uris": []string{RemoteClaudeRedirect}}); w.Code != http.StatusBadRequest {
		t.Errorf("client %d: %d, want the cap", remoteMaxClients+1, w.Code)
	}
	// Unused for thirty days, they are forgotten and the room comes back.
	*f.clock = f.clock.Add(remoteClientUnused + time.Second)
	f.register(t, RemoteClaudeRedirect)
	// A reload sees the registration and not the forgotten ones.
	reloaded := newTestAuthIn(t, f.auth.dir)
	if n := len(reloaded.state.Clients); n != 1 {
		t.Errorf("%d clients after reload, want 1", n)
	}
}

func TestOAuthSignInEndsInAGrant(t *testing.T) {
	f := newOAuthFixture(t)
	client := f.register(t, "http://localhost/callback")
	redirect := "http://localhost:51234/callback"
	verifier, challenge := pkce()
	id, csrf, page := f.startConsent(t, authorizeURL(client, redirect, challenge, "konnekt:read konnekt:operate", "xyz"))
	for _, want := range []string{"Connect Claude to Konnekt", "localhost:51234", "a program on the computer",
		`value="konnekt:read" checked`, `value="konnekt:operate">`} {
		if !strings.Contains(page, want) {
			t.Errorf("page lacks %q:\n%s", want, page)
		}
	}
	back := f.waitForRedirect(t, f.consent(id, csrf, testPassword, "allow", RemoteScopeRead, RemoteScopeOperate))
	q := back.Query()
	if back.Scheme+"://"+back.Host+back.Path != redirect || q.Get("code") == "" || q.Get("state") != "xyz" || q.Get("iss") != "https://dash.test" {
		t.Fatalf("redirected to %s", back)
	}
	f.mu.Lock()
	asked := f.asked
	f.mu.Unlock()
	if len(asked) != 1 || asked[0].Device != "Claude" || asked[0].Method != remoteConsentMethod || !strings.Contains(asked[0].Reason, "run commands") {
		t.Errorf("the desktop was asked %+v", asked)
	}

	w := f.exchange(q.Get("code"), verifier, client, redirect)
	tokens := decodeJSON(t, w)
	if w.Code != http.StatusOK || tokens["token_type"] != "Bearer" || tokens["scope"] != "konnekt:operate konnekt:read" || tokens["refresh_token"] == "" {
		t.Fatalf("tokens: %d %v", w.Code, tokens)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("tokens are cacheable")
	}
	access, _ := tokens["access_token"].(string)
	g, err := f.auth.AuthorizeBearer(access, "https://dash.test/mcp")
	if err != nil || g.Client != "Claude" || len(g.Scopes) != 2 {
		t.Fatalf("the access token: %+v %v", g, err)
	}

	// The refresh token rotates: the new one works, the old one is dead, and
	// a replay of the old one ends the grant (§ S9.6).
	refresh, _ := tokens["refresh_token"].(string)
	w = f.postForm(RemoteTokenPath, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {client}}, false)
	next := decodeJSON(t, w)
	if w.Code != http.StatusOK || next["refresh_token"] == refresh || next["access_token"] == access {
		t.Fatalf("refresh: %d %v", w.Code, next)
	}
	if _, err := f.auth.AuthorizeBearer(access, "https://dash.test/mcp"); err == nil {
		t.Error("the old access token still works after a refresh")
	}
	w = f.postForm(RemoteTokenPath, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {"someone else"}}, false)
	if w.Code != http.StatusBadRequest || decodeJSON(t, w)["error"] != "invalid_grant" {
		t.Errorf("refresh for another client: %d %s", w.Code, w.Body.String())
	}
	w = f.postForm(RemoteTokenPath, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {client}}, false)
	if w.Code != http.StatusBadRequest || decodeJSON(t, w)["error"] != "invalid_grant" {
		t.Errorf("replayed refresh: %d %s", w.Code, w.Body.String())
	}
	if n := len(f.auth.Grants()); n != 0 {
		t.Errorf("%d grants after the replay, want none", n)
	}
	newAccess, _ := next["access_token"].(string)
	if _, err := f.auth.AuthorizeBearer(newAccess, "https://dash.test/mcp"); err == nil {
		t.Error("the grant's tokens outlived the replay")
	}
}

func TestOAuthCodeIsSingleUseAndBoundToPKCE(t *testing.T) {
	f := newOAuthFixture(t)
	client := f.register(t, RemoteClaudeRedirect)
	verifier, challenge := pkce()
	code := func() string {
		id, csrf, _ := f.startConsent(t, authorizeURL(client, RemoteClaudeRedirect, challenge, "", "s"))
		return f.waitForRedirect(t, f.consent(id, csrf, testPassword, "allow", RemoteScopeRead)).Query().Get("code")
	}
	expect := func(name string, w *httptest.ResponseRecorder, errCode string) {
		t.Helper()
		if w.Code != http.StatusBadRequest || decodeJSON(t, w)["error"] != errCode {
			t.Errorf("%s: %d %s, want %s", name, w.Code, w.Body.String(), errCode)
		}
	}
	c := code()
	if w := f.exchange(c, verifier, client, RemoteClaudeRedirect); w.Code != http.StatusOK {
		t.Fatalf("first exchange: %d %s", w.Code, w.Body.String())
	}
	expect("second exchange", f.exchange(c, verifier, client, RemoteClaudeRedirect), "invalid_grant")

	c = code()
	expect("wrong verifier", f.exchange(c, strings.Repeat("w", 43), client, RemoteClaudeRedirect), "invalid_grant")
	expect("right verifier after a wrong one", f.exchange(c, verifier, client, RemoteClaudeRedirect), "invalid_grant")

	other := f.register(t, RemoteClaudeRedirect)
	expect("another client", f.exchange(code(), verifier, other, RemoteClaudeRedirect), "invalid_grant")
	expect("another redirect", f.exchange(code(), verifier, client, "http://localhost/callback"), "invalid_grant")
	expect("another resource", f.postForm(RemoteTokenPath, url.Values{"grant_type": {"authorization_code"}, "code": {code()},
		"code_verifier": {verifier}, "client_id": {client}, "redirect_uri": {RemoteClaudeRedirect}, "resource": {"https://other.test/mcp"}}, false), "invalid_target")

	c = code()
	*f.clock = f.clock.Add(remoteCodeTTL + time.Second)
	expect("expired code", f.exchange(c, verifier, client, RemoteClaudeRedirect), "invalid_grant")
	expect("unknown grant type", f.postForm(RemoteTokenPath, url.Values{"grant_type": {"password"}}, false), "unsupported_grant_type")
	if w := f.postJSON(RemoteTokenPath, map[string]string{"grant_type": "authorization_code"}); w.Code != http.StatusBadRequest {
		t.Errorf("JSON at /token: %d", w.Code)
	}
	if n := len(f.auth.Grants()); n != 1 {
		t.Errorf("%d grants, want the one the first exchange made", n)
	}
}

func TestOAuthRedirectURIsMatchExactly(t *testing.T) {
	f := newOAuthFixture(t)
	hosted := f.register(t, RemoteClaudeRedirect)
	local := f.register(t, "http://127.0.0.1/callback")
	_, challenge := pkce()
	refused := map[string]string{
		"trailing slash":   authorizeURL(hosted, RemoteClaudeRedirect+"/", challenge, "", "s"),
		"other host":       authorizeURL(hosted, "https://evil.example/api/mcp/auth_callback", challenge, "", "s"),
		"not registered":   authorizeURL(hosted, "http://127.0.0.1:9/callback", challenge, "", "s"),
		"other loopback":   authorizeURL(local, "http://localhost:9/callback", challenge, "", "s"),
		"loopback path":    authorizeURL(local, "http://127.0.0.1:9/callback/../x", challenge, "", "s"),
		"unknown client":   authorizeURL("nobody", RemoteClaudeRedirect, challenge, "", "s"),
		"http client id":   authorizeURL("http://claude.ai/x", RemoteClaudeRedirect, challenge, "", "s"),
		"no client at all": RemoteAuthorizePath,
	}
	for name, path := range refused {
		w := f.get(path)
		if w.Code != http.StatusBadRequest || w.Header().Get("Location") != "" {
			t.Errorf("%s: %d, want a 400 page and no redirect", name, w.Code)
		}
	}
	// Claude Code's port is its own.
	if w := f.get(authorizeURL(local, "http://127.0.0.1:61000/callback", challenge, "", "s")); w.Code != http.StatusOK {
		t.Errorf("loopback with a port: %d %s", w.Code, w.Body.String())
	}
	// A registered client with one redirect may leave it out.
	w := f.get(RemoteAuthorizePath + "?" + url.Values{"response_type": {"code"}, "client_id": {hosted},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"}}.Encode())
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "claude.ai") {
		t.Errorf("implied redirect: %d", w.Code)
	}
	// Past the redirect check, errors go back to the client.
	backTo := map[string]string{
		"plain challenge": RemoteAuthorizePath + "?" + url.Values{"response_type": {"code"}, "client_id": {hosted},
			"redirect_uri": {RemoteClaudeRedirect}, "code_challenge": {challenge}, "code_challenge_method": {"plain"}, "state": {"q"}}.Encode(),
		"implicit": RemoteAuthorizePath + "?" + url.Values{"response_type": {"token"}, "client_id": {hosted},
			"redirect_uri": {RemoteClaudeRedirect}, "code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {"q"}}.Encode(),
		"unknown scope":  authorizeURL(hosted, RemoteClaudeRedirect, challenge, "konnekt:admin", "q"),
		"other resource": authorizeURL(hosted, RemoteClaudeRedirect, challenge, "", "q") + "&resource=https%3A%2F%2Fother.test%2Fmcp",
	}
	for name, path := range backTo {
		w := f.get(path)
		loc, err := url.Parse(w.Header().Get("Location"))
		if err != nil || w.Code != http.StatusSeeOther || loc.Host != "claude.ai" || loc.Query().Get("error") == "" || loc.Query().Get("state") != "q" || loc.Query().Get("iss") != "https://dash.test" {
			t.Errorf("%s: %d %s", name, w.Code, w.Header().Get("Location"))
		}
	}
}

func TestOAuthConsentNeedsPasswordAndDesktop(t *testing.T) {
	f := newOAuthFixture(t)
	client := f.register(t, RemoteClaudeRedirect)
	_, challenge := pkce()
	start := func() (string, string) {
		id, csrf, _ := f.startConsent(t, authorizeURL(client, RemoteClaudeRedirect, challenge, "", "s"))
		return id, csrf
	}
	id, csrf := start()
	if w := f.consent(id, "not the token", testPassword, "allow", RemoteScopeRead); w.Code != http.StatusBadRequest {
		t.Errorf("wrong CSRF token: %d", w.Code)
	}
	if w := f.consent(id, csrf, testPassword, "allow"); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "at least one") {
		t.Errorf("no scope ticked: %d", w.Code)
	}
	if w := f.consent(id, csrf, "", "allow", RemoteScopeRead); w.Code != http.StatusBadRequest {
		t.Errorf("no password: %d", w.Code)
	}
	for i := range remoteLoginFree {
		if w := f.consent(id, csrf, "wrong", "allow", RemoteScopeRead); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "Wrong password") {
			t.Fatalf("wrong password %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	if w := f.consent(id, csrf, testPassword, "allow", RemoteScopeRead); w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" {
		t.Errorf("after %d failures: %d, want the backoff", remoteLoginFree, w.Code)
	}
	*f.clock = f.clock.Add(remoteLoginQuiet + time.Second)
	if len(f.asked) != 0 {
		t.Error("the desktop was asked before the password was right")
	}

	// Cancel goes straight back to the client.
	id, csrf = start()
	w := f.consent(id, csrf, "", "deny")
	if loc := w.Header().Get("Location"); w.Code != http.StatusSeeOther || !strings.Contains(loc, "error=access_denied") || !strings.Contains(loc, "state=s") {
		t.Errorf("cancel: %d %s", w.Code, loc)
	}
	if w := f.consent(id, csrf, testPassword, "allow", RemoteScopeRead); w.Code != http.StatusBadRequest {
		t.Errorf("a cancelled page used again: %d", w.Code)
	}

	// The desktop declines.
	f.mu.Lock()
	f.answer = ErrRemoteApprovalDenied
	f.mu.Unlock()
	id, csrf = start()
	back := f.waitForRedirect(t, f.consent(id, csrf, testPassword, "allow", RemoteScopeRead))
	if back.Query().Get("error") != "access_denied" || back.Query().Get("iss") != "https://dash.test" {
		t.Errorf("declined on the desktop: %s", back)
	}
	if n := len(f.auth.Grants()); n != 0 {
		t.Errorf("%d grants after a decline", n)
	}

	// With nobody to ask, nothing is granted.
	f.auth.SetConsentApprover(nil)
	id, csrf = start()
	if back := f.waitForRedirect(t, f.consent(id, csrf, testPassword, "allow", RemoteScopeRead)); back.Query().Get("error") != "access_denied" {
		t.Errorf("no approver: %s", back)
	}

	// The page expires.
	id, csrf = start()
	*f.clock = f.clock.Add(remoteConsentTTL + time.Second)
	if w := f.consent(id, csrf, testPassword, "allow", RemoteScopeRead); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "expired") {
		t.Errorf("expired page: %d", w.Code)
	}
	// Without a password set up there is no page at all.
	a := newTestAuth(t)
	f.svc.SetAuthorizer(a)
	a.SetConsentApprover(func(context.Context, RemoteApprovalRequest) error { return nil })
	client = f.register(t, RemoteClaudeRedirect)
	if w := f.get(authorizeURL(client, RemoteClaudeRedirect, challenge, "", "s")); w.Code != http.StatusForbidden {
		t.Errorf("no password set: %d", w.Code)
	}
}

func TestOAuthPasswordChangeDropsConsentsAndCodes(t *testing.T) {
	f := newOAuthFixture(t)
	client := f.register(t, RemoteClaudeRedirect)
	verifier, challenge := pkce()
	id, csrf, _ := f.startConsent(t, authorizeURL(client, RemoteClaudeRedirect, challenge, "", "s"))
	code := f.waitForRedirect(t, f.consent(id, csrf, testPassword, "allow", RemoteScopeRead)).Query().Get("code")
	id2, csrf2, _ := f.startConsent(t, authorizeURL(client, RemoteClaudeRedirect, challenge, "", "s"))
	if err := f.auth.SetPassword("a different password"); err != nil {
		t.Fatal(err)
	}
	if w := f.exchange(code, verifier, client, RemoteClaudeRedirect); w.Code != http.StatusBadRequest {
		t.Errorf("a code from before the password change: %d", w.Code)
	}
	if w := f.consent(id2, csrf2, "a different password", "allow", RemoteScopeRead); w.Code != http.StatusBadRequest {
		t.Errorf("a page from before the password change: %d", w.Code)
	}
	if n := len(f.auth.state.Clients); n != 1 {
		t.Errorf("%d clients, want the registration kept", n)
	}
}

func TestOAuthIsAbsentWhileConnectorsOff(t *testing.T) {
	f := newOAuthFixture(t)
	f.svc.SetMCPEnabled(false)
	for _, p := range RemoteOAuthGETPaths {
		if w := f.get(p); w.Code != http.StatusNotFound {
			t.Errorf("GET %s while off: %d", p, w.Code)
		}
	}
	if w := f.postJSON(RemoteRegisterPath, map[string]any{"redirect_uris": []string{RemoteClaudeRedirect}}); w.Code != http.StatusNotFound {
		t.Errorf("register while off: %d", w.Code)
	}
	if w := f.postForm(RemoteTokenPath, url.Values{"grant_type": {"refresh_token"}}, false); w.Code != http.StatusNotFound {
		t.Errorf("token while off: %d", w.Code)
	}
	// An authorizer that is not an authorization server leaves them 404 too.
	f.svc.SetMCPEnabled(true)
	f.svc.SetAuthorizer(sessionOnlyAuth{})
	if w := f.get(RemoteASMPath); w.Code != http.StatusNotFound {
		t.Errorf("metadata with no OAuth server: %d", w.Code)
	}
}

// sessionOnlyAuth is an authorizer with no OAuth half.
type sessionOnlyAuth struct{}

func (sessionOnlyAuth) Authorize(*http.Request) (RemoteSession, error) {
	return RemoteSession{}, errNoCookie
}

func TestOAuthGuardKeepsOriginRulesPerRoute(t *testing.T) {
	f := newOAuthFixture(t)
	// A client's POSTs carry no Origin and pass; the browser's form must.
	if w := f.postForm(RemoteTokenPath, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {"x"}}, false); w.Code != http.StatusBadRequest {
		t.Errorf("token without Origin: %d %s", w.Code, w.Body.String())
	}
	if w := f.postForm(RemoteAuthorizePath, url.Values{"request": {"x"}}, false); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "missing origin") {
		t.Errorf("consent form without Origin: %d %s", w.Code, w.Body.String())
	}
	for _, p := range []string{RemoteTokenPath, RemoteRegisterPath, RemoteAuthorizePath} {
		r := httptest.NewRequest(http.MethodPost, p, strings.NewReader("{}"))
		r.Host = testHost
		r.Header.Set("Origin", "https://evil.example")
		if w := do(f.h, r); w.Code != http.StatusForbidden {
			t.Errorf("%s with a foreign Origin: %d", p, w.Code)
		}
	}
	r := httptest.NewRequest(http.MethodGet, RemoteASMPath, nil)
	r.Host = "evil.example"
	if w := do(f.h, r); w.Code != http.StatusForbidden {
		t.Errorf("metadata for a foreign Host: %d", w.Code)
	}
}

func TestRemoteMCPStepsUpForOperateTools(t *testing.T) {
	f := newOAuthFixture(t)
	call := func(token, tool string) *httptest.ResponseRecorder {
		body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":{"s":"x"}}}`, tool)
		r := httptest.NewRequest(http.MethodPost, RemoteMCPPath, strings.NewReader(body))
		r.Host = testHost
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json, text/event-stream")
		r.Header.Set("Authorization", "Bearer "+token)
		return do(f.h, r)
	}
	_, reader, err := f.auth.IssueGrant("Claude", []string{RemoteScopeRead}, "https://dash.test/mcp")
	if err != nil {
		t.Fatal(err)
	}
	w := call(reader, "fail")
	want := `Bearer error="insufficient_scope", scope="konnekt:operate", resource_metadata="https://dash.test/.well-known/oauth-protected-resource"`
	if w.Code != http.StatusForbidden || w.Header().Get("WWW-Authenticate") != want {
		t.Errorf("operate tool on a read grant: %d %q", w.Code, w.Header().Get("WWW-Authenticate"))
	}
	if w := call(reader, "echo"); w.Code != http.StatusOK {
		t.Errorf("read tool on a read grant: %d %s", w.Code, w.Body.String())
	}
	_, operator, err := f.auth.IssueGrant("Claude", []string{RemoteScopeOperate}, "https://dash.test/mcp")
	if err != nil {
		t.Fatal(err)
	}
	if w := call(operator, "fail"); w.Code != http.StatusOK {
		t.Errorf("operate tool on an operate grant: %d %s", w.Code, w.Body.String())
	}
	if w := call("nope", "fail"); w.Code != http.StatusUnauthorized {
		t.Errorf("no grant: %d", w.Code)
	}
}

// ── Client ID Metadata Documents ────────────────────────────────────────

const claudeCodeCIMD = "https://claude.ai/oauth/claude-code-client-metadata"

// cimdTestFetcher is a fetcher whose resolver and transport are the test's,
// so no request leaves the process.
func cimdTestFetcher(addrs []netip.Addr, rt http.RoundTripper) *cimdFetcher {
	return &cimdFetcher{cache: map[string]cimdEntry{}, now: time.Now,
		lookup: func(context.Context, string) ([]netip.Addr, error) { return addrs, nil },
		client: &http.Client{Transport: rt}}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(body))}
}

var claudeCodeDoc = fmt.Sprintf(`{"client_id":%q,"client_name":"Claude Code","redirect_uris":["http://localhost/callback","http://127.0.0.1/callback"],"token_endpoint_auth_method":"none"}`, claudeCodeCIMD)

func TestCIMDRefusesPrivateAddresses(t *testing.T) {
	public := netip.MustParseAddr("93.184.216.34")
	dialed := false
	rt := roundTripFunc(func(*http.Request) (*http.Response, error) {
		dialed = true
		return jsonResponse(http.StatusOK, claudeCodeDoc), nil
	})
	for _, addr := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "100.64.0.1", "fe80::1", "0.0.0.0"} {
		f := cimdTestFetcher([]netip.Addr{public, netip.MustParseAddr(addr)}, rt)
		if _, err := f.Fetch(context.Background(), claudeCodeCIMD); !errors.Is(err, ErrCIMDAddress) {
			t.Errorf("%s: %v, want ErrCIMDAddress", addr, err)
		}
	}
	if dialed {
		t.Error("a private address was fetched")
	}
	// A URL of the wrong shape, or on any host but claude.ai, is refused
	// before anything is resolved.
	f := newCIMDFetcher()
	f.lookup = func(context.Context, string) ([]netip.Addr, error) {
		return nil, errors.New("resolved, which it must not be")
	}
	shapes := []string{"http://claude.ai/x", "https://claude.ai", "https://claude.ai/", "https://claude.ai/x?y=1", "https://claude.ai/x#f",
		"https://user@claude.ai/x", "https://93.184.216.34/x", "https://[2001:db8::1]/x", "claude.ai/x", "",
		// Any host but claude.ai, including ones that only look like it.
		"https://example.com/x", "https://claude.ai.example.com/x", "https://www.claude.ai/x", "https://claude.ai:8443/x"}
	for _, raw := range shapes {
		if _, err := f.Fetch(context.Background(), raw); !errors.Is(err, ErrCIMDURL) {
			t.Errorf("%q: %v, want ErrCIMDURL", raw, err)
		}
	}
	if !publicAddress(public) || publicAddress(netip.MustParseAddr("192.168.1.1")) || publicAddress(netip.MustParseAddr("fc00::1")) {
		t.Error("publicAddress disagrees with the rule")
	}
}

func TestCIMDDocumentMustMatchItsURL(t *testing.T) {
	public := []netip.Addr{netip.MustParseAddr("93.184.216.34")}
	cases := map[string]*http.Response{
		"other client_id": jsonResponse(http.StatusOK, `{"client_id":"https://claude.ai/other","redirect_uris":["http://localhost/callback"]}`),
		"no redirects":    jsonResponse(http.StatusOK, fmt.Sprintf(`{"client_id":%q}`, claudeCodeCIMD)),
		"not found":       jsonResponse(http.StatusNotFound, `{}`),
		"not JSON": {StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"text/html"}},
			Body: io.NopCloser(strings.NewReader(claudeCodeDoc))},
		"too large": jsonResponse(http.StatusOK, `{"client_id":"`+strings.Repeat("x", cimdMaxBody)+`"}`),
	}
	for name, res := range cases {
		f := cimdTestFetcher(public, roundTripFunc(func(*http.Request) (*http.Response, error) { return res, nil }))
		if _, err := f.Fetch(context.Background(), claudeCodeCIMD); !errors.Is(err, ErrCIMDDoc) {
			t.Errorf("%s: %v, want ErrCIMDDoc", name, err)
		}
	}
	if _, err := cimdTestFetcher(public, roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": {"https://elsewhere.example/x"}}, Body: http.NoBody}, nil
	})).Fetch(context.Background(), claudeCodeCIMD); !errors.Is(err, ErrCIMDDoc) {
		t.Errorf("redirect: %v", err)
	}
	fetched := 0
	f := cimdTestFetcher(public, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		fetched++
		if r.URL.String() != claudeCodeCIMD || r.Header.Get("Accept") != "application/json" {
			t.Errorf("fetched %s with Accept %q", r.URL, r.Header.Get("Accept"))
		}
		return jsonResponse(http.StatusOK, claudeCodeDoc), nil
	}))
	for range 2 {
		doc, err := f.Fetch(context.Background(), claudeCodeCIMD)
		if err != nil || doc.ClientName != "Claude Code" || len(doc.RedirectURIs) != 2 {
			t.Fatalf("doc %+v, %v", doc, err)
		}
	}
	if fetched != 1 {
		t.Errorf("fetched %d times, want the cache to answer the second", fetched)
	}
}

func TestOAuthCIMDClientSignsInByItsDocument(t *testing.T) {
	f := newOAuthFixture(t)
	f.auth.oauth.cimd = cimdTestFetcher([]netip.Addr{netip.MustParseAddr("93.184.216.34")},
		roundTripFunc(func(*http.Request) (*http.Response, error) { return jsonResponse(http.StatusOK, claudeCodeDoc), nil }))
	_, challenge := pkce()
	_, _, page := f.startConsent(t, authorizeURL(claudeCodeCIMD, "http://127.0.0.1:7777/callback", challenge, "", "s"))
	if !strings.Contains(page, "Connect Claude Code to Konnekt") || !strings.Contains(page, "Identified by claude.ai") {
		t.Errorf("page:\n%s", page)
	}
	// Its document lists loopback callbacks only.
	if w := f.get(authorizeURL(claudeCodeCIMD, RemoteClaudeRedirect, challenge, "", "s")); w.Code != http.StatusBadRequest {
		t.Errorf("hosted callback for a loopback client: %d", w.Code)
	}
	tokens := f.signIn(t, claudeCodeCIMD, "http://127.0.0.1:7777/callback", RemoteScopeRead)
	if tokens["scope"] != RemoteScopeRead {
		t.Errorf("scope %v", tokens["scope"])
	}
	grants := f.auth.Grants()
	if len(grants) != 1 || grants[0].Client != "Claude Code" || grants[0].Redirect != "127.0.0.1" {
		t.Errorf("grants %+v", grants)
	}
	// A refresh from a registered client with the same name is not the same
	// client.
	refresh, _ := tokens["refresh_token"].(string)
	other := f.register(t, "http://127.0.0.1/callback")
	if w := f.postForm(RemoteTokenPath, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {other}}, false); w.Code != http.StatusBadRequest {
		t.Errorf("refresh from another client: %d", w.Code)
	}
}
