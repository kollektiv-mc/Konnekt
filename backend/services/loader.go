package services

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"konnekt/backend/models"
)

// How long a fetched version list stays good. The list changes a few times a
// week at most, and the manager re-reads it every time the panel opens.
const loaderVersionCacheTTL = 10 * time.Minute

// The launch files an in-place loader update rewrites. Snapshotting these is
// what makes the update reversible: everything else the installer adds lives
// under libraries/ and is additive, keyed by version, and checksum-verified by
// the installer on its next run.
var loaderLaunchFiles = []string{"run.sh", "run.bat", "user_jvm_args.txt"}

// loaderInstaller is the slice of InstallerService a loader update needs. It is
// an interface so a test can substitute one that lays down an install directly
// instead of shelling out to java — which is what makes the rollback and
// post-install verification paths reachable in a test at all.
type loaderInstaller interface {
	runInstaller(jarPath, targetDir string) error
}

type loaderVersionCache struct {
	versions  []models.LoaderVersion
	fetchedAt time.Time
}

// LoaderService reports and updates the mod loader a server runs on.
//
// It owns no install mechanics of its own: the download lands in a temp file,
// InspectInstaller vouches for it, and InstallerService.runInstaller does the
// work. What this adds is everything around that — refusing at the wrong
// moment, a snapshot to go back to, and checking afterwards that the install
// actually moved the server.
type LoaderService struct {
	cfg       *ConfigService
	srv       *ServerService
	backup    *BackupService
	installer loaderInstaller
	providers map[string]LoaderProvider
	bus       *EventBus
	ctx       context.Context
	dataDir   string

	// http is only for fetching installer jars; each provider owns its own
	// client for metadata.
	http *http.Client

	mu       sync.Mutex
	updating bool

	cacheMu sync.Mutex
	cache   map[string]loaderVersionCache // provider ID → entry
}

func NewLoaderService(cfg *ConfigService, srv *ServerService, backup *BackupService, installer *InstallerService) *LoaderService {
	neoforge := NewNeoForgeClient()
	return &LoaderService{
		cfg:       cfg,
		srv:       srv,
		backup:    backup,
		installer: installer,
		providers: map[string]LoaderProvider{neoforge.ID(): neoforge},
		// No hard timeout: an installer jar is tens of megabytes on whatever
		// connection the user has, and the context bounds it.
		http:  &http.Client{},
		cache: make(map[string]loaderVersionCache),
	}
}

func (s *LoaderService) SetContext(ctx context.Context) { s.ctx = ctx }
func (s *LoaderService) SetBus(b *EventBus)             { s.bus = b }
func (s *LoaderService) SetDataDir(dir string)          { s.dataDir = dir }

// Status describes the loader a server is on, and whether Konnekt can move it.
func (s *LoaderService) Status(serverID string) (models.LoaderStatus, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return models.LoaderStatus{}, err
	}

	version, source := detectLoaderVersion(cfg.JarPath, cfg.WorkingDir)
	if version == "" && cfg.LoaderVersion != "" {
		version, source = cfg.LoaderVersion, "config"
	}

	status := models.LoaderStatus{
		Loader:           cfg.Loader,
		InstalledVersion: version,
		MCVersion:        cfg.MCVersion,
		Source:           source,
	}
	status.Managed, status.Reason = s.manageable(cfg.Loader, source)
	return status, nil
}

// manageable decides whether an in-place update is possible, and says why not
// when it is not. The reason is shown to the user as written.
func (s *LoaderService) manageable(loader, source string) (bool, string) {
	if loader == "" {
		return false, "Konnekt has not detected which loader this server uses."
	}
	if _, ok := s.providers[loader]; !ok {
		return false, fmt.Sprintf("Konnekt cannot update %s servers yet.", loader)
	}
	// An update rewrites the launcher script and adds a libraries tree, so it
	// only means anything for an install that launches through them. A server
	// pointed at a runnable jar launches with -jar and never reads the argfile.
	if source != "script" && source != "libraries" {
		return false, "No NeoForge install was found in this server's directory."
	}
	return true, ""
}

