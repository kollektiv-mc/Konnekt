package services

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
)

// The named tunnel (#512, agent_docs/SECURITY_CHECKLIST.md § S9.8): the token
// reaches cloudflared by file and never by argument or log line, the hostname
// is answered only while the tunnel runs, and the devices approved on it
// survive the tunnel going down.

const (
	namedHost  = "dash.example.net"
	namedPort  = 48321
	namedToken = "eyJhIjoiYWNjb3VudCIsInQiOiJ0dW5uZWwiLCJzIjoic2VjcmV0In0"
)

// captureLogs points the default logger at a buffer for the test, at Info,
// which is what a packaged build writes.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func TestTunnelNamedPassesTheTokenByFileOnly(t *testing.T) {
	logs := captureLogs(t)
	f := newTunnelFixture(t)
	f.installGood()
	f.mode, f.token = "named", namedToken
	if err := f.svc.SaveNamed("Dash.Example.NET", namedPort, namedToken); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.Named(); got.Hostname != namedHost || got.Port != namedPort || !got.TokenSet {
		t.Fatalf("Named() = %+v", got)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(f.svc.dataDir, tunnelTokenFile))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("token file mode %v, want 0600 (§ S2.2)", info.Mode().Perm())
		}
	}

	if err := f.svc.Start("127.0.0.1:48321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("running")
	if s.URL != "https://"+namedHost || s.Named.Hostname != namedHost {
		t.Fatalf("state %+v", s)
	}
	f.mu.Lock()
	call := append([]string(nil), f.calls[0]...)
	f.mu.Unlock()
	args := strings.Join(call[1:], " ")
	if !strings.Contains(args, "run --token-file "+filepath.Join(f.svc.dataDir, tunnelTokenFile)) ||
		strings.Contains(args, "--url") || strings.Contains(args, namedToken) {
		t.Errorf("args %q", args)
	}
	if got := f.hostEvents(); len(got) != 1 || got[0] != namedHost+" up" {
		t.Fatalf("host events %v", got)
	}

	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	// Down, but not gone: the hostname comes back on the next run.
	if got := f.hostEvents(); len(got) != 2 || got[1] != namedHost+" down, kept" {
		t.Fatalf("host events %v", got)
	}
	if strings.Contains(logs.String(), namedToken) {
		t.Errorf("the token is in the log:\n%s", logs.String())
	}
	if !strings.Contains(logs.String(), "named tunnel saved") {
		t.Errorf("the save was not logged:\n%s", logs.String())
	}
}

// What the saved configuration survives: a new service over the same data
// directory reads it back, and a forgotten one is gone, files included.
func TestTunnelNamedConfigPersistsUntilForgotten(t *testing.T) {
	f := newTunnelFixture(t)
	if err := f.svc.SaveNamed(namedHost, namedPort, namedToken); err != nil {
		t.Fatal(err)
	}
	again := NewTunnelService()
	again.SetDataDir(f.svc.dataDir)
	if got := again.Named(); got != f.svc.Named() || !got.TokenSet {
		t.Fatalf("reloaded %+v, saved %+v", got, f.svc.Named())
	}
	// A new port with the token kept.
	if err := f.svc.SaveNamed(namedHost, namedPort+1, ""); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.Named(); got.Port != namedPort+1 || !got.TokenSet {
		t.Fatalf("after a port change: %+v", got)
	}
	// A new hostname forgets the devices on the old one.
	if err := f.svc.SaveNamed("other.example.net", namedPort, ""); err != nil {
		t.Fatal(err)
	}
	if got := f.hostEvents(); len(got) != 1 || got[0] != namedHost+" down" {
		t.Fatalf("host events after a hostname change: %v", got)
	}

	if err := f.svc.ForgetNamed(); err != nil {
		t.Fatal(err)
	}
	if got := f.svc.Named(); got.Hostname != "" || got.Port != 0 || got.TokenSet {
		t.Fatalf("after forget: %+v", got)
	}
	for _, name := range []string{tunnelTokenFile, tunnelConfigFile} {
		if _, err := os.Stat(filepath.Join(f.svc.dataDir, name)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s is still there after forget: %v", name, err)
		}
	}
	if got := f.hostEvents(); len(got) != 2 || got[1] != "other.example.net down" {
		t.Fatalf("host events after forget: %v", got)
	}
	// With nothing configured the switch runs a quick tunnel again.
	f.installGood()
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	if s := f.waitStatus("running"); !strings.HasSuffix(s.URL, ".trycloudflare.com") {
		t.Errorf("after forget the tunnel ran as %q", s.URL)
	}
}

