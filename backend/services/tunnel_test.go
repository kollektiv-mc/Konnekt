package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

const tunnelHelperEnv = "KONNEKT_TUNNEL_HELPER"

// TestTunnelHelperProcess is not a test: it is the stand-in for cloudflared.
// The test binary re-executes itself with KONNEKT_TUNNEL_HELPER set to a mode,
// so no real cloudflared is ever downloaded or run.
func TestTunnelHelperProcess(t *testing.T) {
	mode := os.Getenv(tunnelHelperEnv)
	if mode == "" {
		return
	}
	noise := func() {
		fmt.Fprintln(os.Stderr, "2026-10-01T10:00:00Z INF Thank you for trying Cloudflare Tunnel")
		fmt.Fprintln(os.Stdout, "stdout noise line")
		fmt.Fprintln(os.Stderr, "2026-10-01T10:00:01Z INF Requesting new quick Tunnel on trycloudflare.com...")
	}
	switch mode {
	case "url":
		noise()
		fmt.Fprintln(os.Stderr, `Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup failed, retrying`)
		fmt.Fprintln(os.Stderr, "|  https://quiet-river-1234.trycloudflare.com  |")
		time.Sleep(time.Minute)
	case "exit":
		noise()
		fmt.Fprintln(os.Stderr, "ERR failed to request quick Tunnel")
		os.Exit(3)
	case "silent":
		time.Sleep(time.Minute)
	case "urlexit":
		fmt.Fprintln(os.Stderr, "https://quiet-river-1234.trycloudflare.com")
		time.Sleep(200 * time.Millisecond)
		os.Exit(0)
	case "longlines":
		fmt.Fprintln(os.Stderr, strings.Repeat("x", 1000))
		os.Exit(1)
	}
	os.Exit(0)
}

// tunnelFixture is a service wired to temp dirs, a fake pin, a TLS file server
// and a command constructor that runs the helper process instead of the binary.
type tunnelFixture struct {
	t       *testing.T
	svc     *TunnelService
	payload []byte
	pin     tunnelPin
	server  *httptest.Server
	handler http.HandlerFunc

	mu      sync.Mutex
	calls   [][]string
	cmds    []*exec.Cmd
	changes int
	hosts   []string // "host up" / "host down"
	mode    string
}

func newTunnelFixture(t *testing.T) *tunnelFixture {
	t.Helper()
	f := &tunnelFixture{t: t, mode: "url"}
	f.payload = []byte(strings.Repeat("not really cloudflared ", 500))
	sum := sha256.Sum256(f.payload)
	f.pin = tunnelPin{asset: "cloudflared-test", size: int64(len(f.payload)), sha256: hex.EncodeToString(sum[:])}
	f.handler = func(w http.ResponseWriter, r *http.Request) { w.Write(f.payload) }
	f.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { f.handler(w, r) }))
	t.Cleanup(f.server.Close)

	f.svc = NewTunnelService()
	f.svc.SetDataDir(t.TempDir())
	f.svc.pins = map[string]tunnelPin{runtime.GOOS + "/" + runtime.GOARCH: f.pin}
	f.svc.baseURL = f.server.URL
	f.svc.client = f.server.Client()
	f.svc.allowedHosts = []string{"127.0.0.1"}
	f.svc.urlTimeout = 5 * time.Second
	f.svc.newCmd = func(ctx context.Context, bin string, args ...string) *exec.Cmd {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, append([]string{bin}, args...))
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTunnelHelperProcess$")
		cmd.Env = append(os.Environ(), tunnelHelperEnv+"="+f.mode)
		f.cmds = append(f.cmds, cmd)
		return cmd
	}
	f.svc.OnChange(func() {
		f.mu.Lock()
		f.changes++
		f.mu.Unlock()
	})
	f.svc.OnHost(func(host string, up bool) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if up {
			f.hosts = append(f.hosts, host+" up")
		} else {
			f.hosts = append(f.hosts, host+" down")
		}
	})
	t.Cleanup(func() {
		if err := f.svc.Stop(); err != nil {
			t.Logf("cleanup Stop: %v", err)
		}
	})
	return f
}

func (f *tunnelFixture) binPath() string {
	return filepath.Join(f.svc.dataDir, "bin", tunnelBinaryName(f.pin))
}

func (f *tunnelFixture) hostEvents() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.hosts...)
}

func (f *tunnelFixture) commandCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

