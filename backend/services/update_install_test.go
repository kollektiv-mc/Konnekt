package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

// The install half of the updater: download bounds, checksum verification,
// the redirect cap and what DownloadAndInstallUpdate refuses before it gets
// as far as the binary. Each case is written from what a caller would see if
// the line under it were wrong, which is what go-mutesting measures (#349).

// sumOf is the checksums.txt entry for b.
func sumOf(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// seedTarget writes a stand-in for the running executable and returns its path.
func seedTarget(t *testing.T) string {
	t.Helper()
	target := filepath.Join(t.TempDir(), "konnekt-target.exe")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	return target
}

func assertTargetUntouched(t *testing.T, target string) {
	t.Helper()
	got, err := os.ReadFile(target)
	if err != nil || string(got) != "old" {
		t.Errorf("target = %q, %v; want it untouched", got, err)
	}
}

// servePayload answers every request with payload. announce=false flushes the
// headers before the body, so the response is chunked and its length unknown
// until the stream ends, which is the path only the byte cap can stop.
func servePayload(payload []byte, announce bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if announce {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		} else {
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
		}
		_, _ = w.Write(payload)
	}
}

// A release that declares exactly the size it serves installs, announced or
// streamed: the cap is a ceiling, not a cap one byte short of it.
func TestDownloadAndApplyAcceptsExactlyTheDeclaredSize(t *testing.T) {
	payload := []byte(strings.Repeat("x", 1024))
	for name, announce := range map[string]bool{"announced": true, "streamed": false} {
		t.Run(name, func(t *testing.T) {
			ts := httptest.NewServer(servePayload(payload, announce))
			defer ts.Close()

			target := seedTarget(t)
			svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
			asset := models.UpdateAsset{Name: "konnekt-windows-amd64.exe", DownloadURL: ts.URL, Size: int64(len(payload))}
			if err := svc.downloadAndApply(context.Background(), asset, sumOf(payload), target); err != nil {
				t.Fatalf("downloadAndApply: %v", err)
			}
			got, err := os.ReadFile(target)
			if err != nil || string(got) != string(payload) {
				t.Errorf("target holds %d bytes, %v; want the %d-byte payload", len(got), err, len(payload))
			}
		})
	}
}

// One byte past the declared size, with no Content-Length to refuse it up
// front, fails on the stream itself and says why.
func TestDownloadAndApplyStopsAStreamOneByteOverTheDeclaredSize(t *testing.T) {
	payload := []byte(strings.Repeat("x", 101))
	ts := httptest.NewServer(servePayload(payload, false))
	defer ts.Close()

	target := seedTarget(t)
	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
	asset := models.UpdateAsset{Name: "konnekt-windows-amd64.exe", DownloadURL: ts.URL, Size: 100}
	err := svc.downloadAndApply(context.Background(), asset, sumOf(payload), target)
	if !errors.Is(err, errTooLarge) || !strings.Contains(err.Error(), "apply failed") {
		t.Errorf("err = %v, want the size cap reported as an apply failure", err)
	}
	assertTargetUntouched(t, target)
}

// The fixed ceiling holds when the release declares no size, and when it
// declares one larger than the ceiling: the announced length is refused
// before a byte of the body is read.
func TestDownloadAndApplyRefusesAnAnnouncedLengthOverTheCeiling(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(maxUpdateBinary+1))
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	for _, declared := range []int64{0, -1, 1 << 40} {
		t.Run(fmt.Sprint(declared), func(t *testing.T) {
			target := seedTarget(t)
			svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
			asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL, Size: declared}
			err := svc.downloadAndApply(context.Background(), asset, sumOf(nil), target)
			want := fmt.Sprintf("%d bytes announced, limit %d", maxUpdateBinary+1, maxUpdateBinary)
			if err == nil || !strings.Contains(err.Error(), want) || !strings.Contains(err.Error(), "konnekt-linux-amd64") {
				t.Errorf("err = %v, want it to name the asset and %q", err, want)
			}
			assertTargetUntouched(t, target)
		})
	}
}

