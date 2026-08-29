package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"konnekt/backend/models"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.2.3", "1.2.3", 0},
		{"v1.2.3", "1.2.3", 0},
		{"1.2.4", "1.2.3", 1},
		{"1.2.3", "1.2.4", -1},
		{"1.3.0", "1.2.9", 1},
		{"2.0.0", "1.9.9", 1},
		{"1.0.0", "2.0.0", -1},
		{"1.0.0", "1.0.0-dev", 1},
		{"1.0.0-dev", "1.0.0", -1},
		{"1.0.0-alpha", "1.0.0-beta", -1},
		{"0.1.0", "0.1.0-dev", 1},

		// Snapshot versions. The fixed-width UTC timestamp snapshot.yml stamps
		// is what makes these orderable at all: the sha alone sorts
		// alphabetically, which says nothing about which build is newer.
		{"0.1.0-snapshot.202608300400.def0000", "0.1.0-snapshot.202608290400.abc1234", 1},
		{"0.1.0-snapshot.202608290400.abc1234", "0.1.0-snapshot.202608300400.def0000", -1},
		{"0.1.0-snapshot.202608290400.abc1234", "0.1.0-snapshot.202608290400.abc1234", 0},
		{"0.1.0", "0.1.0-snapshot.202608290400.abc1234", 1},
		{"0.1.0-snapshot.202608290400.abc1234", "v0.1.0-alpha.1", 1},
		{"0.1.0-snapshot.202608290400.abc1234", "0.1.0-dev", 1},
		{"0.2.0-snapshot.202608010000.abc1234", "0.1.0", 1},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestIsSnapshotVersion(t *testing.T) {
	cases := []struct {
		version string
		want    bool
	}{
		{"0.1.0-snapshot.202608290400.abc1234", true},
		{"0.1.0", false},
		{"v0.1.0-alpha.1", false},
		{"0.1.0-dev", false},
		// The pre-2026-08 snapshot stamp. It is deliberately not recognised:
		// those builds run the old binary, cannot self-update whatever this
		// says, and treating them as snapshots would only mislabel them.
		{"0.1.0-dev.snapshot.00400f8", false},
	}
	for _, c := range cases {
		if got := IsSnapshotVersion(c.version); got != c.want {
			t.Errorf("IsSnapshotVersion(%q) = %v, want %v", c.version, got, c.want)
		}
	}
}

func TestIsInstallableBuild(t *testing.T) {
	cases := []struct {
		version string
		want    bool
	}{
		{"0.1.0", true},
		{"v0.1.0-alpha.1", true},
		{"0.1.0-snapshot.202608290400.abc1234", true},
		{"0.1.0-dev", false},
		// Documents that old-format snapshots keep the old, stranded
		// classification. Nothing shipped here can reach them.
		{"0.1.0-dev.snapshot.00400f8", false},
	}
	for _, c := range cases {
		if got := IsInstallableBuild(c.version); got != c.want {
			t.Errorf("IsInstallableBuild(%q) = %v, want %v", c.version, got, c.want)
		}
	}
}

func TestEffectiveChannel(t *testing.T) {
	cases := []struct {
		setting, version, want string
	}{
		{UpdateChannelStable, "0.1.0", UpdateChannelStable},
		{UpdateChannelSnapshot, "0.1.0", UpdateChannelSnapshot},
		// The forcing rule: a snapshot build follows the snapshot channel even
		// with the setting on stable, or it could never update itself.
		{UpdateChannelStable, "0.1.0-snapshot.202608290400.abc1234", UpdateChannelSnapshot},
		// A settings file written before the field existed.
		{"", "0.1.0", UpdateChannelStable},
		{"garbage", "0.1.0", UpdateChannelStable},
	}
	for _, c := range cases {
		if got := EffectiveChannel(c.setting, c.version); got != c.want {
			t.Errorf("EffectiveChannel(%q, %q) = %q, want %q", c.setting, c.version, got, c.want)
		}
	}
}

