package services

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"konnekt/backend/models"
)

// --- Manifest types (internal; not exported over IPC) ---

type modManifest struct {
	Version int               `json:"version"`
	Items   []modManifestItem `json:"items"`
}

type modManifestItem struct {
	FileName      string `json:"fileName"`
	DisplayName   string `json:"displayName"`
	IconURL       string `json:"iconUrl,omitempty"`
	ModID         string `json:"modId"`
	Source        string `json:"source"`   // "modrinth" | "local"
	Provider      string `json:"provider"` // "modrinth" | ""
	ProjectID     string `json:"projectId"`
	VersionID     string `json:"versionId"`
	VersionNumber string `json:"versionNumber"`
	SHA512        string `json:"sha512"`
	// HashChecked records that this file's SHA-512 was put to the provider and
	// answered — whether or not the provider recognised it. It is what stops
	// identifyUnknown from re-asking about a genuinely hand-built jar on every
	// scan, and it is deliberately set only on an answer: a lookup that failed
	// because the network was down leaves it false, so the next scan retries.
	HashChecked  bool     `json:"hashChecked,omitempty"`
	Loader       string   `json:"loader"`
	TargetFolder string   `json:"targetFolder"` // "mods" | "plugins"
	Enabled      bool     `json:"enabled"`
	InstalledAt  int64    `json:"installedAt"` // unix ms
	DependencyOf []string `json:"dependencyOf,omitempty"`
}

// modManifestVersion is the manifest's schema version, and the trigger for the
// one-time re-identification in identifyUnknownLocked. Version 2 is where
// primary-file identity moved from the file's name to its hash: every row
// version 1 wrote for a jar a modpack had renamed is missing a version id, and
// only a re-check can put it back.
const modManifestVersion = 2

const updateCacheTTL = 10 * time.Minute

type updateCacheEntry struct {
	result    []models.ModUpdateInfo
	fetchedAt time.Time
}

// ModService manages mod/plugin installation, listing, and lifecycle.
type ModService struct {
	cfg         *ConfigService
	srv         *ServerService
	provider    ModProvider
	ctx         context.Context
	dataDir     string
	bus         *EventBus
	mu          sync.Mutex // serializes installs + manifest writes
	cacheMu     sync.Mutex
	updateCache map[string]updateCacheEntry // serverID → cached update results

	// lastSig is the folder fingerprint each server was last seen with, so a
	// scan that finds nothing moved can stop before it hashes anything.
	sigMu   sync.Mutex
	lastSig map[string]uint64

	// stop closes once, from beforeClose. ctx cancellation covers the same
	// ground, but a test cannot wait out a 30-second tick to prove the scan
	// ends.
	stop     chan struct{}
	stopOnce sync.Once
}

func NewModService(cfg *ConfigService, srv *ServerService) *ModService {
	return &ModService{
		cfg:      cfg,
		srv:      srv,
		provider: NewModrinthClient(),
		lastSig:  make(map[string]uint64),
		stop:     make(chan struct{}),
	}
}

func (s *ModService) SetContext(ctx context.Context) { s.ctx = ctx }
func (s *ModService) SetDataDir(dir string)          { s.dataDir = dir }
func (s *ModService) SetBus(b *EventBus)             { s.bus = b }

// --- Modrinth browse & install ---

func (s *ModService) Search(serverID, query string, offset int, categories []string, sort string) (models.ModSearchResult, error) {
	cfg, err := s.serverConfig(serverID)
	if err != nil {
		return models.ModSearchResult{}, err
	}
	q := models.ModSearchQuery{Query: query, Offset: offset, Categories: categories, Sort: sort}
	mcVersion, loader := resolveTarget(cfg)
	return s.provider.Search(s.ctx, q, mcVersion, loader)
}

func (s *ModService) Categories(serverID string) ([]string, error) {
	all, err := s.provider.GetCategories(s.ctx)
	if err != nil {
		return nil, err
	}
	// Determine the project type for this server to prefer its category set.
	// Modrinth only tags content categories with "mod"; there is no "plugin" taxonomy.
	// So for plugin loaders we fall back to "mod" categories — they work as search
	// facets regardless of project type.
	cfg, _ := s.serverConfig(serverID)
	_, loader := resolveTarget(cfg)
	projectType := "mod"
	if info, ok := loaderProjectType[loader]; ok && info.projectType != "plugin" {
		projectType = info.projectType
	}
	var names []string
	for _, c := range all {
		if c.Header == "categories" && c.ProjectType == projectType {
			names = append(names, c.Name)
		}
	}
	return names, nil
}

