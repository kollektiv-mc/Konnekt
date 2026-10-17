package services

import (
	"errors"
	"testing"
	"time"
)

// Grants (§ S9.5): a token is good for one resource for an hour, nothing else
// is, and a password change ends them all.

const testResource = "https://dash.test/mcp"

func issueTestGrant(t *testing.T, a *RemoteAuth, client string, scopes ...string) (id, token string) {
	t.Helper()
	id, token, err := a.IssueGrant(client, scopes, testResource)
	if err != nil {
		t.Fatal(err)
	}
	return id, token
}

func TestGrantTokenIsGoodForItsResourceOnly(t *testing.T) {
	a, clock := newTestAuthClock(t, t.TempDir())
	id, token := issueTestGrant(t, a, "Claude Code", RemoteScopeRead)

	g, err := a.AuthorizeBearer(token, testResource)
	if err != nil || g.ID != id || g.Client != "Claude Code" || len(g.Scopes) != 1 || g.Scopes[0] != RemoteScopeRead {
		t.Fatalf("authorize = %+v, %v", g, err)
	}
	if _, err := a.AuthorizeBearer(token, "HTTPS://DASH.TEST/mcp"); err != nil {
		t.Errorf("resource host case: %v", err)
	}
	for name, tc := range map[string]struct{ token, resource string }{
		"other host":   {token, "https://other.test/mcp"},
		"other path":   {token, "https://dash.test/api/rpc"},
		"other scheme": {token, "http://dash.test/mcp"},
		"wrong token":  {token[:len(token)-1] + "x", testResource},
		"empty token":  {"", testResource},
	} {
		if _, err := a.AuthorizeBearer(tc.token, tc.resource); !errors.Is(err, ErrRemoteBearer) {
			t.Errorf("%s: %v, want ErrRemoteBearer", name, err)
		}
	}

	*clock = clock.Add(remoteAccessTokenTTL - time.Second)
	if _, err := a.AuthorizeBearer(token, testResource); err != nil {
		t.Errorf("just before expiry: %v", err)
	}
	*clock = clock.Add(2 * time.Second)
	if _, err := a.AuthorizeBearer(token, testResource); !errors.Is(err, ErrRemoteBearer) {
		t.Errorf("after expiry: %v", err)
	}
	if got := a.Grants(); len(got) != 0 {
		t.Errorf("expired grant still listed: %+v", got)
	}
}

func TestGrantsPersistAndRevoke(t *testing.T) {
	dir := t.TempDir()
	a := newTestAuthIn(t, dir)
	id, token := issueTestGrant(t, a, "claude.ai", RemoteScopeRead, RemoteScopeOperate)
	if _, _, err := a.IssueGrant("Claude Code", []string{RemoteScopeOperate}, testResource); err != nil {
		t.Fatal(err)
	}
	if err := a.SetConnectorsEnabled(true); err != nil {
		t.Fatal(err)
	}

	again := newTestAuthIn(t, dir)
	if !again.ConnectorsEnabled() {
		t.Error("the switch did not survive a restart")
	}
	listed := again.Grants()
	if len(listed) != 2 || listed[0].Client != "claude.ai" || len(listed[0].Scopes) != 2 || listed[0].ExpiresAt == 0 {
		t.Fatalf("grants after restart: %+v", listed)
	}
	if _, err := again.AuthorizeBearer(token, testResource); err != nil {
		t.Errorf("token after restart: %v", err)
	}
	if err := again.RevokeGrant(id); err != nil {
		t.Fatal(err)
	}
	if _, err := again.AuthorizeBearer(token, testResource); !errors.Is(err, ErrRemoteBearer) {
		t.Errorf("revoked token: %v", err)
	}
	if err := again.RevokeGrant(id); !errors.Is(err, ErrRemoteGrantUnknown) {
		t.Errorf("revoking twice: %v", err)
	}
	if got := newTestAuthIn(t, dir).Grants(); len(got) != 1 || got[0].Client != "Claude Code" {
		t.Errorf("after revoke and restart: %+v", got)
	}
}

