package services

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"konnekt/backend/models"
)

// The tunnel is Cloudflare's cloudflared run as a child process in "quick
// tunnel" mode: it prints a public https://<name>.trycloudflare.com URL and
// proxies it to the loopback listener RemoteService owns. TLS ends at
// Cloudflare's edge.
//
// The binary is code Konnekt executes, so it is treated like every other
// download here (agent_docs/SECURITY_CHECKLIST.md § S1) and § S8.10 on top:
// the version and the SHA-256 of each platform's asset are pinned in this
// file, so moving to a new release is a code change somebody reviews, and the
// file is hashed again right before every execution.

// tunnelVersion is the pinned cloudflared release.
const tunnelVersion = "2026.9.3"

// tunnelReleaseBase is where a release's assets live. The download URL is built
// from this, tunnelVersion and a pin's asset name, and from nothing else.
const tunnelReleaseBase = "https://github.com/cloudflare/cloudflared/releases/download"

// tunnelPin is one platform's pinned asset: its name, exact byte size and
// SHA-256 as lowercase hex.
type tunnelPin struct {
	asset  string
	size   int64
	sha256 string
}

// tunnelPins is keyed runtime.GOOS + "/" + runtime.GOARCH. macOS is absent on
// purpose: Cloudflare ships it as a .tgz and this project does not build for it
// today, so it reports ErrTunnelUnsupported rather than guess at an unpacking.
var tunnelPins = map[string]tunnelPin{
	"windows/amd64": {
		asset:  "cloudflared-windows-amd64.exe",
		size:   55366080,
		sha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
	},
	"linux/amd64": {
		asset:  "cloudflared-linux-amd64",
		size:   40122749,
		sha256: "77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2",
	},
	"linux/arm64": {
		asset:  "cloudflared-linux-arm64",
		size:   37685657,
		sha256: "aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d",
	},
}

// tunnelDownloadHosts are the hosts a release asset may be served from: GitHub
// itself and the two it redirects release downloads to.
var tunnelDownloadHosts = []string{
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
}

const (
	// tunnelDownloadTimeout bounds the whole download, body included, so a
	// server that stalls cannot hold the goroutine for ever (§ S1.4).
	tunnelDownloadTimeout = 10 * time.Minute
	// tunnelURLTimeout is how long cloudflared gets to print its URL. Quick
	// tunnels usually come up in a few seconds; this covers a slow edge.
	tunnelURLTimeout = 45 * time.Second
	// tunnelStopTimeout bounds how long Stop waits for the process to be gone.
	tunnelStopTimeout = 5 * time.Second
	tunnelMaxRedirect = 5
	tunnelTailLines   = 20
	tunnelTailWidth   = 300

	// tunnelAPIHost is cloudflared's own control endpoint. It appears in error
	// lines ("Post https://api.trycloudflare.com/tunnel: ...") and matches the
	// URL pattern, so it must never be taken for the tunnel.
	tunnelAPIHost = "api.trycloudflare.com"
)

var tunnelURLPattern = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

var (
	ErrTunnelRunning     = errors.New("the tunnel is already running")
	ErrTunnelUnsupported = errors.New("the tunnel is not available on this platform")
	ErrTunnelNoDataDir   = errors.New("the data directory is not set")
	ErrTunnelBadAddr     = errors.New("the tunnel only forwards to a loopback address")
)

// TunnelService runs and supervises cloudflared. The mutex guards the fields
// below it; OnChange and OnHost are called with it released, so a callback may
// call State.
type TunnelService struct {
	mu       sync.Mutex
	dataDir  string
	state    models.TunnelState
	onChange func()
	onHost   func(host string, up bool)

	// gen counts runs. A run's goroutine reports only while its gen is still
	// current, so a run Stop has cut off cannot write over its successor.
	gen    uint64
	cancel context.CancelFunc
	done   chan struct{} // closed when the current run's goroutine returns
	pid    int           // the live cloudflared, 0 when none
	host   string        // the public hostname while it is up

	// Seams for tests.
	pins         map[string]tunnelPin
	baseURL      string
	client       *http.Client
	allowedHosts []string
	newCmd       func(ctx context.Context, bin string, args ...string) *exec.Cmd
	urlTimeout   time.Duration
}