func TestTunnelSaveNamedRefusesBadInput(t *testing.T) {
	f := newTunnelFixture(t)
	cases := map[string]struct {
		host  string
		port  int
		token string
		want  error
	}{
		"wildcard":       {"*.example.net", namedPort, namedToken, ErrTunnelBadHostname},
		"scheme":         {"https://dash.example.net", namedPort, namedToken, ErrTunnelBadHostname},
		"port in host":   {"dash.example.net:443", namedPort, namedToken, ErrTunnelBadHostname},
		"one label":      {"localhost", namedPort, namedToken, ErrTunnelBadHostname},
		"empty label":    {"dash..example.net", namedPort, namedToken, ErrTunnelBadHostname},
		"leading hyphen": {"-dash.example.net", namedPort, namedToken, ErrTunnelBadHostname},
		"long label":     {strings.Repeat("a", 64) + ".example.net", namedPort, namedToken, ErrTunnelBadHostname},
		"unicode":        {"dash.exämple.net", namedPort, namedToken, ErrTunnelBadHostname},
		"empty":          {"", namedPort, namedToken, ErrTunnelBadHostname},
		"low port":       {namedHost, 80, namedToken, ErrTunnelBadPort},
		"high port":      {namedHost, 70000, namedToken, ErrTunnelBadPort},
		"no token yet":   {namedHost, namedPort, "", ErrTunnelBadToken},
		"token newline":  {namedHost, namedPort, "abc\ndef", ErrTunnelBadToken},
		"token space":    {namedHost, namedPort, "abc def", ErrTunnelBadToken},
		"token long":     {namedHost, namedPort, strings.Repeat("a", tunnelTokenMax+1), ErrTunnelBadToken},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if err := f.svc.SaveNamed(tc.host, tc.port, tc.token); !errors.Is(err, tc.want) {
				t.Errorf("got %v, want %v", err, tc.want)
			}
		})
	}
	if got := f.svc.Named(); got.Hostname != "" || got.TokenSet {
		t.Errorf("a refused save left %+v", got)
	}
	if _, err := os.Stat(filepath.Join(f.svc.dataDir, tunnelTokenFile)); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("a refused save wrote the token file: %v", err)
	}
}

// The listener has to be on the port the dashboard's ingress names, and the
// configuration cannot change under a live run.
func TestTunnelNamedHoldsThePortAndTheRun(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	f.mode, f.token = "named", namedToken
	if err := f.svc.SaveNamed(namedHost, namedPort, namedToken); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Start("127.0.0.1:54321"); !errors.Is(err, ErrTunnelPortMismatch) {
		t.Fatalf("start on another port: %v", err)
	}
	if err := f.svc.Start("127.0.0.1:48321"); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("running")
	if err := f.svc.SaveNamed(namedHost, namedPort, ""); !errors.Is(err, ErrTunnelRunning) {
		t.Errorf("save while running: %v", err)
	}
	if err := f.svc.ForgetNamed(); !errors.Is(err, ErrTunnelRunning) {
		t.Errorf("forget while running: %v", err)
	}
	if f.commandCalls() != 1 {
		t.Errorf("%d commands ran", f.commandCalls())
	}
}

// A named run that dies before it registers fails like a quick one, and the
// hostname is never allowed.
func TestTunnelNamedFailsWithoutRegistering(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	f.mode, f.token = "named", "not-the-token"
	if err := f.svc.SaveNamed(namedHost, namedPort, namedToken); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Start("127.0.0.1:48321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("failed")
	if !strings.Contains(s.Error, "exited before it connected") || !strings.Contains(s.Error, "token file") {
		t.Errorf("error %q", s.Error)
	}
	if got := f.hostEvents(); len(got) != 0 {
		t.Errorf("host events %v", got)
	}
}

func TestValidTunnelHostnameLowercases(t *testing.T) {
	got, err := ValidTunnelHostname("  Dash.Example.NET ")
	if err != nil || got != namedHost {
		t.Fatalf("got %q, %v", got, err)
	}
}

// BindTunnel on a named hostname: the devices approved through it are kept
// when the tunnel goes down and the hostname stops being answered, then go
// when the tunnel is forgotten.
func TestBindTunnelKeepsDevicesOnANamedHost(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	f.mode, f.token = "named", namedToken
	d, err := NewRemoteDispatcher(&remoteTarget{}, remoteTargetAllow)
	if err != nil {
		t.Fatal(err)
	}
	remote := NewRemoteService(NewEventBus(), d)
	auth := newPasswordAuth(t)
	remote.SetAuthorizer(auth)
	var changes atomic.Int32
	BindTunnel(remote, auth, f.svc, func() { changes.Add(1) })

	addr, err := remote.Start(0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := remote.Stop(); err != nil {
			t.Error(err)
		}
	})
	_, port, err := splitPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SaveNamed(namedHost, port, namedToken); err != nil {
		t.Fatal(err)
	}
	throughTunnel := func() int {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Host = namedHost
		return do(remote.Handler(), r).Code
	}
	if code := throughTunnel(); code != http.StatusForbidden {
		t.Fatalf("the named hostname answered %d before the tunnel was up", code)
	}
	if err := f.svc.Start(addr); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("running")
	if code := throughTunnel(); code == http.StatusForbidden {
		t.Fatal("the named hostname is refused while the tunnel is up")
	}

	r := jsonRequest("/api/login", loginJSON(t, testPassword))
	r.Host = namedHost
	w := httptest.NewRecorder()
	auth.ServeLogin(w, r)
	expectStatus(t, "sign-in", w, http.StatusAccepted)
	if err := auth.ApproveDevice(requestForCode(t, auth, w).ID, "Phone"); err != nil {
		t.Fatal(err)
	}
	w2 := postWait(auth, findCookie(w, remoteDeviceCookie))
	expectStatus(t, "collect", w2, http.StatusNoContent)
	session := findCookie(w2, remoteSessionCookie)

	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if code := throughTunnel(); code != http.StatusForbidden {
		t.Errorf("the named hostname answers %d while the tunnel is down", code)
	}
	if n := len(auth.Devices()); n != 1 {
		t.Fatalf("%d devices after the named tunnel closed, want the phone kept", n)
	}
	if _, err := authorizeWith(auth, session); err != nil {
		t.Errorf("the phone's session ended with the tunnel: %v", err)
	}

	if err := f.svc.ForgetNamed(); err != nil {
		t.Fatal(err)
	}
	if n := len(auth.Devices()); n != 0 {
		t.Errorf("%d devices after the named tunnel was forgotten", n)
	}
	if _, err := authorizeWith(auth, session); err == nil {
		t.Error("a session on the forgotten hostname still stands")
	}
}