func (s *ModService) MoreByAuthor(serverID, username, excludeProjectID string) ([]models.ModProject, error) {
	projects, err := s.provider.GetProjectsByAuthor(s.ctx, username)
	if err != nil {
		return nil, err
	}
	cfg, _ := s.serverConfig(serverID)
	_, loader := resolveTarget(cfg)
	projectType := ""
	if info, ok := loaderProjectType[loader]; ok {
		projectType = info.projectType
	}

	var result []models.ModProject
	for _, p := range projects {
		if p.ID == excludeProjectID {
			continue
		}
		if projectType != "" && p.ProjectType != projectType {
			continue
		}
		result = append(result, p)
		if len(result) >= 6 {
			break
		}
	}
	return result, nil
}

func (s *ModService) GetProject(projectID string) (models.ModProject, error) {
	return s.provider.GetProject(s.ctx, projectID)
}

func (s *ModService) GetVersions(serverID, projectID string) ([]models.ModVersion, error) {
	cfg, err := s.serverConfig(serverID)
	if err != nil {
		return nil, err
	}
	mcVersion, loader := resolveTarget(cfg)
	return s.provider.GetVersions(s.ctx, projectID, mcVersion, loader)
}

func (s *ModService) GetAllVersions(projectID string) ([]models.ModVersion, error) {
	return s.provider.GetAllVersions(s.ctx, projectID)
}

func (s *ModService) ResolveDependencies(serverID, versionID string) ([]models.ResolvedDependency, error) {
	cfg, err := s.serverConfig(serverID)
	if err != nil {
		return nil, err
	}
	// Build a set of already-installed project IDs
	installed, _ := s.ListInstalled(serverID)
	installedMap := make(map[string]bool, len(installed))
	for _, m := range installed {
		if m.ProjectID != "" {
			installedMap[m.ProjectID] = true
		}
	}
	mcVersion, loader := resolveTarget(cfg)
	return s.provider.ResolveDependencies(s.ctx, versionID, mcVersion, loader, installedMap)
}