func NewTunnelService() *TunnelService {
	return &TunnelService{
		state:        models.TunnelState{Status: "off", Version: tunnelVersion},
		pins:         tunnelPins,
		baseURL:      tunnelReleaseBase,
		client:       &http.Client{Timeout: tunnelDownloadTimeout},
		allowedHosts: tunnelDownloadHosts,
		newCmd:       exec.CommandContext,
		urlTimeout:   tunnelURLTimeout,
	}
}

// SetDataDir sets where the binary is cached: <dir>/bin/cloudflared-<version>.
func (t *TunnelService) SetDataDir(dir string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.dataDir = dir
}

// OnChange registers what to tell when State changes. Called with t.mu released.
func (t *TunnelService) OnChange(fn func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.onChange = fn
}

// OnHost registers who is told the public hostname: up=true when the tunnel
// comes up, up=false when it goes. The remote listener uses it to accept that
// Host header and no other. Called with t.mu released.
func (t *TunnelService) OnHost(fn func(host string, up bool)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.onHost = fn
}

// BindTunnel ties a tunnel to the listener it carries and to who may sign in
// through it. changed is told of anything the desktop shows.
//
//   - The tunnel's hostname is one the listener answers to while the tunnel is
//     up, and at no other time (§ S8.3).
//   - Devices approved on that hostname are forgotten when it goes: their
//     cookies are bound to a name that will not come back.
//   - The tunnel does not outlive the listener. When the listener stops, by
//     hand or by its idle stop (§ S8.8), the tunnel is stopped with it; left
//     up, it would publish a URL that answers nothing.
func BindTunnel(remote *RemoteService, auth *RemoteAuth, tunnel *TunnelService, changed func()) {
	tunnel.OnChange(changed)
	tunnel.OnHost(func(host string, up bool) {
		if up {
			remote.AllowHost(host)
			return
		}
		remote.DisallowHost(host)
		auth.ForgetHost(host)
	})
	remote.OnChange(func() {
		changed()
		if remote.Running() {
			return
		}
		if err := tunnel.Stop(); err != nil {
			slog.Warn("tunnel: stop with the listener", "error", err)
		}
	})
}

func (t *TunnelService) State() models.TunnelState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.state
}

func (t *TunnelService) pin() (tunnelPin, bool) {
	p, ok := t.pins[runtime.GOOS+"/"+runtime.GOARCH]
	return p, ok
}

// validTunnelTarget accepts only host:port with a loopback host. The tunnel
// exposes whatever it points at to the internet, so it must never be pointed
// at a LAN address or another machine.
func validTunnelTarget(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("%w: %q", ErrTunnelBadAddr, addr)
	}
	if host != "127.0.0.1" && host != "localhost" {
		return fmt.Errorf("%w: %q", ErrTunnelBadAddr, addr)
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return fmt.Errorf("%w: %q", ErrTunnelBadAddr, addr)
	}
	return nil
}

// Start brings the tunnel up in the background and returns as soon as the work
// is started, not when the URL is known: State reports the progress.
func (t *TunnelService) Start(localAddr string) error {
	if err := validTunnelTarget(localAddr); err != nil {
		return err
	}
	pin, ok := t.pin()
	if !ok {
		return ErrTunnelUnsupported
	}

	t.mu.Lock()
	switch t.state.Status {
	case "downloading", "starting", "running":
		t.mu.Unlock()
		return ErrTunnelRunning
	}
	if t.dataDir == "" {
		t.mu.Unlock()
		return ErrTunnelNoDataDir
	}
	t.gen++
	gen := t.gen
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	t.cancel, t.done, t.pid, t.host = cancel, done, 0, ""
	t.state = models.TunnelState{Status: "starting", Version: tunnelVersion}
	binPath := filepath.Join(t.dataDir, "bin", tunnelBinaryName(pin))
	cb := t.onChange
	t.mu.Unlock()

	if cb != nil {
		cb()
	}
	go func() {
		defer close(done)
		defer cancel()
		t.run(ctx, cancel, gen, pin, binPath, localAddr)
	}()
	return nil
}