// An announced length equal to the declared size is not over it.
func TestDownloadAndApplyRefusesAnAnnouncedLengthOverTheDeclaredSize(t *testing.T) {
	payload := []byte(strings.Repeat("x", 100))
	ts := httptest.NewServer(servePayload(payload, true))
	defer ts.Close()

	target := seedTarget(t)
	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL, Size: 99}
	err := svc.downloadAndApply(context.Background(), asset, sumOf(payload), target)
	if err == nil || !strings.Contains(err.Error(), "100 bytes announced, limit 99") {
		t.Errorf("err = %v, want the announced length refused against the declared 99", err)
	}
	assertTargetUntouched(t, target)
}

// A response outside 2xx is refused whatever its body, so an error page is
// never handed to the checksum check as if it were a binary.
func TestDownloadAndApplyRefusesANon2xxResponse(t *testing.T) {
	payload := []byte("an error page that happens to be checksummed")
	for _, status := range []int{http.StatusMultipleChoices, http.StatusNotFound, http.StatusInternalServerError} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write(payload)
			}))
			defer ts.Close()

			target := seedTarget(t)
			svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
			asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL}
			err := svc.downloadAndApply(context.Background(), asset, sumOf(payload), target)
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("HTTP %d", status)) {
				t.Errorf("err = %v, want HTTP %d", err, status)
			}
			assertTargetUntouched(t, target)
		})
	}
}

// A checksum that is not hex, and a target that cannot be written, are both
// refused before the download starts.
func TestDownloadAndApplyRefusesBeforeDownloading(t *testing.T) {
	var hits int
	var mu sync.Mutex
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
		_, _ = w.Write([]byte("payload"))
	}))
	defer ts.Close()
	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL}

	target := seedTarget(t)
	err := svc.downloadAndApply(context.Background(), asset, "not-hex", target)
	if err == nil || !strings.Contains(err.Error(), "decode checksum") {
		t.Errorf("bad hex: err = %v, want the decode refusal", err)
	}
	var hexErr hex.InvalidByteError
	if !errors.As(err, &hexErr) {
		t.Errorf("bad hex: err = %v, want the hex error wrapped", err)
	}
	assertTargetUntouched(t, target)

	unwritable := filepath.Join(t.TempDir(), "missing-dir", "konnekt")
	err = svc.downloadAndApply(context.Background(), asset, sumOf([]byte("payload")), unwritable)
	if !errors.Is(err, ErrUpdatePermission) {
		t.Errorf("unwritable target: err = %v, want ErrUpdatePermission", err)
	}
	if _, statErr := os.Stat(unwritable); !os.IsNotExist(statErr) {
		t.Errorf("unwritable target was created: %v", statErr)
	}

	mu.Lock()
	defer mu.Unlock()
	if hits != 0 {
		t.Errorf("made %d requests, want 0", hits)
	}
}

// A malformed URL is refused by name, on both download paths.
func TestUpdateDownloadsRefuseAMalformedURL(t *testing.T) {
	svc := &UpdateService{http: http.DefaultClient, checkURL: func(*url.URL) error { return nil }}
	const bad = "http://[::1"
	if _, err := svc.fetchAsset(context.Background(), bad); err == nil || !strings.Contains(err.Error(), "bad URL") {
		t.Errorf("fetchAsset: %v", err)
	}
	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: bad}
	err := svc.downloadAndApply(context.Background(), asset, sumOf(nil), seedTarget(t))
	if err == nil || !strings.Contains(err.Error(), "download konnekt-linux-amd64: bad URL") {
		t.Errorf("downloadAndApply: %v", err)
	}
}

// A transport failure reaches the caller with its cause intact.
func TestUpdateDownloadsWrapATransportFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer ts.Close()
	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := svc.fetchAsset(ctx, ts.URL); !errors.Is(err, context.Canceled) {
		t.Errorf("fetchAsset: err = %v, want context.Canceled", err)
	}
	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL}
	err := svc.downloadAndApply(ctx, asset, sumOf(nil), seedTarget(t))
	if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), "download konnekt-linux-amd64") {
		t.Errorf("downloadAndApply: err = %v, want context.Canceled under the asset's name", err)
	}
}

// A checksum mismatch is reported as a failed apply that rolled back cleanly,
// not as the rollback failure that tells the user to reinstall by hand.
func TestDownloadAndApplyReportsAChecksumMismatchAsAnApplyFailure(t *testing.T) {
	ts := httptest.NewServer(servePayload([]byte("served"), true))
	defer ts.Close()

	target := seedTarget(t)
	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL}
	err := svc.downloadAndApply(context.Background(), asset, sumOf([]byte("expected")), target)
	if err == nil || !strings.HasPrefix(err.Error(), "update install: apply failed: ") {
		t.Errorf("err = %v, want a plain apply failure", err)
	}
	assertTargetUntouched(t, target)
}