// "Revoke all" in Settings (#515) ends every grant at once; with none to end
// it is a no-op, and a grant the user issued by hand carries no redirect host.
func TestRevokeGrantsEndsEveryGrant(t *testing.T) {
	dir := t.TempDir()
	a := newTestAuthIn(t, dir)
	if err := a.RevokeGrants(); err != nil {
		t.Fatalf("with nothing to revoke: %v", err)
	}
	_, first := issueTestGrant(t, a, "claude.ai", RemoteScopeRead)
	_, second := issueTestGrant(t, a, "Claude Code", RemoteScopeOperate)
	if got := a.Grants(); len(got) != 2 || got[0].Redirect != "" {
		t.Fatalf("before: %+v", got)
	}
	if err := a.RevokeGrants(); err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{first, second} {
		if _, err := a.AuthorizeBearer(token, testResource); !errors.Is(err, ErrRemoteBearer) {
			t.Errorf("token after revoke all: %v", err)
		}
	}
	if got := newTestAuthIn(t, dir).Grants(); len(got) != 0 {
		t.Errorf("after restart: %+v", got)
	}
}

// A grant was consented to with the password; a new password ends it, as it
// ends every session (#514).
func TestPasswordChangeEndsEveryGrant(t *testing.T) {
	a, _ := newPasswordAuthClock(t)
	_, token := issueTestGrant(t, a, "claude.ai", RemoteScopeRead)
	if err := a.SetPassword(testPassword + "2"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.AuthorizeBearer(token, testResource); !errors.Is(err, ErrRemoteBearer) {
		t.Errorf("token after password change: %v", err)
	}
	if got := a.Grants(); len(got) != 0 {
		t.Errorf("grants after password change: %+v", got)
	}
}

func TestIssueGrantRefusesBadInput(t *testing.T) {
	a := newTestAuth(t)
	cases := map[string]struct {
		scopes   []string
		resource string
		want     error
	}{
		"no scope":        {nil, testResource, ErrRemoteScope},
		"unknown scope":   {[]string{"konnekt:admin"}, testResource, ErrRemoteScope},
		"mixed scope":     {[]string{RemoteScopeRead, "admin"}, testResource, ErrRemoteScope},
		"not the mcp url": {[]string{RemoteScopeRead}, "https://dash.test/", ErrRemoteResource},
		"no scheme":       {[]string{RemoteScopeRead}, "dash.test/mcp", ErrRemoteResource},
	}
	for name, tc := range cases {
		if _, _, err := a.IssueGrant("x", tc.scopes, tc.resource); !errors.Is(err, tc.want) {
			t.Errorf("%s: %v, want %v", name, err, tc.want)
		}
	}
	// The client name is third-party text: clamped and printable.
	id, _ := issueTestGrant(t, a, "a\x00b"+string(make([]byte, 0))+"\tc "+string(repeatRune('x', 200)), RemoteScopeRead)
	for _, g := range a.Grants() {
		if g.ID == id && (len(g.Client) > remoteClientNameMax || g.Client == "" || containsControl(g.Client)) {
			t.Errorf("client name %q", g.Client)
		}
	}
	for i := 0; i < remoteMaxGrants; i++ {
		if _, _, err := a.IssueGrant("n", []string{RemoteScopeRead}, testResource); err != nil && i < remoteMaxGrants-1 {
			t.Fatalf("grant %d: %v", i, err)
		} else if i == remoteMaxGrants-1 && !errors.Is(err, ErrRemoteGrantsFull) {
			t.Errorf("grant past the cap: %v", err)
		}
	}
}

func repeatRune(r rune, n int) []rune {
	out := make([]rune, n)
	for i := range out {
		out[i] = r
	}
	return out
}

func containsControl(s string) bool {
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

func TestRemoteResourceFollowsTheHost(t *testing.T) {
	for host, want := range map[string]string{
		"dash.example.net":    "https://dash.example.net/mcp",
		"Dash.Example.NET":    "https://dash.example.net/mcp",
		"127.0.0.1:8080":      "http://127.0.0.1:8080/mcp",
		"localhost:8080":      "http://localhost:8080/mcp",
		"[::1]:8080":          "http://[::1]:8080/mcp",
		"evil.example:8080":   "https://evil.example:8080/mcp",
		"localhost.evil.test": "https://localhost.evil.test/mcp",
	} {
		if got := RemoteResource(host); got != want {
			t.Errorf("RemoteResource(%q) = %q, want %q", host, got, want)
		}
	}
	if got := remoteResourceMetadataURL("dash.test"); got != "https://dash.test/.well-known/oauth-protected-resource" {
		t.Errorf("metadata URL %q", got)
	}
}