// waitStatus polls State until it has the wanted status or the wait runs out.
func (f *tunnelFixture) waitStatus(want string) models.TunnelState {
	f.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if s := f.svc.State(); s.Status == want {
			return s
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.t.Fatalf("status never became %q, last state %+v", want, f.svc.State())
	return models.TunnelState{}
}

func (f *tunnelFixture) installGood() {
	f.t.Helper()
	if err := os.MkdirAll(filepath.Dir(f.binPath()), 0755); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(f.binPath(), f.payload, 0755); err != nil {
		f.t.Fatal(err)
	}
}

func leftoverFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// § S8.10 and S1.3: the pin table is complete and the URL it builds can only
// be the pinned release on github.com.
func TestTunnelPinTable(t *testing.T) {
	hex64 := regexp.MustCompile(`^[0-9a-f]{64}$`)
	svc := NewTunnelService()
	if len(tunnelPins) == 0 {
		t.Fatal("no pins")
	}
	for key, p := range tunnelPins {
		if !hex64.MatchString(p.sha256) {
			t.Errorf("%s: sha256 %q is not 64 lowercase hex characters", key, p.sha256)
		}
		if p.size <= 0 {
			t.Errorf("%s: size %d", key, p.size)
		}
		if !strings.HasPrefix(p.asset, "cloudflared-") {
			t.Errorf("%s: asset %q", key, p.asset)
		}
		want := "https://github.com/cloudflare/cloudflared/releases/download/" + tunnelVersion + "/" + p.asset
		if got := svc.downloadURL(p); got != want {
			t.Errorf("%s: URL %q, want %q", key, got, want)
		}
		u, err := url.Parse(want)
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.checkDownloadURL(u); err != nil {
			t.Errorf("%s: its own URL is refused: %v", key, err)
		}
	}
}

// § S1.3: scheme and host pinning refuses anything but https on the allowlist.
func TestTunnelCheckDownloadURL(t *testing.T) {
	svc := NewTunnelService()
	for _, bad := range []string{"http://github.com/x", "https://evil.example/x", "https://github.com.evil.example/x", "ftp://github.com/x"} {
		u, err := url.Parse(bad)
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.checkDownloadURL(u); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	for _, good := range tunnelDownloadHosts {
		if err := svc.checkDownloadURL(&url.URL{Scheme: "https", Host: good}); err != nil {
			t.Errorf("%s refused: %v", good, err)
		}
	}
}

// § S1.3, S1.4, S8.10: a file whose hash matches is installed at the cache
// path, owner-executable, with no temp file left beside it.
func TestTunnelDownloadInstallsVerifiedFile(t *testing.T) {
	f := newTunnelFixture(t)
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(f.binPath())
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(f.payload) {
		t.Fatal("installed content differs")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(f.binPath())
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0100 == 0 {
			t.Fatalf("not owner-executable: %v", info.Mode())
		}
	}
	if names := leftoverFiles(t, filepath.Dir(f.binPath())); len(names) != 1 {
		t.Fatalf("expected only the binary, got %v", names)
	}
}

// § S8.10, S1.4: a body with the right size but the wrong hash is refused and
// leaves neither the file nor its temp file.
func TestTunnelDownloadRefusesHashMismatch(t *testing.T) {
	f := newTunnelFixture(t)
	tampered := append([]byte(nil), f.payload...)
	tampered[0] ^= 0xff
	f.handler = func(w http.ResponseWriter, r *http.Request) { w.Write(tampered) }
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err == nil || !strings.Contains(err.Error(), "sha256") {
		t.Fatalf("want a sha256 refusal, got %v", err)
	}
	if names := leftoverFiles(t, filepath.Dir(f.binPath())); len(names) != 0 {
		t.Fatalf("left behind: %v", names)
	}
}

// § S1.4: a body longer than the pinned size is refused, whether the server
// announces it or streams it without a length.
func TestTunnelDownloadRefusesLongerBody(t *testing.T) {
	for _, chunked := range []bool{false, true} {
		f := newTunnelFixture(t)
		long := append(append([]byte(nil), f.payload...), []byte("extra")...)
		f.handler = func(w http.ResponseWriter, r *http.Request) {
			if chunked {
				w.(http.Flusher).Flush() // headers out with no Content-Length
			}
			w.Write(long)
		}
		if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err == nil {
			t.Fatalf("chunked=%v: longer body accepted", chunked)
		}
		if names := leftoverFiles(t, filepath.Dir(f.binPath())); len(names) != 0 {
			t.Fatalf("chunked=%v: left behind: %v", chunked, names)
		}
	}
}

// § S1.4: a body shorter than the pinned size is refused.
func TestTunnelDownloadRefusesShorterBody(t *testing.T) {
	f := newTunnelFixture(t)
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		w.Write(f.payload[:len(f.payload)-10])
	}
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err == nil {
		t.Fatal("shorter body accepted")
	}
	if names := leftoverFiles(t, filepath.Dir(f.binPath())); len(names) != 0 {
		t.Fatalf("left behind: %v", names)
	}
}

// § S1.3: a redirect to a host off the allowlist is refused, a redirect to
// http:// is refused even for an allowed host, and a redirect to an allowed
// https host is followed.
func TestTunnelDownloadRedirects(t *testing.T) {
	f := newTunnelFixture(t)
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(f.payload) }))
	defer target.Close()

	redirectTo := ""
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, redirectTo, http.StatusFound)
	}

	redirectTo = "https://example.invalid/cloudflared"
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err == nil || !strings.Contains(err.Error(), "not an expected host") {
		t.Fatalf("off-allowlist redirect: %v", err)
	}

	redirectTo = "http://127.0.0.1:1/cloudflared"
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err == nil || !strings.Contains(err.Error(), "not an https URL") {
		t.Fatalf("http redirect: %v", err)
	}
	if names := leftoverFiles(t, filepath.Dir(f.binPath())); len(names) != 0 {
		t.Fatalf("left behind: %v", names)
	}

	redirectTo = target.URL + "/cloudflared"
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err != nil {
		t.Fatalf("redirect to an allowed https host: %v", err)
	}
}

