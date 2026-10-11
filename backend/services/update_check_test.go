package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"konnekt/backend/models"
)

// The check half of the updater: what reaches the UI from a release, which
// release wins on the snapshot channel, and which error comes back when the
// check fails. Written against go-mutesting's escapes (#349).

func TestNewUpdateServiceIsStrictAndTimed(t *testing.T) {
	svc := NewUpdateService()
	if svc.baseURL != updateAPIBase {
		t.Errorf("baseURL = %q, want %q", svc.baseURL, updateAPIBase)
	}
	if svc.http == nil || svc.http.Timeout != 30*time.Second {
		t.Errorf("http client = %+v, want one with a 30s timeout", svc.http)
	}
	if svc.checkURL != nil {
		t.Error("checkURL is set; a production service must use the strict rule")
	}
	// The test binary is built under the temp directory, never under /usr.
	if svc.packageManaged {
		t.Error("packageManaged = true for a binary outside /usr")
	}
	if runningFromPackage() {
		t.Error("runningFromPackage() = true for the test binary")
	}

	bus := NewEventBus()
	svc.SetBus(bus)
	if svc.bus != bus {
		t.Error("SetBus did not install the bus")
	}
}

// The host comparison ignores case, as DNS does.
func TestCheckUpdateURLIgnoresHostCase(t *testing.T) {
	u, err := url.Parse("https://GitHub.COM/kollektiv-mc/Konnekt/releases/download/v1/x")
	if err != nil {
		t.Fatal(err)
	}
	if err := checkUpdateURL(u); err != nil {
		t.Errorf("mixed-case host refused: %v", err)
	}
	evil, err := url.Parse("https://evil.example/x")
	if err != nil {
		t.Fatal(err)
	}
	if err := checkUpdateURL(evil); err == nil || err.Error() != `download refused: "evil.example" is not an expected host` {
		t.Errorf("err = %v, want the host named", err)
	}
}

// Every field the UI reads comes from the release that won, and the request
// that fetched it asks for GitHub's JSON as the updater.
func TestCheckForUpdatesFillsEveryField(t *testing.T) {
	var accept, agent string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		accept, agent = r.Header.Get("Accept"), r.Header.Get("User-Agent")
		_, _ = w.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://example.com/r","body":"notes",` +
			`"published_at":"2026-07-16T00:00:00Z","assets":[{"name":"a","browser_download_url":"https://example.com/a","size":7}]}`))
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", "")
	if err != nil {
		t.Fatal(err)
	}
	want := models.UpdateInfo{
		CurrentVersion:  "0.1.0",
		LatestVersion:   "v0.2.0",
		UpdateAvailable: true,
		Channel:         UpdateChannelStable,
		ReleaseURL:      "https://example.com/r",
		ReleaseNotes:    "notes",
		PublishedAt:     "2026-07-16T00:00:00Z",
		Assets:          []models.UpdateAsset{{Name: "a", DownloadURL: "https://example.com/a", Size: 7}},
	}
	gotJSON, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	wantJSON, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotJSON) != string(wantJSON) {
		t.Errorf("info = %s\nwant   %s", gotJSON, wantJSON)
	}
	if accept != "application/vnd.github+json" || agent != updateUserAgent {
		t.Errorf("Accept %q, User-Agent %q", accept, agent)
	}
}

// A release with no assets reaches the frontend as an empty list, not null.
func TestCheckForUpdatesSendsAnEmptyAssetListNotNull(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"tag_name":"v0.2.0"}`))
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"assets":[]`) {
		t.Errorf("info = %s, want an empty assets list", b)
	}
}

// Nothing published still says which channel was checked and what is running.
func TestCheckForUpdatesNothingPublishedEchoesTheCurrentVersion(t *testing.T) {
	_, ts := newChannelServer(stubRelease{}, stubRelease{})
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
	if err != nil {
		t.Fatal(err)
	}
	if info.CurrentVersion != "0.1.0" || info.LatestVersion != "0.1.0" || info.Channel != UpdateChannelStable || info.UpdateAvailable {
		t.Errorf("info = %+v", info)
	}
}