// AvailableVersions lists the builds this server could move to: the ones
// targeting its Minecraft version, newest first. The fetch is cached per
// provider, since the filter is the only per-server part.
func (s *LoaderService) AvailableVersions(serverID string) ([]models.LoaderVersion, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return nil, err
	}
	provider, ok := s.providers[cfg.Loader]
	if !ok {
		return nil, fmt.Errorf("Konnekt cannot list versions for %q servers", cfg.Loader)
	}

	all, err := s.cachedVersions(provider)
	if err != nil {
		return nil, err
	}

	// An undetected Minecraft version means no filter rather than no results:
	// showing everything lets the user pick, showing nothing looks broken.
	if cfg.MCVersion == "" {
		return all, nil
	}
	out := make([]models.LoaderVersion, 0, len(all))
	for _, v := range all {
		if v.MCVersion == cfg.MCVersion {
			out = append(out, v)
		}
	}
	return out, nil
}

func (s *LoaderService) cachedVersions(provider LoaderProvider) ([]models.LoaderVersion, error) {
	id := provider.ID()

	s.cacheMu.Lock()
	if entry, ok := s.cache[id]; ok && time.Since(entry.fetchedAt) < loaderVersionCacheTTL {
		versions := entry.versions
		s.cacheMu.Unlock()
		return versions, nil
	}
	s.cacheMu.Unlock()

	versions, err := provider.Versions(s.context(), "")
	if err != nil {
		return nil, err
	}

	s.cacheMu.Lock()
	s.cache[id] = loaderVersionCache{versions: versions, fetchedAt: time.Now()}
	s.cacheMu.Unlock()
	return versions, nil
}

// Update moves a server to a different loader build in place.
//
// Everything that can be judged up front is judged synchronously and returned
// as an error, so the UI can refuse the click. Past that point the work runs in
// the background and reports through loader:update-started / -finished /
// -failed, with the installer's own output on install:log.
func (s *LoaderService) Update(req models.LoaderUpdateRequest) error {
	if req.Version == "" {
		return fmt.Errorf("no loader version given")
	}

	cfg, err := s.cfg.GetServerConfig(req.ServerID)
	if err != nil {
		return err
	}

	// The JVM holds the libraries it launched from, and rewriting the launch
	// files under a live server leaves it running something that no longer
	// matches its own directory. Mirrors RestoreBackup's refusal.
	if s.srv.ActiveServerID() == req.ServerID {
		return fmt.Errorf("stop the server before updating its loader")
	}

	version, source := detectLoaderVersion(cfg.JarPath, cfg.WorkingDir)
	if managed, reason := s.manageable(cfg.Loader, source); !managed {
		return fmt.Errorf("%s", reason)
	}
	if version == req.Version {
		return fmt.Errorf("%s is already on %s", cfg.Name, req.Version)
	}

	provider := s.providers[cfg.Loader]

	s.mu.Lock()
	if s.updating {
		s.mu.Unlock()
		return fmt.Errorf("a loader update is already running")
	}
	s.updating = true
	s.mu.Unlock()

	go s.runUpdate(*cfg, req, provider, version)
	return nil
}

func (s *LoaderService) runUpdate(cfg models.ServerConfig, req models.LoaderUpdateRequest, provider LoaderProvider, from string) {
	defer func() {
		s.mu.Lock()
		s.updating = false
		s.mu.Unlock()
	}()

	s.bus.Emit(EventLoaderUpdateStarted, map[string]any{
		"serverID": cfg.ID,
		"from":     from,
		"to":       req.Version,
	})
	s.narrate(cfg.ID, fmt.Sprintf("Updating %s from %s to %s", cfg.Loader, orUnknown(from), req.Version))

	snapshot, err := s.updateWithRollback(cfg, req, provider, from)
	if err != nil {
		s.bus.Emit(EventLoaderUpdateFailed, map[string]any{
			"serverID":   cfg.ID,
			"error":      err.Error(),
			"rolledBack": snapshot,
		})
		s.narrateFailed(cfg.ID, "Loader update failed: "+err.Error())
		return
	}

	s.bus.Emit(EventLoaderUpdateFinished, map[string]any{
		"serverID": cfg.ID,
		"version":  req.Version,
	})
	s.narrateDone(cfg.ID, fmt.Sprintf("Loader updated to %s", req.Version))
}

