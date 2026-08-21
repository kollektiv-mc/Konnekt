package services

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
	FileName      string   `json:"fileName"`
	DisplayName   string   `json:"displayName"`
	IconURL       string   `json:"iconUrl,omitempty"`
	ModID         string   `json:"modId"`
	Source        string   `json:"source"`   // "modrinth" | "local"
	Provider      string   `json:"provider"` // "modrinth" | ""
	ProjectID     string   `json:"projectId"`
	VersionID     string   `json:"versionId"`
	VersionNumber string   `json:"versionNumber"`
	SHA512        string   `json:"sha512"`
	Loader        string   `json:"loader"`
	TargetFolder  string   `json:"targetFolder"` // "mods" | "plugins"
	Enabled       bool     `json:"enabled"`
	InstalledAt   int64    `json:"installedAt"` // unix ms
	DependencyOf  []string `json:"dependencyOf,omitempty"`
}

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
}

func NewModService(cfg *ConfigService, srv *ServerService) *ModService {
	return &ModService{
		cfg:      cfg,
		srv:      srv,
		provider: NewModrinthClient(),
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
	return s.provider.Search(s.ctx, q, cfg.MCVersion, cfg.Loader)
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
	projectType := "mod"
	if info, ok := loaderProjectType[cfg.Loader]; ok && info.projectType != "plugin" {
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
	projectType := ""
	if info, ok := loaderProjectType[cfg.Loader]; ok {
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
	return s.provider.GetVersions(s.ctx, projectID, cfg.MCVersion, cfg.Loader)
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
	return s.provider.ResolveDependencies(s.ctx, versionID, cfg.MCVersion, cfg.Loader, installedMap)
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
		manifest = &modManifest{Version: 1}
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

		// Record in manifest
		manifest.upsert(modManifestItem{
			FileName:      safeFileName,
			DisplayName:   displayName,
			IconURL:       iconURL,
			Source:        "modrinth",
			Provider:      "modrinth",
			ProjectID:     version.ProjectID,
			VersionID:     version.ID,
			VersionNumber: version.VersionNumber,
			SHA512:        version.SHA512,
			Loader:        loader,
			TargetFolder:  targetFolder,
			Enabled:       true,
			InstalledAt:   time.Now().UnixMilli(),
		})

		s.bus.Emit(EventModInstalled, map[string]any{
			"serverID": serverID,
			"fileName": safeFileName,
		})
	}

	s.clearUpdateCache(serverID)
	return s.saveManifest(serverID, manifest)
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

// DetectServerLoader auto-detects MC version and loader from the server's jar
// and logs, then returns a ServerConfig with those fields filled. The caller
// should treat the result as a suggestion for the UI pre-fill.
func (s *ModService) DetectServerLoader(serverID string) (models.ServerConfig, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return models.ServerConfig{}, err
	}
	mcVersion, loader := detectServerLoader(struct{ JarPath, WorkingDir string }{
		JarPath:    cfg.JarPath,
		WorkingDir: cfg.WorkingDir,
	})
	cfg.MCVersion = mcVersion
	cfg.Loader = loader
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

func (s *ModService) loaderForServer(serverID string) (string, error) {
	cfg, err := s.cfg.GetServerConfig(serverID)
	if err != nil {
		return "", err
	}
	return cfg.Loader, nil
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
		return &modManifest{Version: 1}, nil
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

	result := make([]models.ModUpdateInfo, 0, len(installed))
	for _, mod := range installed {
		if mod.Source != "modrinth" || mod.ProjectID == "" || mod.VersionID == "" {
			continue
		}
		versions, verr := s.provider.GetVersions(s.ctx, mod.ProjectID, cfg.MCVersion, cfg.Loader)
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
		manifest = &modManifest{Version: 1}
	}

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

		s.bus.Emit(EventModInstalled, map[string]any{
			"serverID": serverID,
			"fileName": safeFileName,
		})
	}

	if err := s.saveManifest(serverID, manifest); err != nil {
		return err
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