// Install downloads and installs one or more Modrinth version IDs to the server's
// mods/ or plugins/ directory. Allowed while the server is running (the mod files
// are not locked); the frontend should notify the user that a restart is required.
func (s *ModService) Install(serverID string, versionIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	workDir, err := s.workingDir(serverID)
	if err != nil {
		return err
	}
	loader, err := s.loaderForServer(serverID)
	if err != nil {
		return err
	}
	targetFolder := loaderTargetFolder(loader)
	targetDir := filepath.Join(workDir, targetFolder)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("create %s dir: %w", targetFolder, err)
	}

	manifest, err := s.loadManifest(serverID)
	if err != nil {
		manifest = &modManifest{Version: modManifestVersion}
	}

	// Cache project title + icon per project ID to avoid duplicate API calls.
	type projectMeta struct{ title, iconURL string }
	projectCache := make(map[string]projectMeta)

	for _, versionID := range versionIDs {
		version, err := s.provider.GetVersion(s.ctx, versionID)
		if err != nil {
			return fmt.Errorf("fetch version %s: %w", versionID, err)
		}
		if version.FileName == "" || version.FileURL == "" {
			return fmt.Errorf("version %s has no downloadable file", versionID)
		}

		// Reject filenames that try to escape the target directory
		safeFileName := filepath.Base(version.FileName)

		s.bus.Emit(EventModInstallStarted, map[string]any{
			"serverID": serverID,
			"fileName": safeFileName,
		})

		finalPath := filepath.Join(targetDir, safeFileName)

		if err := s.downloadVerified(serverID, safeFileName, version.FileURL, version.SHA512, finalPath); err != nil {
			s.bus.Emit(EventModInstallFailed, map[string]any{
				"serverID": serverID,
				"fileName": safeFileName,
				"error":    err.Error(),
			})
			return err
		}

		// Read the jar Konnekt just wrote. Its mod id is what recognises the
		// copy this install replaces when that copy came from somewhere the
		// provider cannot identify by hash — a CurseForge build of the same mod
		// is the usual case, and a modpack folder is full of them.
		meta, _ := parseJarMeta(finalPath, loader)

		// Take out the file this one supersedes before anything is announced.
		// Two jars of one mod in mods/ is not a cosmetic duplicate: the server
		// refuses to start on the duplicate mod id. This is what installing over
		// a modpack's own copy produced every time, because the name Modrinth
		// serves a file under is rarely the name the pack shipped it as.
		wasDisabled, err := s.removeSuperseded(workDir, manifest, targetFolder, safeFileName, version.ProjectID, meta.ID)
		if err != nil {
			return err
		}

		// A superseded file that was switched off stays switched off. A pack
		// ships its client-only mods disabled, and quietly re-enabling one
		// because its version changed is a server that stops booting for a
		// reason nobody asked for.
		installedName := safeFileName
		if wasDisabled {
			installedName = safeFileName + ".disabled"
			if err := os.Rename(finalPath, filepath.Join(targetDir, installedName)); err != nil {
				return fmt.Errorf("keep %s disabled: %w", safeFileName, err)
			}
		}

		// Resolve the real mod name (project title) and icon URL.
		displayName := version.Name
		iconURL := ""
		if version.ProjectID != "" {
			if pm, ok := projectCache[version.ProjectID]; ok {
				displayName = pm.title
				iconURL = pm.iconURL
			} else {
				if proj, perr := s.provider.GetProject(s.ctx, version.ProjectID); perr == nil && proj.Title != "" {
					projectCache[version.ProjectID] = projectMeta{proj.Title, proj.IconURL}
					displayName = proj.Title
					iconURL = proj.IconURL
				}
			}
		}

		// Record in manifest, and write it before announcing the install.
		//
		// The order is the whole point. Every mod:installed subscriber answers
		// it by calling ListInstalled, which reads this file from disk: a row
		// written after the emit is a row that refresh cannot see, and the mod
		// renders as an unmanaged local jar with no icon, no project link and
		// no update check (#52). Saving per file rather than once at the end
		// also keeps a multi-mod install honest — if the third download fails,
		// the first two are on disk *and* in the manifest.
		manifest.upsert(modManifestItem{
			FileName:      installedName,
			DisplayName:   displayName,
			IconURL:       iconURL,
			ModID:         meta.ID,
			Source:        "modrinth",
			Provider:      "modrinth",
			ProjectID:     version.ProjectID,
			VersionID:     version.ID,
			VersionNumber: version.VersionNumber,
			SHA512:        version.SHA512,
			HashChecked:   true,
			Loader:        loader,
			TargetFolder:  targetFolder,
			Enabled:       !wasDisabled,
			InstalledAt:   time.Now().UnixMilli(),
		})
		if err := s.saveManifest(serverID, manifest); err != nil {
			return err
		}

		s.bus.Emit(EventModInstalled, map[string]any{
			"serverID": serverID,
			"fileName": installedName,
		})
	}

	s.clearUpdateCache(serverID)
	s.bus.Emit(EventModChanged, map[string]any{"serverID": serverID})
	return nil
}