// updateWithRollback runs the update, returning whether a snapshot was restored
// alongside any error. Split from runUpdate so the ordering of the guarded
// steps reads top to bottom.
func (s *LoaderService) updateWithRollback(cfg models.ServerConfig, req models.LoaderUpdateRequest, provider LoaderProvider, from string) (rolledBack bool, err error) {
	if req.FullBackup {
		s.log("Backing up the server before the update…")
		if _, err := s.backup.CreateBackup(cfg.ID); err != nil {
			return false, fmt.Errorf("backup before update: %w", err)
		}
	}

	snapshotDir, err := s.snapshotLaunchFiles(cfg, from)
	if err != nil {
		return false, fmt.Errorf("snapshot launch files: %w", err)
	}

	jarPath, err := s.downloadInstaller(provider, req.Version)
	if err != nil {
		return false, err
	}
	defer func() {
		// The jar is ours and disposable; a failure to clean it up costs a file
		// in the temp directory and nothing the caller can act on.
		if rmErr := os.RemoveAll(filepath.Dir(jarPath)); rmErr != nil {
			slog.Warn("loader: remove installer temp dir", "error", rmErr)
		}
	}()

	// Nothing in the server directory has been touched yet, so a failure up to
	// here needs no rollback.
	s.log("Running the NeoForge installer…")
	if err := s.installer.runInstaller(jarPath, cfg.WorkingDir); err != nil {
		return s.rollback(cfg, snapshotDir), fmt.Errorf("installer: %w", err)
	}

	// The installer can exit 0 having left the launcher pointed at the old
	// build — a partial run, or a version it silently declined. Nothing else in
	// the app would notice, and the server would start on the old loader while
	// the UI claimed the new one.
	installed, _ := detectLoaderVersion(cfg.JarPath, cfg.WorkingDir)
	if installed != req.Version {
		return s.rollback(cfg, snapshotDir), fmt.Errorf(
			"the installer finished but this server still launches %s, not %s",
			orUnknown(installed), req.Version)
	}

	cfg.LoaderVersion = req.Version
	if mc := mcVersionForNeoForge(req.Version); mc != "" {
		cfg.MCVersion = mc
	}
	if err := s.cfg.SaveServerConfig(cfg); err != nil {
		// The install is good and the server will start; only Konnekt's record
		// of it is stale, and the next Summary re-detects from disk anyway.
		// Rolling a working install back over a bookkeeping failure would be
		// the worse trade.
		slog.Error("loader: record updated version", "error", err)
	}
	return false, nil
}

// snapshotLaunchFiles copies the files an update rewrites into a timestamped
// directory under the app data dir, and returns that directory.
func (s *LoaderService) snapshotLaunchFiles(cfg models.ServerConfig, from string) (string, error) {
	dir := filepath.Join(s.dataDir, "loader-snapshots", cfg.ID,
		strconv.FormatInt(time.Now().UnixMilli(), 10))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	for _, name := range loaderLaunchFiles {
		data, err := os.ReadFile(filepath.Join(cfg.WorkingDir, name))
		if os.IsNotExist(err) {
			continue // not every install has both scripts
		}
		if err != nil {
			return "", fmt.Errorf("read %s: %w", name, err)
		}
		if err := writeFileAtomic(filepath.Join(dir, name), data, 0755); err != nil {
			return "", err
		}
	}

	// A plain marker of what this snapshot is, for the rollback UI (#173) and
	// for anyone reading the data directory by hand.
	marker := fmt.Sprintf("loader=%s\nversion=%s\ntakenAt=%s\n",
		cfg.Loader, from, time.Now().UTC().Format(time.RFC3339))
	if err := writeFileAtomic(filepath.Join(dir, "snapshot.txt"), []byte(marker), 0644); err != nil {
		return "", err
	}
	return dir, nil
}