// Stop ends the tunnel: cancels a download, kills the process tree and waits
// for it to go. It is safe when nothing runs, and from "failed" it just resets
// the state to "off".
func (t *TunnelService) Stop() error {
	t.mu.Lock()
	if t.cancel == nil && t.state.Status == "off" {
		t.mu.Unlock()
		return nil
	}
	// Bumping the generation first means nothing the old run reports from here
	// on lands, including its own exit being read as an unexpected one.
	t.gen++
	cancel, done, pid := t.cancel, t.done, t.pid
	t.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if pid != 0 {
		killTree(pid)
	}
	var waitErr error
	if done != nil {
		select {
		case <-done:
		case <-time.After(tunnelStopTimeout):
			waitErr = errors.New("the tunnel process did not exit in time")
			slog.Warn("tunnel: stop timed out waiting for cloudflared", "pid", pid)
		}
	}

	t.mu.Lock()
	host := t.host
	t.cancel, t.done, t.pid, t.host = nil, nil, 0, ""
	t.state = models.TunnelState{Status: "off", Version: tunnelVersion}
	cb, hostCb := t.onChange, t.onHost
	t.mu.Unlock()

	if host != "" && hostCb != nil {
		hostCb(host, false)
	}
	if cb != nil {
		cb()
	}
	return waitErr
}

// set applies fn to the state if gen is still the current run, then tells
// OnChange with the lock released. It reports whether it applied.
func (t *TunnelService) set(gen uint64, fn func(*models.TunnelState)) bool {
	t.mu.Lock()
	if gen != t.gen {
		t.mu.Unlock()
		return false
	}
	fn(&t.state)
	cb := t.onChange
	t.mu.Unlock()
	if cb != nil {
		cb()
	}
	return true
}

// up records the public URL and tells OnHost, for the current run only.
func (t *TunnelService) up(gen uint64, rawURL, host string) {
	t.mu.Lock()
	if gen != t.gen {
		t.mu.Unlock()
		return
	}
	t.host = host
	t.state.Status = "running"
	t.state.URL = rawURL
	t.state.Error = ""
	t.state.Percent = 0
	cb, hostCb := t.onChange, t.onHost
	t.mu.Unlock()
	if hostCb != nil {
		hostCb(host, true)
	}
	if cb != nil {
		cb()
	}
}

// fail moves the current run to "failed", telling OnHost if a host was up.
func (t *TunnelService) fail(gen uint64, msg string) {
	t.mu.Lock()
	if gen != t.gen {
		t.mu.Unlock()
		return
	}
	host := t.host
	t.host, t.pid = "", 0
	t.state = models.TunnelState{Status: "failed", Error: msg, Version: tunnelVersion}
	cb, hostCb := t.onChange, t.onHost
	t.mu.Unlock()
	slog.Warn("tunnel: failed", "reason", firstLine(msg))
	if host != "" && hostCb != nil {
		hostCb(host, false)
	}
	if cb != nil {
		cb()
	}
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func (t *TunnelService) run(ctx context.Context, cancel context.CancelFunc, gen uint64, pin tunnelPin, binPath, localAddr string) {
	if err := t.prepareBinary(ctx, gen, pin, binPath); err != nil {
		if ctx.Err() != nil {
			return // Stop cancelled it; Stop reports "off"
		}
		t.fail(gen, err.Error())
		return
	}
	if !t.set(gen, func(s *models.TunnelState) { s.Status, s.Percent = "starting", 0 }) {
		return
	}
	t.runProcess(ctx, cancel, gen, binPath, localAddr)
}

func tunnelBinaryName(pin tunnelPin) string {
	name := "cloudflared-" + tunnelVersion
	if strings.HasSuffix(pin.asset, ".exe") {
		name += ".exe"
	}
	return name
}

// prepareBinary leaves a file at binPath whose SHA-256 was checked a moment
// ago (§ S8.10: verified before every execution, cached or not). A cached file
// that does not match, whether a truncated download or something swapped in
// afterwards, is deleted and fetched again once; a second mismatch fails.
func (t *TunnelService) prepareBinary(ctx context.Context, gen uint64, pin tunnelPin, binPath string) error {
	got, err := fileSHA256(binPath)
	if err == nil && hashEqual(got, pin.sha256) {
		return nil
	}
	if err == nil {
		slog.Warn("tunnel: cached cloudflared does not match its pinned hash, fetching it again")
	}
	if err := os.Remove(binPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("could not remove the cached cloudflared: %w", err)
	}

	t.set(gen, func(s *models.TunnelState) { s.Status, s.Percent = "downloading", 0 })
	if err := t.download(ctx, gen, pin, binPath); err != nil {
		return err
	}
	// The re-hash that guards the execution: the file on disk is what runs, so
	// the file on disk is what is checked.
	got, err = fileSHA256(binPath)
	if err != nil {
		return fmt.Errorf("could not read the downloaded cloudflared: %w", err)
	}
	if !hashEqual(got, pin.sha256) {
		removeTemp(binPath)
		return errors.New("the downloaded cloudflared does not match its pinned hash")
	}
	return nil
}

func hashEqual(got, want string) bool {
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(got)), []byte(want)) == 1
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (t *TunnelService) downloadURL(pin tunnelPin) string {
	return t.baseURL + "/" + tunnelVersion + "/" + pin.asset
}