// removeSuperseded deletes the files the jar being installed replaces and drops
// their manifest rows. It reports whether what it removed was switched off,
// which is the state the caller carries over to the new file.
//
// Identity is asked two ways, because the copy being replaced may be one Konnekt
// installed or one that arrived with a modpack:
//
//   - The same project, where the existing row is that project's *primary*
//     file. A row with no version id is a secondary file — an EssentialsX module
//     belongs to the EssentialsX project without being the EssentialsX jar — and
//     removing one because its parent was updated would uninstall a plugin the
//     user still has.
//   - The same mod id, as the jars themselves declare it. This is what catches
//     the copy the provider has never seen: a CurseForge build of the same mod
//     hashes to nothing Modrinth knows, so its row has no project at all. Only a
//     mod id parsed out of real jar metadata is used — filenameHeuristic leaves
//     the field empty rather than guessing one from the file name.
//
// Nothing outside the target folder is touched. mods/ and plugins/ hold
// different kinds of content and a name can legitimately appear in both.
func (s *ModService) removeSuperseded(workDir string, manifest *modManifest, targetFolder, newFileName, projectID, modID string) (bool, error) {
	// Whether the new file inherits a .disabled suffix is decided by what was
	// actually removed, and one enabled copy is enough to keep it enabled: the
	// folder that holds both an old jar and its disabled predecessor is a folder
	// where the enabled one is the one in use.
	sawEnabled, sawDisabled := false, false

	remove := func(base string) error {
		for _, name := range []string{base, base + ".disabled"} {
			path := filepath.Join(workDir, targetFolder, name)
			if err := sandboxCheck(workDir, path); err != nil {
				return err
			}
			if _, err := os.Stat(path); err != nil {
				continue
			}
			if strings.HasSuffix(name, ".disabled") {
				sawDisabled = true
			} else {
				sawEnabled = true
			}
			if err := os.Remove(path); err != nil {
				return fmt.Errorf("remove superseded %s: %w", name, err)
			}
		}
		manifest.removeByBase(base)
		return nil
	}

	// Same name, already there but switched off. The download wrote the enabled
	// name beside it, so without this the folder ends up holding both.
	disabledTwin := filepath.Join(workDir, targetFolder, newFileName+".disabled")
	if _, err := os.Stat(disabledTwin); err == nil {
		if err := sandboxCheck(workDir, disabledTwin); err != nil {
			return false, err
		}
		if err := os.Remove(disabledTwin); err != nil {
			return false, fmt.Errorf("remove superseded %s: %w", newFileName+".disabled", err)
		}
		manifest.removeByBase(newFileName)
		sawDisabled = true
	}

	// Ranged over a copy: remove() rewrites manifest.Items as it goes.
	for _, it := range append([]modManifestItem(nil), manifest.Items...) {
		base := strings.TrimSuffix(it.FileName, ".disabled")
		if base == newFileName {
			continue // the file the download just overwrote in place
		}
		if it.TargetFolder != "" && it.TargetFolder != targetFolder {
			continue
		}
		samePrimary := projectID != "" && it.ProjectID == projectID && it.VersionID != ""
		sameMod := modID != "" && strings.EqualFold(it.ModID, modID)
		if !samePrimary && !sameMod {
			continue
		}
		switch s.findJarFolder(workDir, base) {
		case "":
			manifest.removeByBase(base) // the row outlived its file
			continue
		case targetFolder: // the file this install replaces
		default:
			continue // the same mod in the other folder is a different install
		}
		slog.Info("mods: replacing an existing copy", "old", base, "new", newFileName, "folder", targetFolder)
		if err := remove(base); err != nil {
			return false, err
		}
	}

	return sawDisabled && !sawEnabled, nil
}

// downloadVerified streams a file from url to finalPath, verifying the sha512
// hash while downloading. Uses a temp file in the same directory for atomicity.
func (s *ModService) downloadVerified(serverID, fileName, fileURL, expectedSHA512, finalPath string) error {
	destDir := filepath.Dir(finalPath)
	tmp, err := os.CreateTemp(destDir, ".konnekt-dl-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			tmp.Close()
			os.Remove(tmpPath)
		}
	}()

	req, err := http.NewRequestWithContext(s.ctx, http.MethodGet, fileURL, nil)
	if err != nil {
		return fmt.Errorf("build download request: %w", err)
	}
	req.Header.Set("User-Agent", modrinthUserAgent)

	dlClient := &http.Client{} // no hard timeout; bounded by context
	resp, err := dlClient.Do(req)
	if err != nil {
		return fmt.Errorf("download %s: %w", fileName, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download %s: HTTP %d", fileName, resp.StatusCode)
	}

	hasher := sha512.New()
	total := resp.ContentLength // -1 if unknown
	var written int64

	buf := make([]byte, 32*1024)
	reader := io.TeeReader(resp.Body, hasher)
	lastPct := -1

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			if _, werr := tmp.Write(buf[:n]); werr != nil {
				return fmt.Errorf("write temp file: %w", werr)
			}
			written += int64(n)
			if total > 0 {
				pct := int(written * 100 / total)
				if pct != lastPct {
					lastPct = pct
					s.bus.Emit(EventModInstallProgress, map[string]any{
						"serverID": serverID,
						"fileName": fileName,
						"percent":  pct,
					})
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read download stream: %w", err)
		}
	}

	// Verify hash
	if expectedSHA512 != "" {
		got := hex.EncodeToString(hasher.Sum(nil))
		if got != expectedSHA512 {
			return fmt.Errorf("sha512 mismatch for %s: got %s want %s", fileName, got[:16]+"…", expectedSHA512[:16]+"…")
		}
	}

	tmp.Close()
	cleanup = false
	if err := os.Rename(tmpPath, finalPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("move to final path: %w", err)
	}
	return nil
}