// Both downloads identify themselves; GitHub refuses API requests without a
// User-Agent and the asset hosts are within their rights to do the same.
func TestUpdateDownloadsSendTheUserAgent(t *testing.T) {
	payload := []byte("binary")
	var mu sync.Mutex
	var agents []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		agents = append(agents, r.Header.Get("User-Agent"))
		mu.Unlock()
		_, _ = w.Write(payload)
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
	if _, err := svc.fetchAsset(context.Background(), ts.URL); err != nil {
		t.Fatal(err)
	}
	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL}
	if err := svc.downloadAndApply(context.Background(), asset, sumOf(payload), seedTarget(t)); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(agents) != 2 || agents[0] != updateUserAgent || agents[1] != updateUserAgent {
		t.Errorf("User-Agent headers = %q, want %q on both", agents, updateUserAgent)
	}
}

// fetchAsset refuses a non-2xx answer rather than returning an error page as
// checksums.txt.
func TestUpdateFetchAssetRefusesANon2xxResponse(t *testing.T) {
	for _, status := range []int{http.StatusMultipleChoices, http.StatusNotFound} {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte("abc  konnekt-linux-amd64\n"))
		}))
		svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
		body, err := svc.fetchAsset(context.Background(), ts.URL)
		if err == nil || err.Error() != fmt.Sprintf("HTTP %d", status) || body != nil {
			t.Errorf("status %d: body %q, err %v", status, body, err)
		}
		ts.Close()
	}
}

// redirectChain serves /hop/N as a redirect to /hop/N-1, and /hop/0 as the body.
func redirectChain(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		n, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/hop/"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if n == 0 {
			_, _ = w.Write([]byte(body))
			return
		}
		http.Redirect(w, r, fmt.Sprintf("/hop/%d", n-1), http.StatusFound)
	}
}

// The redirect cap is a number of hops: one under it is followed to the end
// on both download paths, the cap itself is refused.
func TestUpdateDownloadsCapTheRedirectChain(t *testing.T) {
	payload := "abc  konnekt-linux-amd64\n"
	ts := httptest.NewServer(redirectChain(payload))
	defer ts.Close()
	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}

	under := fmt.Sprintf("%s/hop/%d", ts.URL, updateMaxRedirects-1)
	at := fmt.Sprintf("%s/hop/%d", ts.URL, updateMaxRedirects)

	if body, err := svc.fetchAsset(context.Background(), under); err != nil || string(body) != payload {
		t.Errorf("%d hops: body %q, err %v", updateMaxRedirects-1, body, err)
	}
	if _, err := svc.fetchAsset(context.Background(), at); err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Errorf("%d hops: err %v, want the cap", updateMaxRedirects, err)
	}

	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: under}
	if err := svc.downloadAndApply(context.Background(), asset, sumOf([]byte(payload)), seedTarget(t)); err != nil {
		t.Errorf("binary over %d hops: %v", updateMaxRedirects-1, err)
	}
	asset.DownloadURL = at
	if err := svc.downloadAndApply(context.Background(), asset, sumOf([]byte(payload)), seedTarget(t)); err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Errorf("binary over %d hops: err %v, want the cap", updateMaxRedirects, err)
	}

	// The cap lives on a copy of the client: the service's own client, which
	// the release check uses, is left as it was.
	if svc.http.CheckRedirect != nil {
		t.Error("assetClient changed the service's own client")
	}
}

// The progress the UI draws comes from the bytes actually read against the
// announced length: every whole percent once, in order, ending at 100.
func TestProgressReaderReportsEachPercentOnce(t *testing.T) {
	var got []int
	p := &progressReader{
		r:        &oneByteReader{left: 200},
		total:    200,
		lastPct:  -1,
		onUpdate: func(pct int) { got = append(got, pct) },
	}
	n, err := io.Copy(io.Discard, p)
	if err != nil || n != 200 {
		t.Fatalf("copied %d, %v", n, err)
	}
	if len(got) != 101 {
		t.Fatalf("got %d updates, want 101 (0 through 100): %v", len(got), got)
	}
	for i, pct := range got {
		if pct != i {
			t.Fatalf("update %d = %d, want %d: %v", i, pct, i, got)
		}
	}
}