// checkDownloadURL is the scheme and host pinning of § S1.3, applied to the
// first request and to every redirect.
func (t *TunnelService) checkDownloadURL(u *url.URL) error {
	if u.Scheme != "https" {
		return fmt.Errorf("download refused: %q is not an https URL", u.Scheme)
	}
	for _, h := range t.allowedHosts {
		if strings.EqualFold(u.Hostname(), h) {
			return nil
		}
	}
	return fmt.Errorf("download refused: %q is not an expected host", u.Hostname())
}

// download streams the pinned asset into a temp file beside dest, checking its
// size and SHA-256 while it arrives, then renames it into place. On any
// failure the temp file is removed and nothing is left at dest.
func (t *TunnelService) download(ctx context.Context, gen uint64, pin tunnelPin, dest string) error {
	u, err := url.Parse(t.downloadURL(pin))
	if err != nil {
		return fmt.Errorf("download cloudflared: bad URL: %w", err)
	}
	if err := t.checkDownloadURL(u); err != nil {
		return err
	}
	dir := filepath.Dir(dest)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, ".cloudflared-dl-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	installed := false
	defer func() {
		if !installed {
			tmp.Close()
			removeTemp(tmpPath)
		}
	}()

	// A copy, so the redirect policy applies without changing a client the
	// caller owns.
	client := *t.client
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= tunnelMaxRedirect {
			return errors.New("download refused: too many redirects")
		}
		return t.checkDownloadURL(req.URL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("build download request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download cloudflared: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download cloudflared: HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > pin.size {
		return fmt.Errorf("download cloudflared refused: %d bytes announced, expected %d", resp.ContentLength, pin.size)
	}

	// One byte past the pinned size is enough to tell a longer body from the
	// right one without reading however much a hostile server cares to send.
	body := io.LimitReader(resp.Body, pin.size+1)
	hasher := sha256.New()
	buf := make([]byte, 64*1024)
	var written int64
	lastPct := -1
	for {
		n, rerr := body.Read(buf)
		if n > 0 {
			if _, werr := tmp.Write(buf[:n]); werr != nil {
				return fmt.Errorf("write temp file: %w", werr)
			}
			hasher.Write(buf[:n])
			written += int64(n)
			if written > pin.size {
				return fmt.Errorf("download cloudflared refused: more than the expected %d bytes", pin.size)
			}
			if pct := int(written * 100 / pin.size); pct != lastPct {
				lastPct = pct
				t.set(gen, func(s *models.TunnelState) { s.Percent = pct })
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return fmt.Errorf("read download: %w", rerr)
		}
	}
	if written != pin.size {
		return fmt.Errorf("download cloudflared refused: got %d bytes, expected %d", written, pin.size)
	}
	if got := hex.EncodeToString(hasher.Sum(nil)); !hashEqual(got, pin.sha256) {
		return errors.New("download cloudflared refused: sha256 does not match the pinned hash")
	}

	if err := tmp.Sync(); err != nil {
		return fmt.Errorf("sync %s: %w", tmpPath, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close %s: %w", tmpPath, err)
	}
	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("chmod %s: %w", tmpPath, err)
	}
	if err := renameFile(tmpPath, dest); err != nil {
		return fmt.Errorf("install cloudflared: %w", err)
	}
	installed = true
	return nil
}

// runProcess starts cloudflared and supervises it until it exits. It blocks.
func (t *TunnelService) runProcess(ctx context.Context, cancel context.CancelFunc, gen uint64, bin, localAddr string) {
	// --no-autoupdate matters: a binary that replaces itself is no longer the
	// one whose hash was pinned.
	cmd := t.newCmd(ctx, bin, "tunnel", "--no-autoupdate", "--url", "http://"+localAddr)
	configureProcAttr(cmd) // own process group on Unix, must precede Start
	hideConsoleWindow(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.fail(gen, "could not read cloudflared's output: "+err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.fail(gen, "could not read cloudflared's output: "+err.Error())
		return
	}
	if err := cmd.Start(); err != nil {
		t.fail(gen, "could not start cloudflared: "+err.Error())
		return
	}
	pid := cmd.Process.Pid
	job := newKillOnCloseJob(pid) // dies with Konnekt even if Konnekt does not get to Stop it
	defer closeKillOnCloseJob(job)

	t.mu.Lock()
	if gen != t.gen {
		// Stop ran between the binary check and here: nothing records this pid,
		// so end the process ourselves.
		t.mu.Unlock()
		cancel()
		killTree(pid)
		if err := cmd.Wait(); err != nil {
			slog.Debug("tunnel: cloudflared ended after stop", "error", err)
		}
		return
	}
	t.pid = pid
	t.mu.Unlock()

	// cloudflared logs to stderr, but a future build may not, so both are read.
	lines := make(chan string, 64)
	var wg sync.WaitGroup
	read := func(r io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			lines <- sc.Text()
		}
		// A line past the scanner's limit ends the loop; keep draining so the
		// process never blocks on a full pipe.
		if _, err := io.Copy(io.Discard, r); err != nil {
			slog.Debug("tunnel: drain output", "error", err)
		}
	}
	wg.Add(2)
	go read(stdout)
	go read(stderr)
	go func() {
		wg.Wait()
		close(lines)
	}()

	timer := time.NewTimer(t.urlTimeout)
	defer timer.Stop()
	timeout := timer.C
	var tail []string
	host := ""
	timedOut := false
loop:
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				break loop
			}
			slog.Debug("tunnel: cloudflared", "line", line)
			tail = append(tail, clampLine(line))
			if len(tail) > tunnelTailLines {
				tail = tail[1:]
			}
			if host == "" {
				if u := findTunnelURL(line); u != "" {
					host = strings.TrimPrefix(u, "https://")
					timeout = nil
					t.up(gen, u, host)
				}
			}
		case <-timeout:
			timeout = nil
			timedOut = true
			killTree(pid)
		}
	}
	waitErr := cmd.Wait()
	t.mu.Lock()
	if t.pid == pid {
		t.pid = 0 // the pid is free to be reused from here, so Stop must not signal it
	}
	t.mu.Unlock()

	if ctx.Err() != nil {
		return // Stop's doing
	}
	detail := ""
	if len(tail) > 0 {
		detail = "\n" + strings.Join(tail, "\n")
	}
	switch {
	case timedOut:
		t.fail(gen, fmt.Sprintf("cloudflared printed no tunnel URL within %s", t.urlTimeout)+detail)
	case host != "":
		t.fail(gen, "the tunnel stopped unexpectedly"+detail)
	default:
		t.fail(gen, "cloudflared exited before it printed a tunnel URL ("+exitReason(waitErr)+")"+detail)
	}
}

func exitReason(err error) string {
	if err == nil {
		return "exit status 0"
	}
	return err.Error()
}

// findTunnelURL returns the first trycloudflare.com URL in line that is not
// cloudflared's own API endpoint.
func findTunnelURL(line string) string {
	for _, m := range tunnelURLPattern.FindAllString(line, -1) {
		if m != "https://"+tunnelAPIHost {
			return m
		}
	}
	return ""
}

// clampLine bounds one line of cloudflared's output before it is shown in the
// UI.
func clampLine(s string) string {
	r := []rune(s)
	if len(r) > tunnelTailWidth {
		return string(r[:tunnelTailWidth]) + "..."
	}
	return s
}