// --- Installed manager ---

// ListInstalled scans the server's mods/ and plugins/ directories, parses jar
// metadata from each file, and merges the results with the manifest.
func (s *ModService) ListInstalled(serverID string) ([]models.InstalledMod, error) {
	workDir, err := s.workingDir(serverID)
	if err != nil {
		return nil, err
	}
	loader, _ := s.loaderForServer(serverID)

	manifest, _ := s.loadManifest(serverID)

	// Index manifest items by fileName for O(1) lookup
	manifestIndex := make(map[string]*modManifestItem)
	if manifest != nil {
		for i := range manifest.Items {
			it := &manifest.Items[i]
			manifestIndex[it.FileName] = it
		}
	}

	var result []models.InstalledMod

	for _, folder := range []string{"mods", "plugins"} {
		dir := filepath.Join(workDir, folder)
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue // folder doesn't exist — skip
		}

		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if !strings.HasSuffix(name, ".jar") && !strings.HasSuffix(name, ".jar.disabled") {
				continue
			}
			enabled := strings.HasSuffix(name, ".jar")

			info, _ := e.Info()
			jarPath := filepath.Join(dir, name)

			meta, _ := parseJarMetaCached(jarPath, loader)

			var manifestItem *modManifestItem
			if item, ok := manifestIndex[name]; ok {
				manifestItem = item
			}

			mod := models.InstalledMod{
				FileName:     name,
				DisplayName:  bestDisplayName(manifestItem, meta.Name, name),
				ModID:        meta.ID,
				Source:       "local",
				TargetFolder: folder,
				Loader:       meta.Loader,
				Enabled:      enabled,
				SizeBytes:    info.Size(),
			}

			// Merge manifest data if available
			if manifestItem != nil {
				mod.Source = manifestItem.Source
				mod.Provider = manifestItem.Provider
				mod.ProjectID = manifestItem.ProjectID
				mod.VersionID = manifestItem.VersionID
				mod.VersionNumber = manifestItem.VersionNumber
				mod.InstalledAt = manifestItem.InstalledAt
				mod.IconURL = manifestItem.IconURL
				if manifestItem.Loader != "" {
					mod.Loader = manifestItem.Loader
				}
			}

			result = append(result, mod)
		}
	}
	return result, nil
}

// SetEnabled renames a jar between .jar and .jar.disabled.
func (s *ModService) SetEnabled(serverID, fileName string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	workDir, err := s.workingDir(serverID)
	if err != nil {
		return err
	}

	// Accept the bare filename; determine current name and target name
	// to support toggling from either state.
	bareName := strings.TrimSuffix(fileName, ".disabled")
	disabledName := bareName + ".disabled"

	folder := s.findJarFolder(workDir, bareName)
	if folder == "" {
		return fmt.Errorf("mod file not found: %s", fileName)
	}

	currentPath := filepath.Join(workDir, folder, disabledName)
	newPath := filepath.Join(workDir, folder, bareName)
	if enabled {
		// disabled → enabled: expect .disabled exists
		if _, err := os.Stat(currentPath); os.IsNotExist(err) {
			currentPath = filepath.Join(workDir, folder, bareName)
			newPath = currentPath // already enabled
		}
	} else {
		// enabled → disabled
		currentPath = filepath.Join(workDir, folder, bareName)
		newPath = filepath.Join(workDir, folder, disabledName)
	}

	if err := sandboxCheck(workDir, currentPath); err != nil {
		return err
	}
	if err := sandboxCheck(workDir, newPath); err != nil {
		return err
	}

	if currentPath != newPath {
		if err := os.Rename(currentPath, newPath); err != nil {
			return fmt.Errorf("rename: %w", err)
		}
	}

	// Update manifest
	manifest, _ := s.loadManifest(serverID)
	if manifest != nil {
		for i := range manifest.Items {
			it := &manifest.Items[i]
			if it.FileName == bareName || it.FileName == disabledName {
				it.FileName = filepath.Base(newPath)
				it.Enabled = enabled
			}
		}
		_ = s.saveManifest(serverID, manifest) //nolint:errcheck // best-effort manifest sync; the underlying file operation already succeeded
	}

	s.bus.Emit(EventModChanged, map[string]any{"serverID": serverID})
	return nil
}