// Ties go to stable: the same version on both channels is offered as the
// stable release.
func TestCheckForUpdatesSnapshotChannelTieGoesToStable(t *testing.T) {
	const v = "0.2.0-snapshot.202608290400.abc1234"
	_, ts := newChannelServer(okJSON(stableBody(v)), okJSON(snapshotBody(v)))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	if info.Channel != UpdateChannelStable || info.ReleaseURL != "https://example.com/stable" {
		t.Errorf("Channel %q, ReleaseURL %q; want the stable release", info.Channel, info.ReleaseURL)
	}
}

// When the check fails it is the endpoint that failed that is reported:
// stable's error first when both failed, the snapshot's when only it failed
// and stable has nothing published.
func TestCheckForUpdatesReportsTheEndpointThatFailed(t *testing.T) {
	cases := []struct {
		name             string
		stable, snapshot stubRelease
		want             string
	}{
		{"both failed", stubRelease{status: 500, body: "stable down"}, stubRelease{status: 502, body: "snapshot down"}, "HTTP 500: stable down"},
		{"stable failed, no snapshot", stubRelease{status: 500, body: "stable down"}, stubRelease{}, "HTTP 500: stable down"},
		{"snapshot failed, no stable", stubRelease{}, stubRelease{status: 502, body: "snapshot down"}, "HTTP 502: snapshot down"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, ts := newChannelServer(c.stable, c.snapshot)
			defer ts.Close()
			svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
			info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
			if err == nil || err.Error() != "update check: "+c.want {
				t.Errorf("err = %v, want %q", err, "update check: "+c.want)
			}
			if info.Channel != "" || info.CurrentVersion != "" {
				t.Errorf("info = %+v, want the zero value beside an error", info)
			}
		})
	}
}