func TestReleaseVersion(t *testing.T) {
	cases := []struct {
		name          string
		rel           ghRelease
		channel, want string
	}{
		{
			name:    "stable reads tag_name and ignores the title",
			rel:     ghRelease{TagName: "v0.2.0", Name: "Second Alpha"},
			channel: UpdateChannelStable,
			want:    "v0.2.0",
		},
		{
			name:    "snapshot reads the bare version from the title",
			rel:     ghRelease{TagName: "snapshot", Name: "0.1.0-snapshot.202608290400.abc1234"},
			channel: UpdateChannelSnapshot,
			want:    "0.1.0-snapshot.202608290400.abc1234",
		},
		{
			name:    "snapshot rejects a decorated title",
			rel:     ghRelease{TagName: "snapshot", Name: "Snapshot 0.1.0-snapshot.202608290400.abc1234"},
			channel: UpdateChannelSnapshot,
			want:    "",
		},
		{
			name:    "snapshot rejects the pre-2026-08 title format",
			rel:     ghRelease{TagName: "snapshot", Name: "Snapshot 0.1.0-dev.snapshot.00400f8"},
			channel: UpdateChannelSnapshot,
			want:    "",
		},
		{
			name:    "snapshot rejects an empty title",
			rel:     ghRelease{TagName: "snapshot", Name: ""},
			channel: UpdateChannelSnapshot,
			want:    "",
		},
	}
	for _, c := range cases {
		if got := releaseVersion(c.rel, c.channel); got != c.want {
			t.Errorf("%s: releaseVersion() = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestCheckForUpdatesReportsAvailable(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != updateRepoPath {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("User-Agent") == "" {
			t.Error("expected a User-Agent header")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://example.com/release","body":"notes","published_at":"2026-07-16T00:00:00Z"}`))
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !info.UpdateAvailable {
		t.Error("expected UpdateAvailable to be true")
	}
	if info.LatestVersion != "v0.2.0" {
		t.Errorf("LatestVersion = %q, want %q", info.LatestVersion, "v0.2.0")
	}
	if info.ReleaseURL != "https://example.com/release" {
		t.Errorf("ReleaseURL = %q", info.ReleaseURL)
	}
	if info.CurrentVersion != "0.1.0" {
		t.Errorf("CurrentVersion = %q, want %q", info.CurrentVersion, "0.1.0")
	}
}

func TestCheckForUpdatesReportsUpToDate(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v0.1.0","html_url":"https://example.com/release"}`))
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.UpdateAvailable {
		t.Error("expected UpdateAvailable to be false when versions match")
	}
}

func TestCheckForUpdatesNoReleasesYet(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0-dev", UpdateChannelStable)
	if err != nil {
		t.Fatalf("unexpected error on 404: %v", err)
	}
	if info.UpdateAvailable {
		t.Error("expected UpdateAvailable to be false when no releases exist")
	}
	if info.LatestVersion != "0.1.0-dev" {
		t.Errorf("LatestVersion = %q, want current version echoed back", info.LatestVersion)
	}
}

func TestCheckForUpdatesMalformedJSON(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{not valid json`))
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	if _, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable); err == nil {
		t.Error("expected an error decoding malformed JSON")
	}
}

func TestCheckForUpdatesServerError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	if _, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable); err == nil {
		t.Error("expected an error on HTTP 500")
	}
}

func TestCheckForUpdatesParsesAssets(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"tag_name": "v0.2.0",
			"html_url": "https://example.com/release",
			"assets": [
				{"name": "konnekt-windows-amd64.exe", "browser_download_url": "https://example.com/dl/exe", "size": 123},
				{"name": "checksums.txt", "browser_download_url": "https://example.com/dl/checksums", "size": 45}
			]
		}`))
	}))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(info.Assets) != 2 {
		t.Fatalf("expected 2 assets, got %d: %+v", len(info.Assets), info.Assets)
	}
	if info.Assets[0].Name != "konnekt-windows-amd64.exe" || info.Assets[0].DownloadURL != "https://example.com/dl/exe" || info.Assets[0].Size != 123 {
		t.Errorf("unexpected first asset: %+v", info.Assets[0])
	}
}

// --- Channel resolution ---------------------------------------------------

// stubRelease is one endpoint's canned response. A zero value 404s, which is
// what GitHub returns for a channel that has never published anything.
type stubRelease struct {
	status int // 0 means 404
	body   string
}

// channelStub serves both release endpoints from one handler and records which
// were hit, so a test can assert an endpoint was never contacted at all.
type channelStub struct {
	stable, snapshot stubRelease

	mu   sync.Mutex
	hits []string
}

func (c *channelStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	c.hits = append(c.hits, r.URL.Path)
	c.mu.Unlock()

	var stub stubRelease
	switch r.URL.Path {
	case updateRepoPath:
		stub = c.stable
	case updateSnapshotPath:
		stub = c.snapshot
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}

	if stub.status == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(stub.status)
	_, _ = w.Write([]byte(stub.body))
}

func (c *channelStub) hit(path string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, p := range c.hits {
		if p == path {
			return true
		}
	}
	return false
}

func newChannelServer(stable, snapshot stubRelease) (*channelStub, *httptest.Server) {
	stub := &channelStub{stable: stable, snapshot: snapshot}
	return stub, httptest.NewServer(stub)
}