// rollback puts the snapshotted launch files back, reporting whether it
// managed it. Files the snapshot does not carry are left alone: they did not
// exist before the update, so they are installer artifacts rather than
// anything of the user's, and deleting is the riskier direction.
func (s *LoaderService) rollback(cfg models.ServerConfig, snapshotDir string) bool {
	restored := false
	for _, name := range loaderLaunchFiles {
		data, err := os.ReadFile(filepath.Join(snapshotDir, name))
		if err != nil {
			continue
		}
		if err := writeFileAtomic(filepath.Join(cfg.WorkingDir, name), data, 0755); err != nil {
			slog.Error("loader: restore snapshot file", "file", name, "error", err)
			continue
		}
		restored = true
	}
	if restored {
		s.log("Restored the previous launch files.")
	}
	return restored
}

// downloadInstaller fetches one build's installer into a temp directory and
// checks that what arrived is the installer it asked for.
func (s *LoaderService) downloadInstaller(provider LoaderProvider, version string) (string, error) {
	url := provider.InstallerURL(version)
	s.log("Downloading " + filepath.Base(url) + "…")

	dir, err := os.MkdirTemp("", "konnekt-loader-*")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}
	jarPath := filepath.Join(dir, filepath.Base(url))

	cleanup := func() {
		if rmErr := os.RemoveAll(dir); rmErr != nil {
			slog.Warn("loader: remove installer temp dir", "error", rmErr)
		}
	}

	req, err := http.NewRequestWithContext(s.context(), http.MethodGet, url, nil)
	if err != nil {
		cleanup()
		return "", fmt.Errorf("build installer request: %w", err)
	}
	req.Header.Set("User-Agent", neoForgeUserAgent)

	resp, err := s.http.Do(req)
	if err != nil {
		cleanup()
		return "", fmt.Errorf("download installer: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		cleanup()
		return "", fmt.Errorf("download installer: HTTP %d", resp.StatusCode)
	}

	f, err := os.Create(jarPath)
	if err != nil {
		cleanup()
		return "", fmt.Errorf("create %s: %w", jarPath, err)
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		cleanup()
		return "", fmt.Errorf("write installer: %w", err)
	}
	if err := f.Close(); err != nil {
		cleanup()
		return "", fmt.Errorf("close installer: %w", err)
	}

	// The integrity check. A truncated download, a proxy's error page or a
	// captive portal's login form all fail here, before java is handed
	// something that is not an installer — and a build that is not the one
	// asked for fails here rather than after it has been laid down.
	info, _ := InspectInstaller(jarPath)
	if !info.IsInstaller {
		cleanup()
		return "", fmt.Errorf("the download is not a NeoForge installer")
	}
	if info.Version != "" && info.Version != version {
		cleanup()
		return "", fmt.Errorf("asked for %s but the download installs %s", version, info.Version)
	}
	return jarPath, nil
}

// log puts a line on the shared installer log channel, which the update dialog
// renders alongside the installer's own output.
func (s *LoaderService) log(line string) {
	s.bus.Emit(EventInstallLog, map[string]any{"line": line})
}

// narrate marks a milestone in the server console, the same way backups and
// the EULA prompt do (#113); narrateDone and narrateFailed close the milestone
// out with the outcome the console paints as a status dot.
func (s *LoaderService) narrate(serverID, line string) {
	if s.srv != nil {
		s.srv.Narrate(serverID, line)
	}
}

func (s *LoaderService) narrateDone(serverID, line string) {
	if s.srv != nil {
		s.srv.NarrateDone(serverID, line)
	}
}

func (s *LoaderService) narrateFailed(serverID, line string) {
	if s.srv != nil {
		s.srv.NarrateFailed(serverID, line)
	}
}

func (s *LoaderService) context() context.Context {
	if s.ctx != nil {
		return s.ctx
	}
	return context.Background()
}

func orUnknown(version string) string {
	if version == "" {
		return "an unknown version"
	}
	return version
}