// An unknown or zero length reports nothing rather than dividing by it.
func TestProgressReaderIsSilentWithoutALength(t *testing.T) {
	for _, total := range []int64{-1, 0} {
		calls := 0
		p := &progressReader{r: strings.NewReader("abc"), total: total, lastPct: -1, onUpdate: func(int) { calls++ }}
		if b, err := io.ReadAll(p); err != nil || string(b) != "abc" {
			t.Errorf("total %d: read %q, %v", total, b, err)
		}
		if calls != 0 {
			t.Errorf("total %d: %d updates, want none", total, calls)
		}
	}
}

// oneByteReader yields left bytes, one per Read.
type oneByteReader struct{ left int }

func (o *oneByteReader) Read(p []byte) (int, error) {
	if o.left == 0 {
		return 0, io.EOF
	}
	if len(p) == 0 {
		return 0, nil
	}
	o.left--
	p[0] = 'x'
	return 1, nil
}

// The download emits update:progress on the bus from 0 to 100, each value
// once and in order. The payload is large enough that the first read (io.ReadAll
// starts at 512 bytes) is under 1%, so the bar starts at 0 rather than jumping.
func TestDownloadAndApplyEmitsProgress(t *testing.T) {
	payload := []byte(strings.Repeat("x", 64<<10))
	ts := httptest.NewServer(servePayload(payload, true))
	defer ts.Close()

	bus := NewEventBus()
	var mu sync.Mutex
	var pcts []int
	bus.Tap(func(event string, data any) {
		if event != EventUpdateProgress {
			return
		}
		m, ok := data.(map[string]any)
		if !ok {
			t.Errorf("payload %T, want a map", data)
			return
		}
		pct, ok := m["percent"].(int)
		if !ok {
			t.Errorf("percent %T, want an int", m["percent"])
			return
		}
		mu.Lock()
		pcts = append(pcts, pct)
		mu.Unlock()
	})
	svc := &UpdateService{http: ts.Client(), checkURL: allowHost(ts.URL)}
	svc.SetBus(bus)
	asset := models.UpdateAsset{Name: "konnekt-linux-amd64", DownloadURL: ts.URL}
	if err := svc.downloadAndApply(context.Background(), asset, sumOf(payload), seedTarget(t)); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(pcts) == 0 || pcts[0] != 0 || pcts[len(pcts)-1] != 100 {
		t.Fatalf("progress = %v, want it to run from 0 to 100", pcts)
	}
	for i := 1; i < len(pcts); i++ {
		if pcts[i] <= pcts[i-1] {
			t.Fatalf("progress = %v, want each value once, increasing", pcts)
		}
	}
}

// capReader passes through exactly its allowance and fails on the first byte
// past it, returning what it read either way.
func TestCapReader(t *testing.T) {
	for _, c := range []struct {
		size, left int
		wantErr    bool
	}{
		{size: 10, left: 10},
		{size: 10, left: 11},
		{size: 10, left: 9, wantErr: true},
	} {
		r := &capReader{r: strings.NewReader(strings.Repeat("x", c.size)), left: int64(c.left)}
		b, err := io.ReadAll(r)
		if c.wantErr != errors.Is(err, errTooLarge) {
			t.Errorf("%d bytes against %d: err = %v, wantErr %v", c.size, c.left, err, c.wantErr)
		}
		if len(b) != c.size {
			t.Errorf("%d bytes against %d: read %d", c.size, c.left, len(b))
		}
	}
}

// A read that delivers bytes re-arms the stall timer. The timer starts an hour
// out; after one read it is due after d, so it fires. The wait on the firing
// is the only bound and it is generous: a correct reader fires in about d.
func TestStallReaderRearmsOnProgress(t *testing.T) {
	fired := make(chan struct{})
	timer := time.AfterFunc(time.Hour, func() { close(fired) })
	defer timer.Stop()

	s := &stallReader{r: strings.NewReader("abc"), timer: timer, d: time.Millisecond}
	buf := make([]byte, 1)
	if n, err := s.Read(buf); n != 1 || err != nil {
		t.Fatalf("Read = %d, %v", n, err)
	}
	select {
	case <-fired:
	case <-time.After(10 * time.Second):
		t.Fatal("the timer was not re-armed by a read that delivered bytes")
	}
}