func okJSON(body string) stubRelease { return stubRelease{status: http.StatusOK, body: body} }

func stableBody(tag string) string {
	return `{"tag_name":"` + tag + `","html_url":"https://example.com/stable"}`
}

func snapshotBody(version string) string {
	return `{"tag_name":"snapshot","name":"` + version + `","html_url":"https://example.com/snapshot"}`
}

func TestCheckForUpdatesSnapshotChannelPrefersNewerSnapshot(t *testing.T) {
	_, ts := newChannelServer(okJSON(stableBody("v0.1.0")), okJSON(snapshotBody("0.2.0-snapshot.202608290400.abc1234")))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.Channel != UpdateChannelSnapshot {
		t.Errorf("Channel = %q, want %q", info.Channel, UpdateChannelSnapshot)
	}
	if info.LatestVersion != "0.2.0-snapshot.202608290400.abc1234" {
		t.Errorf("LatestVersion = %q", info.LatestVersion)
	}
	if !info.UpdateAvailable {
		t.Error("expected UpdateAvailable")
	}
}

func TestCheckForUpdatesSnapshotChannelPrefersNewerStable(t *testing.T) {
	_, ts := newChannelServer(okJSON(stableBody("v0.3.0")), okJSON(snapshotBody("0.2.0-snapshot.202608290400.abc1234")))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.Channel != UpdateChannelStable {
		t.Errorf("Channel = %q, want %q — a stable release that has overtaken the snapshot wins", info.Channel, UpdateChannelStable)
	}
	if info.LatestVersion != "v0.3.0" {
		t.Errorf("LatestVersion = %q, want %q", info.LatestVersion, "v0.3.0")
	}
}

// The opt-out has to be real: a stable user's machine must never so much as ask
// GitHub about the snapshot channel.
func TestCheckForUpdatesStableChannelNeverAsksForTheSnapshot(t *testing.T) {
	stub, ts := newChannelServer(okJSON(stableBody("v0.2.0")), okJSON(snapshotBody("0.9.0-snapshot.202608290400.abc1234")))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelStable)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stub.hit(updateSnapshotPath) {
		t.Error("the stable channel requested the snapshot endpoint")
	}
	if info.LatestVersion != "v0.2.0" {
		t.Errorf("LatestVersion = %q, want the stable release", info.LatestVersion)
	}
}

// The self-update case this whole change exists for: a snapshot build follows
// the snapshot channel even though the stored setting says stable.
func TestCheckForUpdatesSnapshotBuildForcesSnapshotChannel(t *testing.T) {
	stub, ts := newChannelServer(stubRelease{}, okJSON(snapshotBody("0.1.0-snapshot.202608290400.bbbbbbb")))
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0-snapshot.202608280400.aaaaaaa", UpdateChannelStable)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !stub.hit(updateSnapshotPath) {
		t.Fatal("a snapshot build did not consult the snapshot endpoint")
	}
	if !info.UpdateAvailable {
		t.Error("expected the newer snapshot to be offered")
	}
	if info.LatestVersion != "0.1.0-snapshot.202608290400.bbbbbbb" {
		t.Errorf("LatestVersion = %q", info.LatestVersion)
	}
	if info.Channel != UpdateChannelSnapshot {
		t.Errorf("Channel = %q, want %q", info.Channel, UpdateChannelSnapshot)
	}
}

func TestCheckForUpdatesSnapshotTagMissing(t *testing.T) {
	_, ts := newChannelServer(okJSON(stableBody("v0.2.0")), stubRelease{})
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("unexpected error when no snapshot is published: %v", err)
	}
	if info.LatestVersion != "v0.2.0" || info.Channel != UpdateChannelStable {
		t.Errorf("expected a fall back to stable, got %q on %q", info.LatestVersion, info.Channel)
	}
}

// The migration window: between merging this and the next nightly, the snapshot
// release still carries the old decorated title. It must be ignored rather than
// parsed into nonsense.
func TestCheckForUpdatesSnapshotTitleUnusable(t *testing.T) {
	_, ts := newChannelServer(
		okJSON(stableBody("v0.2.0")),
		okJSON(`{"tag_name":"snapshot","name":"Snapshot 0.1.0-dev.snapshot.00400f8"}`),
	)
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("unexpected error on an unparseable snapshot title: %v", err)
	}
	if info.LatestVersion != "v0.2.0" || info.Channel != UpdateChannelStable {
		t.Errorf("expected a fall back to stable, got %q on %q", info.LatestVersion, info.Channel)
	}
}