// Uninstall deletes a jar and removes it from the manifest.
func (s *ModService) Uninstall(serverID, fileName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	workDir, err := s.workingDir(serverID)
	if err != nil {
		return err
	}

	bareName := strings.TrimSuffix(fileName, ".disabled")
	folder := s.findJarFolder(workDir, bareName)
	if folder == "" {
		return fmt.Errorf("mod file not found: %s", fileName)
	}

	// Try both enabled and disabled variants
	for _, name := range []string{bareName, bareName + ".disabled"} {
		path := filepath.Join(workDir, folder, name)
		if err := sandboxCheck(workDir, path); err != nil {
			return err
		}
		if _, err := os.Stat(path); err == nil {
			if err := os.Remove(path); err != nil {
				return fmt.Errorf("delete %s: %w", name, err)
			}
		}
	}

	// Remove from manifest
	manifest, _ := s.loadManifest(serverID)
	if manifest != nil {
		manifest.removeByBase(bareName)
		_ = s.saveManifest(serverID, manifest) //nolint:errcheck // best-effort manifest sync; the underlying file operation already succeeded
	}

	s.clearUpdateCache(serverID)
	s.bus.Emit(EventModChanged, map[string]any{"serverID": serverID})
	return nil
}

// DetectServerLoader auto-detects MC version and loader from the server's
// install and logs, then returns a ServerConfig with those fields filled. The
// caller should treat the result as a suggestion for the UI pre-fill.
//
// Detection fills gaps; it does not overwrite. A run that finds the loader but
// not the Minecraft version used to blank a version that was already known,
// which is worse than the gap it was trying to close — and the frontend
// persists whatever comes back.
//
// The one thing it does overwrite is a jarPath pointing at a Forge/NeoForge
// installer. That is not a preference to respect: resolveLaunch already refuses
// to start from one, the install it produced launches from run.sh, and leaving
// it set is what fed detectFromJar the installer in the first place.
func (s *ModService) DetectServerLoader(serverID string) (models.ServerConfig, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return models.ServerConfig{}, err
	}

	if info, ierr := InspectInstaller(cfg.JarPath); ierr == nil && info.IsInstaller {
		cfg.JarPath = ""
	}

	cfg.MCVersion, cfg.Loader = sanitizeTarget(cfg.MCVersion, cfg.Loader)

	mcVersion, loader := detectServerLoader(struct{ JarPath, WorkingDir string }{
		JarPath:    cfg.JarPath,
		WorkingDir: cfg.WorkingDir,
	})
	if cfg.MCVersion == "" {
		cfg.MCVersion = mcVersion
	}
	if cfg.Loader == "" {
		cfg.Loader = loader
	}
	return *cfg, nil
}

// --- Helpers ---

func (s *ModService) serverConfig(serverID string) (models.ServerConfig, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return models.ServerConfig{}, err
	}
	return *cfg, nil
}

func (s *ModService) workingDir(serverID string) (string, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return "", err
	}
	return cfg.WorkingDir, nil
}

// loaderForServer is the loader an install/scan should assume, resolved the same
// way every Modrinth query resolves it. It decides mods/ versus plugins/, so a
// stale label would put a plugin in the wrong folder.
func (s *ModService) loaderForServer(serverID string) (string, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return "", err
	}
	_, loader := resolveTarget(*cfg)
	return loader, nil
}

// findJarFolder returns "mods" or "plugins" depending on where the jar lives.
func (s *ModService) findJarFolder(workDir, bareName string) string {
	for _, folder := range []string{"mods", "plugins"} {
		dir := filepath.Join(workDir, folder)
		for _, name := range []string{bareName, bareName + ".disabled"} {
			if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
				return folder
			}
		}
	}
	return ""
}