// § S1.3: an https-only, allowlisted first request; a plain http base is refused
// before anything is sent.
func TestTunnelDownloadRefusesPlainHTTPBase(t *testing.T) {
	f := newTunnelFixture(t)
	f.svc.baseURL = "http://127.0.0.1:1"
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err == nil {
		t.Fatal("http base accepted")
	}
}

// § S8.10: a server error is a failure, not an install.
func TestTunnelDownloadRefusesHTTPError(t *testing.T) {
	f := newTunnelFixture(t)
	f.handler = func(w http.ResponseWriter, r *http.Request) { http.Error(w, "nope", http.StatusNotFound) }
	if err := f.svc.download(context.Background(), 0, f.pin, f.binPath()); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("got %v", err)
	}
}

// § S8.10 verify-before-exec: Start with no cached file downloads, verifies and
// runs it, and reports whole-percent progress through OnChange.
func TestTunnelStartDownloadsThenRuns(t *testing.T) {
	f := newTunnelFixture(t)
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("running")
	if _, err := os.Stat(f.binPath()); err != nil {
		t.Fatalf("binary not cached: %v", err)
	}
	if f.commandCalls() != 1 {
		t.Fatalf("command constructed %d times", f.commandCalls())
	}
}

// § S8.10 verify-before-exec: a cached file whose content was tampered with is
// not executed. With a download available it is replaced, then run.
func TestTunnelTamperedCacheIsReplaced(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	if err := os.WriteFile(f.binPath(), []byte("malicious"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("running")
	got, err := os.ReadFile(f.binPath())
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(f.payload) {
		t.Fatal("tampered file still in place")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) != 1 || f.calls[0][0] != f.binPath() {
		t.Fatalf("calls %v", f.calls)
	}
}

// § S8.10 verify-before-exec: with the tampered file and no usable download the
// command constructor is never reached and the tunnel fails.
func TestTunnelTamperedCacheWithoutDownloadFails(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	if err := os.WriteFile(f.binPath(), []byte("malicious"), 0755); err != nil {
		t.Fatal(err)
	}
	f.handler = func(w http.ResponseWriter, r *http.Request) { http.Error(w, "gone", http.StatusInternalServerError) }
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("failed")
	if s.Error == "" {
		t.Fatal("no error text")
	}
	if f.commandCalls() != 0 {
		t.Fatal("a file that failed verification was executed")
	}
	if _, err := os.Stat(f.binPath()); err == nil {
		t.Fatal("tampered file was left in place")
	}
}

// § S8.10: a good cached file is used as is, with no download.
func TestTunnelCachedFileSkipsDownload(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	downloads := 0
	f.handler = func(w http.ResponseWriter, r *http.Request) { downloads++; w.Write(f.payload) }
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("running")
	if downloads != 0 {
		t.Fatalf("downloaded %d times", downloads)
	}
}

// Run: the helper prints noise, an api.trycloudflare.com error line, then the
// real URL on stderr. Start leads to running with that URL (and not the API
// host), OnHost and OnChange fire, and Stop leads to off with the process gone
// and OnHost told it went. The exact argument list is checked too.
func TestTunnelRunsAndStops(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("running")
	if s.URL != "https://quiet-river-1234.trycloudflare.com" {
		t.Fatalf("URL %q", s.URL)
	}
	if s.Version != tunnelVersion {
		t.Fatalf("version %q", s.Version)
	}
	if got := f.hostEvents(); len(got) != 1 || got[0] != "quiet-river-1234.trycloudflare.com up" {
		t.Fatalf("host events %v", got)
	}
	f.mu.Lock()
	changes := f.changes
	call := append([]string(nil), f.calls[0]...)
	cmd := f.cmds[0]
	f.mu.Unlock()
	if changes == 0 {
		t.Fatal("OnChange never fired")
	}
	want := []string{"tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:54321"}
	if got := call[1:]; strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("args %v, want %v", got, want)
	}

	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if s := f.svc.State(); s.Status != "off" || s.URL != "" {
		t.Fatalf("after Stop: %+v", s)
	}
	if cmd.ProcessState == nil {
		t.Fatal("the process was not reaped")
	}
	if got := f.hostEvents(); len(got) != 2 || got[1] != "quiet-river-1234.trycloudflare.com down" {
		t.Fatalf("host events %v", got)
	}
}

// The service can be started again after Stop.
func TestTunnelRestartsAfterStop(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	for i := 0; i < 2; i++ {
		if err := f.svc.Start("127.0.0.1:54321"); err != nil {
			t.Fatalf("start %d: %v", i, err)
		}
		f.waitStatus("running")
		if err := f.svc.Stop(); err != nil {
			t.Fatal(err)
		}
	}
	if got := f.hostEvents(); len(got) != 4 {
		t.Fatalf("host events %v", got)
	}
}

// A helper that exits without a URL leads to failed, with its last lines in
// Error and no OnHost call.
func TestTunnelFailsWhenProcessExitsWithoutURL(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	f.mode = "exit"
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("failed")
	for _, want := range []string{"exited before it printed a tunnel URL", "failed to request quick Tunnel", "stdout noise line"} {
		if !strings.Contains(s.Error, want) {
			t.Errorf("error lacks %q: %q", want, s.Error)
		}
	}
	if got := f.hostEvents(); len(got) != 0 {
		t.Fatalf("host events %v", got)
	}
}

// Output is bounded before it reaches the UI: a long line is clamped and a
// line past the scanner's limit does not wedge the process.
func TestTunnelClampsOutputLines(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	f.mode = "longlines"
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("failed")
	if strings.Contains(s.Error, strings.Repeat("x", tunnelTailWidth+1)) {
		t.Fatalf("line not clamped: %d characters of error", len(s.Error))
	}
}

func TestTunnelTailKeepsLastLines(t *testing.T) {
	if got := clampLine(strings.Repeat("é", 400)); len([]rune(got)) != tunnelTailWidth+3 {
		t.Fatalf("clamped to %d runes", len([]rune(got)))
	}
	if got := clampLine("short"); got != "short" {
		t.Fatal(got)
	}
}

// A helper that prints nothing leads to failed after the shortened URL timeout,
// and the process is killed.
func TestTunnelFailsWhenNoURLAppears(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	f.mode = "silent"
	f.svc.urlTimeout = 300 * time.Millisecond
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("failed")
	if !strings.Contains(s.Error, "no tunnel URL") {
		t.Fatalf("error %q", s.Error)
	}
	f.mu.Lock()
	cmd := f.cmds[0]
	f.mu.Unlock()
	if cmd.ProcessState == nil {
		t.Fatal("the silent process was left running")
	}
}

// A helper that prints the URL and then exits leads to failed, and OnHost is
// told the host went.
func TestTunnelFailsWhenProcessDiesWhileRunning(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	f.mode = "urlexit"
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	s := f.waitStatus("failed")
	if !strings.Contains(s.Error, "stopped unexpectedly") || s.URL != "" {
		t.Fatalf("state %+v", s)
	}
	got := f.hostEvents()
	if len(got) != 2 || got[0] != "quiet-river-1234.trycloudflare.com up" || got[1] != "quiet-river-1234.trycloudflare.com down" {
		t.Fatalf("host events %v", got)
	}
	// Stop resets a failed tunnel to off.
	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if s := f.svc.State(); s.Status != "off" || s.Error != "" {
		t.Fatalf("after Stop: %+v", s)
	}
}

// Start refuses an address that is not host:port on loopback: the tunnel must
// never be pointed anywhere else.
func TestTunnelStartRefusesNonLoopback(t *testing.T) {
	f := newTunnelFixture(t)
	for _, addr := range []string{"192.168.1.5:80", "example.com:80", "127.0.0.1", "0.0.0.0:80", "127.0.0.1:0", "127.0.0.1:abc", "", "[::1]:80"} {
		if err := f.svc.Start(addr); !errors.Is(err, ErrTunnelBadAddr) {
			t.Errorf("%q: got %v", addr, err)
		}
	}
	if s := f.svc.State(); s.Status != "off" {
		t.Fatalf("state %+v", s)
	}
	if f.commandCalls() != 0 {
		t.Fatal("a command was built")
	}
}

func TestTunnelStartAcceptsLocalhost(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	if err := f.svc.Start("localhost:54321"); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("running")
}

// A second Start while one is in flight is refused.
func TestTunnelStartRefusesWhileRunning(t *testing.T) {
	f := newTunnelFixture(t)
	f.installGood()
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Start("127.0.0.1:54321"); !errors.Is(err, ErrTunnelRunning) {
		t.Fatalf("second Start while starting: %v", err)
	}
	f.waitStatus("running")
	if err := f.svc.Start("127.0.0.1:54321"); !errors.Is(err, ErrTunnelRunning) {
		t.Fatalf("second Start while running: %v", err)
	}
}

func TestTunnelStartRefusesWithoutDataDir(t *testing.T) {
	f := newTunnelFixture(t)
	f.svc.SetDataDir("")
	if err := f.svc.Start("127.0.0.1:54321"); !errors.Is(err, ErrTunnelNoDataDir) {
		t.Fatalf("got %v", err)
	}
}

func TestTunnelStartRefusesUnsupportedPlatform(t *testing.T) {
	f := newTunnelFixture(t)
	f.svc.pins = map[string]tunnelPin{}
	if err := f.svc.Start("127.0.0.1:54321"); !errors.Is(err, ErrTunnelUnsupported) {
		t.Fatalf("got %v", err)
	}
}

// Stop cancels a download in progress and leaves the state off, with no file
// installed.
func TestTunnelStopCancelsDownload(t *testing.T) {
	f := newTunnelFixture(t)
	release := make(chan struct{})
	started := make(chan struct{})
	var once sync.Once
	f.handler = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(len(f.payload)))
		w.Write(f.payload[:100])
		w.(http.Flusher).Flush()
		once.Do(func() { close(started) })
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}
	defer close(release)
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("downloading")
	<-started
	if err := f.svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if s := f.svc.State(); s.Status != "off" {
		t.Fatalf("state %+v", s)
	}
	if _, err := os.Stat(f.binPath()); err == nil {
		t.Fatal("a partial file was installed")
	}
	if f.commandCalls() != 0 {
		t.Fatal("ran after a cancelled download")
	}
}