func TestCheckForUpdatesBothChannelsEmpty(t *testing.T) {
	_, ts := newChannelServer(stubRelease{}, stubRelease{})
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("unexpected error when nothing is published: %v", err)
	}
	if info.UpdateAvailable {
		t.Error("expected no update")
	}
	if info.LatestVersion != "0.1.0" {
		t.Errorf("LatestVersion = %q, want the current version echoed back", info.LatestVersion)
	}
	if info.Channel != UpdateChannelSnapshot {
		t.Errorf("Channel = %q, want the channel the check ran on", info.Channel)
	}
}

// Half a check is worth more than none: whichever endpoint answered wins.
func TestCheckForUpdatesStableFailsSnapshotSucceeds(t *testing.T) {
	_, ts := newChannelServer(
		stubRelease{status: http.StatusInternalServerError, body: "boom"},
		okJSON(snapshotBody("0.2.0-snapshot.202608290400.abc1234")),
	)
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("expected the snapshot to carry the check: %v", err)
	}
	if info.LatestVersion != "0.2.0-snapshot.202608290400.abc1234" {
		t.Errorf("LatestVersion = %q", info.LatestVersion)
	}
}

func TestCheckForUpdatesSnapshotFailsStableSucceeds(t *testing.T) {
	_, ts := newChannelServer(
		okJSON(stableBody("v0.2.0")),
		stubRelease{status: http.StatusInternalServerError, body: "boom"},
	)
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("expected stable to carry the check: %v", err)
	}
	if info.LatestVersion != "v0.2.0" {
		t.Errorf("LatestVersion = %q", info.LatestVersion)
	}
}

func TestCheckForUpdatesBothEndpointsFail(t *testing.T) {
	_, ts := newChannelServer(
		stubRelease{status: http.StatusInternalServerError, body: "boom"},
		stubRelease{status: http.StatusInternalServerError, body: "boom"},
	)
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	if _, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot); err == nil {
		t.Error("expected an error when every endpoint consulted failed")
	}
}

// The "installs the release it offered" guarantee, at the data level: both
// releases publish identically named assets, so only the URLs distinguish them.
// This is what catches a refactor that resolves the version from one release
// and the assets from another.
func TestCheckForUpdatesSnapshotAssetsComeFromTheSnapshotRelease(t *testing.T) {
	assets := func(prefix string) string {
		return `,"assets":[` +
			`{"name":"konnekt-linux-amd64","browser_download_url":"https://example.com/` + prefix + `/bin","size":1},` +
			`{"name":"checksums.txt","browser_download_url":"https://example.com/` + prefix + `/checksums","size":2}]`
	}
	_, ts := newChannelServer(
		okJSON(`{"tag_name":"v0.1.0"`+assets("stable")+`}`),
		okJSON(`{"tag_name":"snapshot","name":"0.2.0-snapshot.202608290400.abc1234"`+assets("snapshot")+`}`),
	)
	defer ts.Close()

	svc := &UpdateService{http: ts.Client(), baseURL: ts.URL}
	info, err := svc.CheckForUpdates(context.Background(), "0.1.0", UpdateChannelSnapshot)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(info.Assets) != 2 {
		t.Fatalf("expected 2 assets, got %+v", info.Assets)
	}
	for _, a := range info.Assets {
		if !strings.Contains(a.DownloadURL, "/snapshot/") {
			t.Errorf("asset %q came from the wrong release: %s", a.Name, a.DownloadURL)
		}
	}
}