// loaderTargetFolder maps a loader string to its on-disk folder.
func loaderTargetFolder(loader string) string {
	switch loader {
	case "paper", "spigot", "bukkit", "purpur", "velocity":
		return "plugins"
	default:
		return "mods"
	}
}

// sandboxCheck ensures path is within workDir.
func sandboxCheck(workDir, path string) error {
	clean := filepath.Clean(path)
	wd := filepath.Clean(workDir)
	if clean != wd && !strings.HasPrefix(clean, wd+string(filepath.Separator)) {
		return fmt.Errorf("path outside working directory")
	}
	return nil
}

// --- Manifest persistence ---

func (s *ModService) manifestDir() string {
	return filepath.Join(s.dataDir, "mods")
}

func (s *ModService) manifestPath(serverID string) string {
	return filepath.Join(s.manifestDir(), serverID+".json")
}

func (s *ModService) loadManifest(serverID string) (*modManifest, error) {
	data, err := os.ReadFile(s.manifestPath(serverID))
	if os.IsNotExist(err) {
		return &modManifest{Version: modManifestVersion}, nil
	}
	if err != nil {
		return nil, err
	}
	var m modManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *ModService) saveManifest(serverID string, m *modManifest) error {
	dir := s.manifestDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	// Atomic write: temp + rename
	tmp, err := os.CreateTemp(dir, ".manifest-*.json")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	tmp.Close()
	return os.Rename(tmpPath, s.manifestPath(serverID))
}

// CheckUpdates fetches the latest compatible version for each Modrinth-sourced
// installed mod. Results are cached for updateCacheTTL to avoid hammering the
// Modrinth API on every library open/poll.
//
// Returns a slice, not the map[fileName]ModUpdateInfo it used to: Wails' binding
// generator does not descend into map values, so the map shape left
// models.ModUpdateInfo undeclared on the TypeScript side. Each entry carries its
// own FileName instead. See the type's own comment.
func (s *ModService) CheckUpdates(serverID string) ([]models.ModUpdateInfo, error) {
	s.cacheMu.Lock()
	if s.updateCache != nil {
		if entry, ok := s.updateCache[serverID]; ok && time.Since(entry.fetchedAt) < updateCacheTTL {
			result := entry.result
			s.cacheMu.Unlock()
			return result, nil
		}
	}
	s.cacheMu.Unlock()

	installed, err := s.ListInstalled(serverID)
	if err != nil {
		return nil, err
	}
	cfg, err := s.serverConfig(serverID)
	if err != nil {
		return nil, err
	}

	mcVersion, loader := resolveTarget(cfg)

	result := make([]models.ModUpdateInfo, 0, len(installed))
	for _, mod := range installed {
		if mod.Source != "modrinth" || mod.ProjectID == "" || mod.VersionID == "" {
			continue
		}
		versions, verr := s.provider.GetVersions(s.ctx, mod.ProjectID, mcVersion, loader)
		if verr != nil || len(versions) == 0 {
			continue
		}
		latest := versions[0]
		result = append(result, models.ModUpdateInfo{
			FileName:            mod.FileName,
			UpdateAvailable:     latest.ID != mod.VersionID,
			LatestVersionID:     latest.ID,
			LatestVersionNumber: latest.VersionNumber,
		})
	}

	s.cacheMu.Lock()
	if s.updateCache == nil {
		s.updateCache = make(map[string]updateCacheEntry)
	}
	s.updateCache[serverID] = updateCacheEntry{result: result, fetchedAt: time.Now()}
	s.cacheMu.Unlock()

	return result, nil
}

func (s *ModService) clearUpdateCache(serverID string) {
	s.cacheMu.Lock()
	delete(s.updateCache, serverID)
	s.cacheMu.Unlock()
}