// fetchCandidate's failures each carry their cause, so the toast can say
// whether the network, the size cap or GitHub's answer was at fault.
func TestFetchCandidateErrors(t *testing.T) {
	t.Run("a 3xx is not a release", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusMultipleChoices)
			_, _ = w.Write([]byte(stableBody("v0.2.0")))
		}))
		defer ts.Close()
		svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
		if _, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable); err == nil || !strings.Contains(err.Error(), "HTTP 300") {
			t.Errorf("err = %v, want HTTP 300", err)
		}
	})

	t.Run("the error body is cut at 200 bytes", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(strings.Repeat("a", 200) + "b"))
		}))
		defer ts.Close()
		svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
		_, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
		if err == nil || err.Error() != "update check: HTTP 403: "+strings.Repeat("a", 200)+"…" {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("an oversized body wraps the size error", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(strings.Repeat("a", maxReleaseJSONBytes+1)))
		}))
		defer ts.Close()
		svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
		_, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
		if !errors.Is(err, errTooLarge) || !strings.Contains(err.Error(), "read response") {
			t.Errorf("err = %v, want errTooLarge under read response", err)
		}
	})

	t.Run("a release list of exactly the cap is read", func(t *testing.T) {
		prefix := `{"tag_name":"v0.2.0","body":"`
		pad := maxReleaseJSONBytes - len(prefix) - len(`"}`)
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(prefix + strings.Repeat("a", pad) + `"}`))
		}))
		defer ts.Close()
		svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
		if info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable); err != nil || info.LatestVersion != "v0.2.0" {
			t.Errorf("info %+v, err %v", info.LatestVersion, err)
		}
	})

	t.Run("a decode failure wraps the JSON error", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{not json`))
		}))
		defer ts.Close()
		svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
		_, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
		var syntax *json.SyntaxError
		if !errors.As(err, &syntax) || !strings.Contains(err.Error(), "decode response") {
			t.Errorf("err = %v, want a wrapped *json.SyntaxError", err)
		}
	})

	t.Run("a transport failure wraps its cause", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		defer ts.Close()
		svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := svc.CheckForUpdates(ctx, "0.1.0", UpdateChannelStable)
		if !errors.Is(err, context.Canceled) || !strings.HasPrefix(err.Error(), "update check: ") {
			t.Errorf("err = %v, want context.Canceled", err)
		}
	})

	t.Run("an unusable base URL fails building the request", func(t *testing.T) {
		svc := &UpdateService{http: http.DefaultClient, baseURL: "http://bad host"}
		_, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
		var urlErr *url.Error
		if !errors.As(err, &urlErr) || !strings.Contains(err.Error(), "build request") {
			t.Errorf("err = %v, want a wrapped *url.Error from building the request", err)
		}
	})
}

func TestSelectPlatformAssetsReturnsTheMatchingEntries(t *testing.T) {
	assets := []models.UpdateAsset{
		{Name: "konnekt-linux-amd64", DownloadURL: "https://example.com/linux", Size: 3},
		{Name: "checksums.txt", DownloadURL: "https://example.com/sums", Size: 4},
		{Name: "konnekt-windows-amd64.exe", DownloadURL: "https://example.com/win", Size: 5},
	}
	asset, sums, err := selectPlatformAssets(assets, "windows", "amd64")
	if err != nil {
		t.Fatal(err)
	}
	if asset != assets[2] || sums != assets[1] {
		t.Errorf("asset %+v, checksums %+v", asset, sums)
	}

	_, _, err = selectPlatformAssets(assets, "darwin", "arm64")
	if err == nil || err.Error() != "update install: no self-update asset published for darwin/arm64 yet" {
		t.Errorf("err = %v", err)
	}
}

// checksums.txt lines are "<hex>  <name>": the name is the last field, the
// sum the first, and trailing whitespace (a CRLF file) is not part of either.
func TestParseChecksumsEdgeLines(t *testing.T) {
	got := parseChecksums([]byte("  AA  konnekt-linux-amd64 \r\nBB extra konnekt-windows-amd64.exe\r\n\r\nCC\n"))
	want := map[string]string{"konnekt-linux-amd64": "aa", "konnekt-windows-amd64.exe": "bb"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

// Where a prerelease identifier stops being a number, and how a short core
// reads. These sit beside TestCompareVersions rather than in it because that
// table is mirrored row for row by the Python guard's test.
func TestPrereleaseIdentifierBoundaries(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		// '0' and '9' are digits, so these are numbers and sort below text;
		// '-' is below '0' in ASCII and would sort first as text.
		{"0", "-", -1},
		{"9", "-", -1},
		{"-", "0", 1},
		{"10", "9", 1},
		{"9", "10", -1},
		{"7", "7", 0},
		// '/' and ':' bracket the digits and are text.
		{"/", "1", 1},
		{":", "1", 1},
		// strconv.ParseInt takes a sign, the digit scan does not: "+1" is
		// text and sorts above any number.
		{"+1", "2", 1},
		// A digit run past int64 is text too, so it sorts above the largest
		// one that fits rather than tying with it.
		{"9223372036854775807", "99999999999999999999", -1},
	}
	for _, c := range cases {
		if got := comparePrereleaseIdentifier(c.a, c.b); got != c.want {
			t.Errorf("comparePrereleaseIdentifier(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}

	versions := []struct {
		a, b string
		want int
	}{
		{"1.0.0-1.2", "1.0.0-1.3", -1},
		{"1.0.0-a.b.c", "1.0.0-a.b", 1},
		{"1.0.0-a.b", "1.0.0-a.b.c", -1},
		{"1.2", "1.2.0", 0},
		{"1.2", "1.2.1", -1},
		{"1.x.3", "1.0.3", 0},
		{"1.0.1", "1.0.0-snapshot.1", 1},
	}
	for _, c := range versions {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}

	if got := parseVersionCore("2.0"); got != [3]int{2, 0, 0} {
		t.Errorf("parseVersionCore(2.0) = %v", got)
	}
	if got := parseVersionCore("1.x.3"); got != [3]int{1, 0, 3} {
		t.Errorf("parseVersionCore(1.x.3) = %v", got)
	}
	if n, ok := numericIdentifier("0"); !ok || n != 0 {
		t.Errorf("numericIdentifier(0) = %d, %v", n, ok)
	}
	if _, ok := numericIdentifier(""); ok {
		t.Error("numericIdentifier(\"\") is numeric")
	}
	if core, pre := splitVersion("v1.2.3-alpha-1"); core != "1.2.3" || pre != "alpha-1" {
		t.Errorf("splitVersion = %q, %q", core, pre)
	}
}