// platformAssetNameFor takes goos/goarch as explicit parameters (rather than
// reading runtime.GOOS/GOARCH) specifically so every platform's naming can be
// tested from a single dev machine, regardless of what it's actually running.
func TestPlatformAssetNameFor(t *testing.T) {
	cases := []struct {
		goos, goarch string
		want         string
		wantErr      bool
	}{
		{"windows", "amd64", "konnekt-windows-amd64.exe", false},
		{"windows", "arm64", "konnekt-windows-arm64.exe", false},
		{"linux", "amd64", "konnekt-linux-amd64", false},
		{"linux", "arm64", "konnekt-linux-arm64", false},
		{"darwin", "amd64", "", true},
	}
	for _, c := range cases {
		got, err := platformAssetNameFor(c.goos, c.goarch)
		if c.wantErr {
			if err == nil {
				t.Errorf("platformAssetNameFor(%q, %q): expected an error, got %q", c.goos, c.goarch, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("platformAssetNameFor(%q, %q): unexpected error: %v", c.goos, c.goarch, err)
		}
		if got != c.want {
			t.Errorf("platformAssetNameFor(%q, %q) = %q, want %q", c.goos, c.goarch, got, c.want)
		}
	}
}

func TestSelectPlatformAssets(t *testing.T) {
	assets := []models.UpdateAsset{
		{Name: "konnekt-windows-amd64.exe", DownloadURL: "https://example.com/exe"},
		{Name: "checksums.txt", DownloadURL: "https://example.com/checksums"},
	}

	asset, checksums, err := selectPlatformAssets(assets, "windows", "amd64")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if asset.Name != "konnekt-windows-amd64.exe" {
		t.Errorf("asset.Name = %q", asset.Name)
	}
	if checksums.Name != "checksums.txt" {
		t.Errorf("checksums.Name = %q", checksums.Name)
	}

	if _, _, err := selectPlatformAssets(assets, "darwin", "amd64"); err == nil {
		t.Error("expected an error for a platform with no published asset naming")
	}

	if _, _, err := selectPlatformAssets(nil, "windows", "amd64"); err == nil {
		t.Error("expected an error when the platform's asset is missing from the release")
	}

	missingChecksums := []models.UpdateAsset{{Name: "konnekt-windows-amd64.exe"}}
	if _, _, err := selectPlatformAssets(missingChecksums, "windows", "amd64"); err == nil {
		t.Error("expected an error when checksums.txt is missing from the release")
	}
}

func TestParseChecksums(t *testing.T) {
	body := "ABCDEF0123  konnekt-windows-amd64.exe\n" +
		"\n" +
		"1122334455 konnekt-windows-arm64.exe\n" +
		"malformed-line-with-no-filename\n"

	got := parseChecksums([]byte(body))

	if got["konnekt-windows-amd64.exe"] != "abcdef0123" {
		t.Errorf("amd64 entry = %q, want lowercased %q", got["konnekt-windows-amd64.exe"], "abcdef0123")
	}
	if got["konnekt-windows-arm64.exe"] != "1122334455" {
		t.Errorf("arm64 entry = %q", got["konnekt-windows-arm64.exe"])
	}
	if len(got) != 2 {
		t.Errorf("expected 2 parsed entries (malformed line skipped), got %d: %v", len(got), got)
	}
}

// TestDownloadAndApplySuccess exercises the real download+checksum-verify+
// selfupdate.Apply path end-to-end, with TargetPath pointed at a temp file
// instead of the actual running executable — the seam downloadAndApply exists
// for. Confirms the temp file's contents are replaced with the served asset.
func TestDownloadAndApplySuccess(t *testing.T) {
	newContent := []byte("konnekt-fake-binary-content-v2")
	sum := sha256.Sum256(newContent)
	hexSum := hex.EncodeToString(sum[:])

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(newContent)))
		_, _ = w.Write(newContent)
	}))
	defer ts.Close()

	target := filepath.Join(t.TempDir(), "konnekt-target.exe")
	if err := os.WriteFile(target, []byte("old-binary-content"), 0755); err != nil {
		t.Fatalf("seed target file: %v", err)
	}

	svc := &UpdateService{http: ts.Client()}
	asset := models.UpdateAsset{Name: "konnekt-windows-amd64.exe", DownloadURL: ts.URL}
	if err := svc.downloadAndApply(context.Background(), asset, hexSum, target); err != nil {
		t.Fatalf("downloadAndApply: %v", err)
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target after apply: %v", err)
	}
	if string(got) != string(newContent) {
		t.Errorf("target content = %q, want %q", got, newContent)
	}
}

// TestDownloadAndApplyChecksumMismatch confirms a bad checksum is rejected
// before the target file is ever touched — selfupdate verifies before it
// commits the swap, so the original binary must survive a failed update.
func TestDownloadAndApplyChecksumMismatch(t *testing.T) {
	newContent := []byte("konnekt-fake-binary-content-v2")
	wrongSum := sha256.Sum256([]byte("this-is-not-the-real-content"))
	hexSum := hex.EncodeToString(wrongSum[:])

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(newContent)
	}))
	defer ts.Close()

	target := filepath.Join(t.TempDir(), "konnekt-target.exe")
	original := []byte("old-binary-content")
	if err := os.WriteFile(target, original, 0755); err != nil {
		t.Fatalf("seed target file: %v", err)
	}

	svc := &UpdateService{http: ts.Client()}
	asset := models.UpdateAsset{Name: "konnekt-windows-amd64.exe", DownloadURL: ts.URL}
	if err := svc.downloadAndApply(context.Background(), asset, hexSum, target); err == nil {
		t.Fatal("expected an error on checksum mismatch")
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target after failed apply: %v", err)
	}
	if string(got) != string(original) {
		t.Errorf("target file was modified despite the checksum mismatch: got %q, want unchanged %q", got, original)
	}
}