// installRelease serves a release API and its assets from one server, so the
// whole of DownloadAndInstallUpdate up to the binary can run. The binary
// itself always 404s: a test must never get as far as replacing the running
// test executable.
type installRelease struct {
	tag          string
	assets       []string // names; each is served at /dl/<name>
	checksums    string
	checksumsErr int
}

func (rel installRelease) server(t *testing.T) *httptest.Server {
	t.Helper()
	var ts *httptest.Server
	ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == updateRepoPath:
			var parts []string
			for _, a := range rel.assets {
				parts = append(parts, fmt.Sprintf(`{"name":%q,"browser_download_url":%q,"size":10}`, a, ts.URL+"/dl/"+a))
			}
			_, _ = fmt.Fprintf(w, `{"tag_name":%q,"assets":[%s]}`, rel.tag, strings.Join(parts, ","))
		case r.URL.Path == "/dl/"+updateChecksumsAssetName:
			if rel.checksumsErr != 0 {
				w.WriteHeader(rel.checksumsErr)
				return
			}
			_, _ = w.Write([]byte(rel.checksums))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(ts.Close)
	return ts
}

// Each refusal DownloadAndInstallUpdate makes on the way to the binary, named
// so the user can tell a missing asset from a missing checksum.
func TestDownloadAndInstallUpdateRefusals(t *testing.T) {
	platform, err := platformAssetNameFor(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		t.Skipf("no self-update asset for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	all := []string{platform, updateChecksumsAssetName}
	cases := []struct {
		name    string
		rel     installRelease
		current string
		want    string
	}{
		{"up to date", installRelease{tag: "v0.1.0", assets: all}, "0.1.0", "update install: no update available"},
		{"no platform asset", installRelease{tag: "v0.2.0", assets: []string{updateChecksumsAssetName}}, "0.1.0", fmt.Sprintf("no asset named %q", platform)},
		{"no checksums", installRelease{tag: "v0.2.0", assets: []string{platform}}, "0.1.0", "missing " + updateChecksumsAssetName},
		{"checksums unreachable", installRelease{tag: "v0.2.0", assets: all, checksumsErr: http.StatusNotFound}, "0.1.0", "update install: download checksums: HTTP 404"},
		{"no checksum entry", installRelease{tag: "v0.2.0", assets: all, checksums: "abcd  some-other-file\n"}, "0.1.0", fmt.Sprintf("checksums.txt has no entry for %q", platform)},
		{"binary unreachable", installRelease{tag: "v0.2.0", assets: all, checksums: sumOf([]byte("never served")) + "  " + platform + "\n"}, "0.1.0", fmt.Sprintf("update install: download %s: HTTP 404", platform)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ts := c.rel.server(t)
			svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, checkURL: allowHost(ts.URL)}
			err := svc.DownloadAndInstallUpdate(context.Background(), c.current, UpdateChannelStable)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("err = %v, want %q", err, c.want)
			}
		})
	}
}

// A failed check stops the install, with the check's cause kept.
func TestDownloadAndInstallUpdateWrapsAFailedCheck(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{not json`))
	}))
	defer ts.Close()
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, checkURL: allowHost(ts.URL)}
	err := svc.DownloadAndInstallUpdate(context.Background(), "0.1.0", UpdateChannelStable)
	var syntax *json.SyntaxError
	if err == nil || !strings.HasPrefix(err.Error(), "update install: check failed: ") || !errors.As(err, &syntax) {
		t.Errorf("err = %v, want the decode error wrapped under check failed", err)
	}
}

// A body cut short of its announced length is an error on both small reads,
// never the truncated bytes returned as if they were the whole file.
func TestUpdateReadsRefuseATruncatedBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000")
		_, _ = w.Write([]byte(`{"tag_name":"v0.2.0"}`))
	}))
	defer ts.Close()
	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL, checkURL: allowHost(ts.URL)}

	if body, err := svc.fetchAsset(context.Background(), ts.URL); !errors.Is(err, io.ErrUnexpectedEOF) || body != nil {
		t.Errorf("fetchAsset: body %q, err %v; want io.ErrUnexpectedEOF and no body", body, err)
	}
	if _, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Errorf("CheckForUpdates: err %v, want io.ErrUnexpectedEOF", err)
	}
}