// InstallLocal copies local jar files into the server's mods/plugins directory and
// records them in the manifest as source "local".
func (s *ModService) InstallLocal(serverID string, filePaths []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	workDir, err := s.workingDir(serverID)
	if err != nil {
		return err
	}
	loader, err := s.loaderForServer(serverID)
	if err != nil {
		return err
	}
	targetFolder := loaderTargetFolder(loader)
	targetDir := filepath.Join(workDir, targetFolder)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("create %s dir: %w", targetFolder, err)
	}

	manifest, err := s.loadManifest(serverID)
	if err != nil {
		manifest = &modManifest{Version: modManifestVersion}
	}

	copied := make([]string, 0, len(filePaths))
	for _, srcPath := range filePaths {
		safeFileName := filepath.Base(srcPath)
		if !strings.HasSuffix(safeFileName, ".jar") {
			continue
		}
		finalPath := filepath.Join(targetDir, safeFileName)
		if err := sandboxCheck(workDir, finalPath); err != nil {
			return err
		}
		if err := atomicCopyFile(srcPath, finalPath); err != nil {
			return fmt.Errorf("copy %s: %w", safeFileName, err)
		}

		meta, _ := parseJarMeta(finalPath, loader)
		displayName := meta.Name
		if displayName == "" {
			displayName = strings.TrimSuffix(safeFileName, ".jar")
		}

		manifest.upsert(modManifestItem{
			FileName:     safeFileName,
			DisplayName:  displayName,
			ModID:        meta.ID,
			Source:       "local",
			Provider:     "",
			Loader:       loader,
			TargetFolder: targetFolder,
			Enabled:      true,
			InstalledAt:  time.Now().UnixMilli(),
		})
		copied = append(copied, safeFileName)
	}

	if err := s.saveManifest(serverID, manifest); err != nil {
		return err
	}

	// "Local" here means "the user picked it from disk", not "nothing knows what
	// it is". A file chosen in the picker is usually a Modrinth download that
	// went through the browser instead of this app, so ask before settling for
	// the local label. Best-effort: an unidentified jar is exactly what this
	// path used to produce, and an install must not fail because Modrinth is
	// unreachable.
	if _, err := s.identifyUnknownLocked(serverID); err != nil {
		slog.Warn("mods: identify picked files", "server", serverID, "error", err)
	}

	// Announced only once the manifest is on disk. Every subscriber answers
	// these by re-reading it; see the ordering note in Install.
	for _, fileName := range copied {
		s.bus.Emit(EventModInstalled, map[string]any{
			"serverID": serverID,
			"fileName": fileName,
		})
	}

	s.clearUpdateCache(serverID)
	s.bus.Emit(EventModChanged, map[string]any{"serverID": serverID})
	return nil
}

// atomicCopyFile copies src to dst using a temp file in the same directory for atomicity.
func atomicCopyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	tmp, err := os.CreateTemp(filepath.Dir(dst), ".konnekt-local-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			tmp.Close()
			os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(tmp, in); err != nil {
		return err
	}
	tmp.Close()
	cleanup = false
	return os.Rename(tmpPath, dst)
}

// bestDisplayName picks the most human-readable name for an installed mod.
// It detects the old bug where the version label (e.g. "5.0.3") was stored as
// DisplayName and falls back to the jar-parsed name in that case.
func bestDisplayName(item *modManifestItem, metaName, fileName string) string {
	mName, vNum := "", ""
	if item != nil {
		mName = item.DisplayName
		vNum = item.VersionNumber
	}
	// Detect old-style bad manifest: DisplayName starts with the VersionNumber.
	isBadName := mName != "" &&
		((vNum != "" && strings.HasPrefix(mName, vNum)) ||
			(vNum == "" && len(mName) > 0 && mName[0] >= '0' && mName[0] <= '9'))
	if isBadName && metaName != "" {
		return metaName
	}
	if mName != "" {
		return mName
	}
	if metaName != "" {
		return metaName
	}
	return fileName
}

// upsert adds or updates a manifest item by FileName.
func (m *modManifest) upsert(item modManifestItem) {
	for i, it := range m.Items {
		if it.FileName == item.FileName {
			m.Items[i] = item
			return
		}
	}
	m.Items = append(m.Items, item)
}

// removeByBase removes all items whose FileName (base without .disabled) matches.
func (m *modManifest) removeByBase(bareName string) {
	filtered := m.Items[:0]
	for _, it := range m.Items {
		base := strings.TrimSuffix(it.FileName, ".disabled")
		if base != bareName {
			filtered = append(filtered, it)
		}
	}
	m.Items = filtered
}
