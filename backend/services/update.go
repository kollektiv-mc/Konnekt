package services

import (
	"context"
	_ "crypto/sha256" // registers crypto.SHA256, which selfupdate.Options' default Hash relies on
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/minio/selfupdate"
	"konnekt/backend/models"
)

const (
	updateAPIBase = "https://api.github.com"
	// The stable channel. /releases/latest skips prereleases by definition,
	// which is what keeps the rolling `snapshot` prerelease off it.
	updateRepoPath = "/repos/kollektiv-mc/Konnekt/releases/latest"
	// The snapshot channel, addressed by tag because that is the only way to
	// reach a prerelease. `snapshot` is a rolling literal that .github/workflows/
	// snapshot.yml deletes and recreates on every nightly build.
	updateSnapshotPath = "/repos/kollektiv-mc/Konnekt/releases/tags/snapshot"
	updateUserAgent    = "Konnekt-UpdateChecker"

	updateChecksumsAssetName = "checksums.txt"

	// The two legal values of models.AppSettings.UpdateChannel, mirrored by the
	// frontend's hand-narrowed AppSettings['updateChannel'] union.
	UpdateChannelStable   = "stable"
	UpdateChannelSnapshot = "snapshot"

	// snapshotVersionMarker is what snapshot.yml stamps into a snapshot build:
	// <base>-snapshot.<YYYYMMDDHHMM>.<sha7>. devVersionMarker is what an
	// unstamped `wails dev` build carries. They are disjoint on purpose, so
	// that "is this installable" and "is this a snapshot" are separate
	// questions with separate answers.
	snapshotVersionMarker = "-snapshot."
	devVersionMarker      = "-dev"
)

// IsSnapshotVersion reports whether v is a build from the snapshot channel.
func IsSnapshotVersion(v string) bool { return strings.Contains(v, snapshotVersionMarker) }

func isLocalDevVersion(v string) bool { return strings.Contains(v, devVersionMarker) }

// IsInstallableBuild reports whether the running build has a published artifact
// behind it. Everything except a local `wails dev` build does: a snapshot is a
// real, downloadable, checksummed binary and can replace itself in place. The
// IsSnapshotVersion arm is belt-and-braces (under the current stamp a snapshot
// carries no "-dev" at all) so reintroducing that marker cannot silently
// re-strand the snapshot channel the way it did before.
func IsInstallableBuild(v string) bool { return IsSnapshotVersion(v) || !isLocalDevVersion(v) }

// EffectiveChannel resolves the channel a check actually runs on. A build that
// is itself a snapshot follows the snapshot channel whatever the setting says,
// because otherwise a snapshot could never update itself, which is the whole
// point of the channel. An empty setting (a settings file written before the
// field existed) means stable, as does any value that isn't recognised.
func EffectiveChannel(setting, currentVersion string) string {
	if IsSnapshotVersion(currentVersion) || setting == UpdateChannelSnapshot {
		return UpdateChannelSnapshot
	}
	return UpdateChannelStable
}

// ErrUpdatePermission signals that the running binary can't be replaced
// in-place (e.g. an install under Program Files without an elevated
// process). It is wrapped into the returned error so its text reaches the
// user, but nothing matches it with errors.Is: the only consumer is the
// frontend, across the Wails IPC boundary, where a Go sentinel arrives as a
// plain message string. Giving it a real caller means giving the frontend
// something structured to branch on — see agent_docs/HEALTH_CHECKLIST.md's
// "P2 — Cleanups".
var ErrUpdatePermission = errors.New("update install: insufficient permissions to replace the running executable")

// UpdateService checks GitHub Releases for a newer Konnekt version, and can
// download + apply that update in place. GitHub Releases *is* the version
// database here — each release is a git tag with per-platform binaries
// attached as assets, no separate backend needed. baseURL is injectable so
// tests can point it at an httptest.Server — the same shape ModrinthClient
// now uses.
type UpdateService struct {
	http    *http.Client
	baseURL string
	bus     *EventBus
}

func NewUpdateService() *UpdateService {
	return &UpdateService{
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: updateAPIBase,
	}
}

func (s *UpdateService) SetBus(b *EventBus) { s.bus = b }

type ghAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"browser_download_url"`
	Size        int64  `json:"size"`
}

type ghRelease struct {
	TagName string `json:"tag_name"`
	// Name is the release title. On the snapshot channel it is the only place
	// the version can come from — see releaseVersion.
	Name        string    `json:"name"`
	HTMLURL     string    `json:"html_url"`
	Body        string    `json:"body"`
	PublishedAt string    `json:"published_at"`
	Assets      []ghAsset `json:"assets"`
}

// releaseVersion returns the version a release advertises on channel.
//
// A tagged release carries it in tag_name. The snapshot release cannot: its tag
// is the rolling literal "snapshot", which is not a version at all, so
// snapshot.yml publishes the bare version string as the release *title* and
// this reads it from there.
//
// The title's shape is checked rather than trusted. Anything that is not a
// single snapshot-formatted token (a hand-edited title, or the pre-2026-08
// "Snapshot 0.1.0-dev.snapshot.<sha>" format) yields "", which makes the
// snapshot simply not a candidate. Failing closed is the right call: the
// alternative is comparing a sentence against a version.
func releaseVersion(r ghRelease, channel string) string {
	if channel != UpdateChannelSnapshot {
		return r.TagName
	}
	name := strings.TrimSpace(r.Name)
	if strings.ContainsAny(name, " \t") || !IsSnapshotVersion(name) {
		return ""
	}
	return name
}

// candidate is one release the checker could offer: the version it advertises
// and the channel it was found on.
type candidate struct {
	channel string
	version string
	rel     ghRelease
}

// fetchCandidate GETs one release endpoint. ok=false with a nil error means
// "nothing usable published here" — either a 404, which is the expected state
// before a channel's first publish, or a 200 whose version can't be read.
func (s *UpdateService) fetchCandidate(ctx context.Context, path, channel string) (candidate, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		return candidate{}, false, fmt.Errorf("update check: build request: %w", err)
	}
	req.Header.Set("User-Agent", updateUserAgent)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.http.Do(req)
	if err != nil {
		return candidate{}, false, fmt.Errorf("update check: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return candidate{}, false, nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return candidate{}, false, fmt.Errorf("update check: read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return candidate{}, false, fmt.Errorf("update check: HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var raw ghRelease
	if err := json.Unmarshal(body, &raw); err != nil {
		return candidate{}, false, fmt.Errorf("update check: decode response: %w", err)
	}

	version := releaseVersion(raw, channel)
	if version == "" {
		return candidate{}, false, nil
	}
	return candidate{channel: channel, version: version, rel: raw}, true, nil
}

// resolveCandidate picks the release to offer on channel.
//
// Stable asks /releases/latest and nothing else. The snapshot endpoint is never
// even contacted, so opting out of snapshots is real rather than cosmetic.
//
// Snapshot asks both and takes the higher version, ties going to stable. That
// carries a snapshot user onto a stable release the moment one overtakes their
// build, instead of stranding them on a channel that has fallen behind.
//
// An error comes back only when every endpoint consulted failed. A snapshot
// user whose /releases/latest lookup is rate-limited still gets the snapshot,
// and vice versa: a background check that half worked is worth more than one
// that reports nothing. The cost is that a half-rate-limited check looks like a
// clean result, which is the trade being made deliberately.
func (s *UpdateService) resolveCandidate(ctx context.Context, channel string) (candidate, bool, error) {
	stable, stableOK, stableErr := s.fetchCandidate(ctx, updateRepoPath, UpdateChannelStable)
	if channel != UpdateChannelSnapshot {
		return stable, stableOK, stableErr
	}

	snap, snapOK, snapErr := s.fetchCandidate(ctx, updateSnapshotPath, UpdateChannelSnapshot)

	switch {
	case stableOK && snapOK:
		if compareVersions(snap.version, stable.version) > 0 {
			return snap, true, nil
		}
		return stable, true, nil
	case stableOK:
		return stable, true, nil
	case snapOK:
		return snap, true, nil
	case stableErr != nil:
		return candidate{}, false, stableErr
	case snapErr != nil:
		return candidate{}, false, snapErr
	default:
		return candidate{}, false, nil // neither channel has published anything yet
	}
}

// CheckForUpdates compares currentVersion (e.g. "0.1.0", "0.1.0-dev" or
// "0.1.0-snapshot.202608290400.a1b2c3d") against the newest release on the
// channel resolved from channelSetting. A channel with nothing published yet
// reports "up to date" rather than an error — that's the expected state until
// the project cuts its first release on it.
func (s *UpdateService) CheckForUpdates(ctx context.Context, currentVersion, channelSetting string) (models.UpdateInfo, error) {
	channel := EffectiveChannel(channelSetting, currentVersion)

	c, ok, err := s.resolveCandidate(ctx, channel)
	if err != nil {
		return models.UpdateInfo{}, err
	}
	if !ok {
		// Channel is still reported, so the UI can say what was checked.
		return models.UpdateInfo{CurrentVersion: currentVersion, LatestVersion: currentVersion, Channel: channel}, nil
	}

	assets := make([]models.UpdateAsset, 0, len(c.rel.Assets))
	for _, a := range c.rel.Assets {
		assets = append(assets, models.UpdateAsset{Name: a.Name, DownloadURL: a.DownloadURL, Size: a.Size})
	}

	return models.UpdateInfo{
		CurrentVersion:  currentVersion,
		LatestVersion:   c.version,
		UpdateAvailable: compareVersions(c.version, currentVersion) > 0,
		Channel:         c.channel,
		ReleaseURL:      c.rel.HTMLURL,
		ReleaseNotes:    c.rel.Body,
		PublishedAt:     c.rel.PublishedAt,
		Assets:          assets,
	}, nil
}

// platformAssetNameFor returns the release asset name expected for goos/goarch,
// matching the naming convention release.yml publishes under
// (konnekt-<goos>-<goarch>[.exe]). Windows and Linux (amd64, raw binary — the
// RPM is a separate, non-self-updating asset) are shipped; other platforms
// report an error rather than guessing a name nothing publishes. Takes
// goos/goarch as parameters (rather than reading runtime.GOOS/GOARCH directly)
// so it's testable for every platform from any single dev machine.
func platformAssetNameFor(goos, goarch string) (string, error) {
	switch goos {
	case "windows":
		return fmt.Sprintf("konnekt-windows-%s.exe", goarch), nil
	case "linux":
		return fmt.Sprintf("konnekt-linux-%s", goarch), nil
	default:
		return "", fmt.Errorf("update install: no self-update asset published for %s/%s yet", goos, goarch)
	}
}

// selectPlatformAssets picks the release asset matching goos/goarch plus the
// checksums.txt asset out of a release's asset list.
func selectPlatformAssets(assets []models.UpdateAsset, goos, goarch string) (asset, checksums models.UpdateAsset, err error) {
	name, err := platformAssetNameFor(goos, goarch)
	if err != nil {
		return models.UpdateAsset{}, models.UpdateAsset{}, err
	}
	asset, ok := findAsset(assets, name)
	if !ok {
		return models.UpdateAsset{}, models.UpdateAsset{}, fmt.Errorf("update install: no asset named %q", name)
	}
	checksums, ok = findAsset(assets, updateChecksumsAssetName)
	if !ok {
		return models.UpdateAsset{}, models.UpdateAsset{}, fmt.Errorf("update install: missing %s", updateChecksumsAssetName)
	}
	return asset, checksums, nil
}

func findAsset(assets []models.UpdateAsset, name string) (models.UpdateAsset, bool) {
	for _, a := range assets {
		if a.Name == name {
			return a, true
		}
	}
	return models.UpdateAsset{}, false
}

// parseChecksums parses a sha256sum-style "checksums.txt" body ("<hex>
// <filename>" per line, two spaces between fields) into a name→hex map.
func parseChecksums(data []byte) map[string]string {
	out := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		out[fields[len(fields)-1]] = strings.ToLower(fields[0])
	}
	return out
}

// progressReader wraps an io.Reader, emitting update:progress events as it's
// consumed. total <= 0 (unknown Content-Length) is reported as -1 forever.
type progressReader struct {
	r        io.Reader
	total    int64
	read     int64
	lastPct  int
	onUpdate func(percent int)
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.r.Read(buf)
	if n > 0 && p.total > 0 {
		p.read += int64(n)
		pct := int(p.read * 100 / p.total)
		if pct != p.lastPct {
			p.lastPct = pct
			p.onUpdate(pct)
		}
	}
	return n, err
}

// DownloadAndInstallUpdate fetches the latest release, downloads the asset
// matching the running platform, verifies it against checksums.txt, and
// replaces the running executable in place via selfupdate.Apply — which
// handles the Windows "can't overwrite a running exe" rename dance and rolls
// back automatically on a failed write. The caller is responsible for
// relaunching the process afterward; this method never restarts anything
// itself.
//
// It re-runs CheckForUpdates rather than trusting anything the frontend passed
// back. That also gives the "installs the release it offered" guarantee for
// free: resolution is a pure function of (currentVersion, channelSetting) plus
// GitHub's state, and info.Assets are that candidate's assets, so the platform
// asset and the checksums.txt below both come from the release that was
// offered. No separate snapshot gate is needed either, because on the stable
// channel resolveCandidate never contacts the snapshot endpoint at all.
//
// One consequence worth naming: if the nightly republishes between the check
// and the install, this picks up the newer snapshot. Binary and checksums still
// come from one release, so the install is consistent, just newer than the
// version the UI named.
func (s *UpdateService) DownloadAndInstallUpdate(ctx context.Context, currentVersion, channelSetting string) error {
	info, err := s.CheckForUpdates(ctx, currentVersion, channelSetting)
	if err != nil {
		return fmt.Errorf("update install: check failed: %w", err)
	}
	if !info.UpdateAvailable {
		return fmt.Errorf("update install: no update available")
	}

	asset, checksumAsset, err := selectPlatformAssets(info.Assets, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}

	checksumBody, err := s.fetchAsset(ctx, checksumAsset.DownloadURL)
	if err != nil {
		return fmt.Errorf("update install: download checksums: %w", err)
	}
	hexSum, ok := parseChecksums(checksumBody)[asset.Name]
	if !ok {
		return fmt.Errorf("update install: %s has no entry for %q", updateChecksumsAssetName, asset.Name)
	}

	// "" targetPath means selfupdate replaces the running executable itself.
	return s.downloadAndApply(ctx, asset, hexSum, "")
}

// downloadAndApply streams asset.DownloadURL, verifies it against hexSum
// (hex-encoded SHA256), and applies it via selfupdate.Apply to targetPath.
// An empty targetPath means "the running executable" (selfupdate's own
// default); tests pass a temp file path instead so the real binary is never
// touched. Split out from DownloadAndInstallUpdate as a test seam — the
// platform/asset-selection step above depends on runtime.GOOS/GOARCH, which
// this doesn't need to know about.
func (s *UpdateService) downloadAndApply(ctx context.Context, asset models.UpdateAsset, hexSum string, targetPath string) error {
	checksum, err := hex.DecodeString(hexSum)
	if err != nil {
		return fmt.Errorf("update install: decode checksum: %w", err)
	}

	opts := selfupdate.Options{Checksum: checksum, TargetPath: targetPath} // Hash defaults to crypto.SHA256, matching release.yml's checksums.txt
	if err := opts.CheckPermissions(); err != nil {
		return fmt.Errorf("%w: %v", ErrUpdatePermission, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.DownloadURL, nil)
	if err != nil {
		return fmt.Errorf("update install: build download request: %w", err)
	}
	req.Header.Set("User-Agent", updateUserAgent)

	dlClient := &http.Client{} // no hard timeout; bounded by ctx
	resp, err := dlClient.Do(req)
	if err != nil {
		return fmt.Errorf("update install: download %s: %w", asset.Name, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("update install: download %s: HTTP %d", asset.Name, resp.StatusCode)
	}

	reader := &progressReader{
		r:       resp.Body,
		total:   resp.ContentLength,
		lastPct: -1,
		onUpdate: func(pct int) {
			s.bus.Emit(EventUpdateProgress, map[string]any{"percent": pct})
		},
	}

	if err := selfupdate.Apply(reader, opts); err != nil {
		if rerr := selfupdate.RollbackError(err); rerr != nil {
			return fmt.Errorf("update install: apply failed and rollback failed, reinstall manually: %w", rerr)
		}
		return fmt.Errorf("update install: apply failed: %w", err)
	}
	return nil
}

// fetchAsset downloads a small release asset (checksums.txt) fully into memory.
func (s *UpdateService) fetchAsset(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", updateUserAgent)

	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// compareVersions returns -1 if a < b, 0 if equal, 1 if a > b, treating both
// as vMAJOR.MINOR.PATCH[-prerelease] (a leading "v" is optional on either
// side). A release sorts higher than the same MAJOR.MINOR.PATCH with a
// prerelease suffix; two prerelease suffixes fall back to a string compare
// (good enough for "-dev" vs. a real prerelease tag, not full semver
// precedence).
func compareVersions(a, b string) int {
	coreA, preA := splitVersion(a)
	coreB, preB := splitVersion(b)

	partsA := parseVersionCore(coreA)
	partsB := parseVersionCore(coreB)

	for i := 0; i < 3; i++ {
		if partsA[i] != partsB[i] {
			if partsA[i] < partsB[i] {
				return -1
			}
			return 1
		}
	}

	switch {
	case preA == "" && preB == "":
		return 0
	case preA == "" && preB != "":
		return 1
	case preA != "" && preB == "":
		return -1
	default:
		return strings.Compare(preA, preB)
	}
}

func splitVersion(v string) (core string, prerelease string) {
	v = strings.TrimPrefix(v, "v")
	if idx := strings.IndexByte(v, '-'); idx >= 0 {
		return v[:idx], v[idx+1:]
	}
	return v, ""
}

func parseVersionCore(core string) [3]int {
	var out [3]int
	parts := strings.SplitN(core, ".", 3)
	for i := 0; i < len(parts) && i < 3; i++ {
		n, err := strconv.Atoi(parts[i])
		if err != nil {
			continue // non-numeric component treated as 0
		}
		out[i] = n
	}
	return out
}