// Download progress is reported as a percent while downloading.
func TestTunnelReportsDownloadProgress(t *testing.T) {
	f := newTunnelFixture(t)
	var mu sync.Mutex
	var seen []int
	f.svc.OnChange(func() {
		s := f.svc.State()
		mu.Lock()
		defer mu.Unlock()
		if s.Status == "downloading" {
			seen = append(seen, s.Percent)
		}
	})
	if err := f.svc.Start("127.0.0.1:54321"); err != nil {
		t.Fatal(err)
	}
	f.waitStatus("running")
	mu.Lock()
	defer mu.Unlock()
	if len(seen) == 0 {
		t.Fatal("no downloading state observed")
	}
	if last := seen[len(seen)-1]; last < 0 || last > 100 {
		t.Fatalf("percent %d", last)
	}
}

// Stop when nothing runs returns nil.
func TestTunnelStopWhenIdle(t *testing.T) {
	svc := NewTunnelService()
	if err := svc.Stop(); err != nil {
		t.Fatal(err)
	}
	if s := svc.State(); s.Status != "off" || s.Version != tunnelVersion {
		t.Fatalf("state %+v", s)
	}
}

func TestTunnelFindURL(t *testing.T) {
	cases := map[string]string{
		"|  https://quiet-river-1234.trycloudflare.com  |":                     "https://quiet-river-1234.trycloudflare.com",
		`Post "https://api.trycloudflare.com/tunnel": EOF`:                     "",
		"api https://api.trycloudflare.com then https://a-b.trycloudflare.com": "https://a-b.trycloudflare.com",
		"https://example.com":                      "",
		"https://evil.example/x.trycloudflare.com": "",
	}
	for line, want := range cases {
		if got := findTunnelURL(line); got != want {
			t.Errorf("%q: got %q, want %q", line, got, want)
		}
	}
}
