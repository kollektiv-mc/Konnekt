package services

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"konnekt/backend/models"
)

type BackupService struct {
	config  *ConfigService
	server  *ServerService
	ctx     context.Context
	dataDir string
	bus     *EventBus
}

func NewBackupService(cfg *ConfigService, srv *ServerService) *BackupService {
	return &BackupService{config: cfg, server: srv}
}

func (s *BackupService) SetContext(ctx context.Context) {
	s.ctx = ctx
}

func (s *BackupService) SetBus(b *EventBus) {
	s.bus = b
}

func (s *BackupService) SetDataDir(dir string) {
	s.dataDir = dir
}

// serverBackupDir returns {dataDir}/backups/{serverID}/server — where full-server backups are stored.
func (s *BackupService) serverBackupDir(serverID string) (string, error) {
	dir := filepath.Join(s.dataDir, "backups", serverID, "server")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// worldBackupDir returns {dataDir}/backups/{serverID}/worlds/{worldName}.
func (s *BackupService) worldBackupDir(serverID, worldName string) (string, error) {
	dir := filepath.Join(s.dataDir, "backups", serverID, "worlds", worldName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

func (s *BackupService) worldPath(serverID string) (string, error) {
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return "", err
	}
	props, err := readProperties(filepath.Join(cfg.WorkingDir, "server.properties"))
	if err != nil {
		return "", err
	}
	levelName := props["level-name"]
	if levelName == "" {
		levelName = "world"
	}
	return filepath.Join(cfg.WorkingDir, levelName), nil
}

// ─── Metadata sidecar ─────────────────────────────────────────────────────

type backupFileMeta struct {
	DisplayName string   `json:"displayName,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

func (s *BackupService) loadMeta(dir string) (map[string]backupFileMeta, error) {
	data, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	if os.IsNotExist(err) {
		return make(map[string]backupFileMeta), nil
	}
	if err != nil {
		return nil, err
	}
	var m map[string]backupFileMeta
	if err := json.Unmarshal(data, &m); err != nil {
		return make(map[string]backupFileMeta), nil
	}
	return m, nil
}

func (s *BackupService) saveMeta(dir string, m map[string]backupFileMeta) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(dir, "meta.json"), data, 0644)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// scanBackupsInDir reads all .zip files in dir and returns Backup structs.
// kind and world are set on every entry (caller knows the directory context).
func (s *BackupService) scanBackupsInDir(dir, kind, world string) []models.Backup {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	meta, _ := s.loadMeta(dir)
	var out []models.Backup
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".zip") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		m := meta[e.Name()]
		tags := m.Tags
		if tags == nil {
			tags = []string{}
		}
		out = append(out, models.Backup{
			Filename:    e.Name(),
			CreatedAt:   info.ModTime().UnixMilli(),
			SizeBytes:   info.Size(),
			DisplayName: m.DisplayName,
			Tags:        tags,
			Kind:        kind,
			World:       world,
		})
	}
	return out
}

// findBackupFile returns the absolute path of a backup file, the directory
// containing it (for meta.json lookups), its kind, and its world name.
// It searches server/, then worlds/*/, then the legacy root dir.
func (s *BackupService) findBackupFile(serverID, filename string) (filePath, metaDir, kind, world string, err error) {
	root := filepath.Join(s.dataDir, "backups", serverID)

	// server/
	serverDir := filepath.Join(root, "server")
	p := filepath.Join(serverDir, filename)
	if _, statErr := os.Stat(p); statErr == nil {
		return p, serverDir, "server", "", nil
	}

	// worlds/{worldName}/
	worldsDir := filepath.Join(root, "worlds")
	if entries, readErr := os.ReadDir(worldsDir); readErr == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			p := filepath.Join(worldsDir, e.Name(), filename)
			if _, statErr := os.Stat(p); statErr == nil {
				return p, filepath.Join(worldsDir, e.Name()), "world", e.Name(), nil
			}
		}
	}

	// Legacy: root dir (pre-split backups)
	p = filepath.Join(root, filename)
	if _, statErr := os.Stat(p); statErr == nil {
		k := "world"
		if isServerFilename(filename) {
			k = "server"
		}
		return p, root, k, "", nil
	}

	return "", "", "", "", fmt.Errorf("backup %q not found", filename)
}

// ─── Public methods ────────────────────────────────────────────────────────

func (s *BackupService) ListBackups(serverID string) ([]models.Backup, error) {
	root := filepath.Join(s.dataDir, "backups", serverID)
	var all []models.Backup

	// Full-server backups
	all = append(all, s.scanBackupsInDir(filepath.Join(root, "server"), "server", "")...)

	// Per-world backups (one subdir per world name)
	worldsDir := filepath.Join(root, "worlds")
	if entries, err := os.ReadDir(worldsDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			all = append(all, s.scanBackupsInDir(filepath.Join(worldsDir, e.Name()), "world", e.Name())...)
		}
	}

	// Legacy backups in root (created before the server/worlds split)
	if entries, err := os.ReadDir(root); err == nil {
		meta, _ := s.loadMeta(root)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".zip") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			m := meta[e.Name()]
			tags := m.Tags
			if tags == nil {
				tags = []string{}
			}
			k := "world"
			if isServerFilename(e.Name()) {
				k = "server"
			}
			all = append(all, models.Backup{
				Filename:    e.Name(),
				CreatedAt:   info.ModTime().UnixMilli(),
				SizeBytes:   info.Size(),
				DisplayName: m.DisplayName,
				Tags:        tags,
				Kind:        k,
			})
		}
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].CreatedAt > all[j].CreatedAt
	})
	return all, nil
}

// narrate speaks as Konnekt in the console for the backup lifecycle (#113).
// narrateDone and narrateFailed are its finished/failed twins, so a reader
// sees the outcome as a status dot without parsing the wording.
// All three are nil-safe: fixtures wire a BackupService without a
// ServerService.
func (s *BackupService) narrate(line string) {
	if s.server != nil {
		s.server.Narrate(line)
	}
}

func (s *BackupService) narrateDone(line string) {
	if s.server != nil {
		s.server.NarrateDone(line)
	}
}

func (s *BackupService) narrateFailed(line string) {
	if s.server != nil {
		s.server.NarrateFailed(line)
	}
}

// sizeMB renders a byte count for a console line.
func sizeMB(n int64) string {
	return fmt.Sprintf("%.1f MB", float64(n)/(1024*1024))
}

func (s *BackupService) CreateBackup(serverID string) (models.Backup, error) {
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return models.Backup{}, err
	}
	serverDir := cfg.WorkingDir
	if _, err := os.Stat(serverDir); err != nil {
		return models.Backup{}, fmt.Errorf("server folder not found: %s", serverDir)
	}

	backupDir, err := s.serverBackupDir(serverID)
	if err != nil {
		return models.Backup{}, err
	}

	// Format: {5-digit-id}_{DD}_{MM}_{YY}_{HHMMSS}.zip
	dest, filename, err := reserveBackupFile(backupDir)
	if err != nil {
		return models.Backup{}, err
	}
	destPath := filepath.Join(backupDir, filename)

	s.bus.Emit(EventBackupStarted, map[string]string{"serverID": serverID, "filename": filename})
	s.narrate("Backing up the server to " + filename)

	if s.server != nil && s.server.PrepareForBackup(serverID) {
		defer s.server.ResumeSaves(serverID)
	}

	var lastPct int = -1
	onProgress := func(pct int) {
		if pct > lastPct {
			lastPct = pct
			s.bus.Emit(EventBackupProgress, map[string]interface{}{
				"serverID": serverID,
				"percent":  pct,
			})
		}
	}

	// Closed before the Stat below so the zip's central directory is on disk and
	// the recorded size is the finished file's. A close error means a truncated
	// archive, so it fails the backup rather than being dropped.
	zipErr := zipDirWithProgress(serverDir, dest, onProgress)
	if closeErr := dest.Close(); zipErr == nil {
		zipErr = closeErr
	}
	if zipErr != nil {
		_ = os.Remove(destPath) //nolint:errcheck // best-effort cleanup of a partial archive; the error below is what matters
		s.bus.Emit(EventBackupFailed, map[string]interface{}{
			"serverID": serverID,
			"error":    zipErr.Error(),
		})
		s.narrateFailed("Backup failed: " + zipErr.Error())
		return models.Backup{}, zipErr
	}

	info, err := os.Stat(destPath)
	if err != nil {
		return models.Backup{}, err
	}
	b := models.Backup{
		Filename:  filename,
		CreatedAt: info.ModTime().UnixMilli(),
		SizeBytes: info.Size(),
		Tags:      []string{},
		Kind:      "server",
	}
	s.bus.Emit(EventBackupCompleted, map[string]interface{}{
		"serverID": serverID,
		"filename": b.Filename,
	})
	s.narrateDone(fmt.Sprintf("Backup finished: %s (%s)", b.Filename, sizeMB(b.SizeBytes)))
	return b, nil
}

// CreateWorldBackup zips an arbitrary world folder (by name) so the Worlds tile
// can back up any world, not just the active one. Each world's backups are
// stored under worlds/{worldName}/ for clean organisation.
func (s *BackupService) CreateWorldBackup(serverID, worldName string) (models.Backup, error) {
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return models.Backup{}, err
	}
	worldDir := filepath.Join(cfg.WorkingDir, worldName)
	if _, err := os.Stat(worldDir); err != nil {
		return models.Backup{}, fmt.Errorf("world folder %q not found", worldName)
	}

	backupDir, err := s.worldBackupDir(serverID, worldName)
	if err != nil {
		return models.Backup{}, err
	}

	// Filename no longer carries the world name — the directory provides context.
	dest, filename, err := reserveBackupFile(backupDir)
	if err != nil {
		return models.Backup{}, err
	}
	destPath := filepath.Join(backupDir, filename)

	s.bus.Emit(EventBackupStarted, map[string]string{"serverID": serverID, "filename": filename})
	s.narrate(fmt.Sprintf("Backing up world %q to %s", worldName, filename))

	if s.server != nil && s.server.PrepareForBackup(serverID) {
		defer s.server.ResumeSaves(serverID)
	}

	var lastPct int = -1
	onProgress := func(pct int) {
		if pct > lastPct {
			lastPct = pct
			s.bus.Emit(EventBackupProgress, map[string]interface{}{
				"serverID": serverID,
				"percent":  pct,
			})
		}
	}

	// Closed before the Stat below, for the same reason as CreateBackup.
	zipErr := zipDirWithProgress(worldDir, dest, onProgress)
	if closeErr := dest.Close(); zipErr == nil {
		zipErr = closeErr
	}
	if zipErr != nil {
		_ = os.Remove(destPath) //nolint:errcheck // best-effort cleanup of a partial archive; the error below is what matters
		s.bus.Emit(EventBackupFailed, map[string]interface{}{
			"serverID": serverID,
			"error":    zipErr.Error(),
		})
		s.narrateFailed("Backup failed: " + zipErr.Error())
		return models.Backup{}, zipErr
	}

	info, err := os.Stat(destPath)
	if err != nil {
		return models.Backup{}, err
	}
	b := models.Backup{
		Filename:  filename,
		CreatedAt: info.ModTime().UnixMilli(),
		SizeBytes: info.Size(),
		Tags:      []string{},
		Kind:      "world",
		World:     worldName,
	}
	s.bus.Emit(EventBackupCompleted, map[string]interface{}{
		"serverID": serverID,
		"filename": b.Filename,
	})
	s.narrateDone(fmt.Sprintf("Backup finished: %s (%s)", b.Filename, sizeMB(b.SizeBytes)))
	return b, nil
}

func (s *BackupService) RestoreBackup(serverID, filename string) error {
	if err := validateFilename(filename); err != nil {
		return err
	}
	if s.server.IsRunning(serverID) {
		return errors.New("stop the server before restoring a backup")
	}

	zipPath, _, kind, world, err := s.findBackupFile(serverID, filename)
	if err != nil {
		return err
	}

	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return err
	}

	if kind == "server" {
		// Full-server restore: replace the entire working directory.
		workingDir := cfg.WorkingDir
		s.narrate("Restoring the server from " + filename)
		tmp, err := os.MkdirTemp(filepath.Dir(workingDir), "konnekt-restore-*")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)

		if err := unzipTo(zipPath, tmp); err != nil {
			s.bus.Emit(EventBackupFailed, map[string]string{"error": err.Error()})
			s.narrateFailed("Restore failed while extracting: " + err.Error())
			return err
		}

		aside := workingDir + ".bak-" + time.Now().Format("20060102-150405")
		if err := os.Rename(workingDir, aside); err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := os.Rename(tmp, workingDir); err != nil {
			_ = os.Rename(aside, workingDir) //nolint:errcheck // best-effort rollback; err below is already the reported failure
			s.bus.Emit(EventBackupFailed, map[string]string{"error": err.Error()})
			s.narrateFailed("Restore failed while swapping files, previous state kept: " + err.Error())
			return err
		}
		_ = os.RemoveAll(aside) //nolint:errcheck // best-effort cleanup of the pre-restore backup dir; restore already succeeded
		s.narrateDone("Restore finished, server files replaced")
	} else {
		// World-only restore: replace the target world folder.
		// For named world backups use the stored world name; legacy server
		// backups (kind="server" but pre-split) use the active world path.
		var targetDir string
		if world != "" {
			targetDir = filepath.Join(cfg.WorkingDir, world)
		} else {
			targetDir, err = s.worldPath(serverID)
			if err != nil {
				return err
			}
		}

		worldLabel := filepath.Base(targetDir)
		s.narrate(fmt.Sprintf("Restoring world %q from %s", worldLabel, filename))

		tmp, err := os.MkdirTemp(filepath.Dir(targetDir), "konnekt-restore-*")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)

		if err := unzipTo(zipPath, tmp); err != nil {
			s.bus.Emit(EventBackupFailed, map[string]string{"error": err.Error()})
			s.narrateFailed("Restore failed while extracting: " + err.Error())
			return err
		}

		aside := targetDir + ".bak-" + time.Now().Format("20060102-150405")
		if err := os.Rename(targetDir, aside); err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := os.Rename(tmp, targetDir); err != nil {
			_ = os.Rename(aside, targetDir) //nolint:errcheck // best-effort rollback; err below is already the reported failure
			s.bus.Emit(EventBackupFailed, map[string]string{"error": err.Error()})
			s.narrateFailed("Restore failed while swapping files, previous state kept: " + err.Error())
			return err
		}
		_ = os.RemoveAll(aside) //nolint:errcheck // best-effort cleanup of the pre-restore backup dir; restore already succeeded
		s.narrateDone(fmt.Sprintf("Restore finished, world %q replaced", worldLabel))
	}

	s.bus.Emit(EventRestoreCompleted, map[string]string{"serverID": serverID, "filename": filename})
	return nil
}

func (s *BackupService) DeleteBackup(serverID, filename string) error {
	if err := validateFilename(filename); err != nil {
		return err
	}
	filePath, metaDir, _, _, err := s.findBackupFile(serverID, filename)
	if err != nil {
		return err
	}
	if meta, err := s.loadMeta(metaDir); err == nil {
		delete(meta, filename)
		_ = s.saveMeta(metaDir, meta) //nolint:errcheck // best-effort metadata sync; the backup file itself is still deleted below
	}
	return os.Remove(filePath)
}

func (s *BackupService) UpdateBackupMeta(serverID, filename, displayName string, tags []string) (models.Backup, error) {
	if err := validateFilename(filename); err != nil {
		return models.Backup{}, err
	}
	filePath, metaDir, kind, world, err := s.findBackupFile(serverID, filename)
	if err != nil {
		return models.Backup{}, err
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return models.Backup{}, err
	}

	// Sanitize tags: strip leading #, trim spaces, drop empty
	var clean []string
	for _, t := range tags {
		t = strings.TrimSpace(strings.TrimPrefix(t, "#"))
		if t != "" {
			clean = append(clean, t)
		}
	}
	if clean == nil {
		clean = []string{}
	}

	meta, err := s.loadMeta(metaDir)
	if err != nil {
		return models.Backup{}, err
	}
	meta[filename] = backupFileMeta{
		DisplayName: strings.TrimSpace(displayName),
		Tags:        clean,
	}
	if err := s.saveMeta(metaDir, meta); err != nil {
		return models.Backup{}, err
	}

	return models.Backup{
		Filename:    filename,
		CreatedAt:   info.ModTime().UnixMilli(),
		SizeBytes:   info.Size(),
		DisplayName: strings.TrimSpace(displayName),
		Tags:        clean,
		Kind:        kind,
		World:       world,
	}, nil
}

func (s *BackupService) OpenBackupDir(serverID string) error {
	dir, err := s.serverBackupDir(serverID)
	if err != nil {
		return err
	}
	return OpenPath(dir)
}

// GetBackupWorlds reads the worlds and dimensions stored in a backup zip
// without decompressing it — it inspects only the central directory.
func (s *BackupService) GetBackupWorlds(serverID, filename string) ([]models.WorldSystem, error) {
	if err := validateFilename(filename); err != nil {
		return []models.WorldSystem{}, err
	}
	zipPath, _, kind, worldName, err := s.findBackupFile(serverID, filename)
	if err != nil {
		return []models.WorldSystem{}, err
	}
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return []models.WorldSystem{}, err
	}
	defer r.Close()
	if kind == "world" {
		return worldsFromWorldZip(worldName, r.File), nil
	}
	return worldsFromServerZip(r.File), nil
}

// worldsFromServerZip detects worlds/dimensions in a full-server backup zip.
// The zip mirrors the server working directory, so world folders are top-level.
func worldsFromServerZip(files []*zip.File) []models.WorldSystem {
	// Pass 1: find top-level dirs containing level.dat; keep the zip.File for meta.
	type dirEntry struct {
		dir, kind, base string
		levelDat        *zip.File // non-nil only when kind == "overworld"
	}
	var dirEntries []dirEntry
	for _, f := range files {
		if !strings.HasSuffix(f.Name, "/level.dat") {
			continue
		}
		dir := strings.TrimSuffix(f.Name, "/level.dat")
		if strings.ContainsRune(dir, '/') {
			continue // not a top-level dir
		}
		base, kind := classifyWorldDir(dir)
		de := dirEntry{dir: dir, kind: kind, base: base}
		if kind == "overworld" {
			de.levelDat = f
		}
		dirEntries = append(dirEntries, de)
	}

	// Pass 2: group into WorldSystems and read level.dat meta for each base world.
	systems := map[string]*models.WorldSystem{}
	for _, de := range dirEntries {
		if _, ok := systems[de.base]; !ok {
			sys := &models.WorldSystem{Name: de.base, Dimensions: []models.WorldDimension{}}
			if de.levelDat != nil {
				if rc, err := de.levelDat.Open(); err == nil {
					if meta, err := readLevelDatFromReader(rc); err == nil {
						sys.Meta = meta
					}
					rc.Close()
				}
			}
			systems[de.base] = sys
		}
		systems[de.base].Dimensions = append(systems[de.base].Dimensions, models.WorldDimension{
			Kind: de.kind, Path: de.dir,
		})
	}

	// Pass 3: detect vanilla sub-dimensions (DIM-1/DIM1 inside overworld dir).
	for base, sys := range systems {
		for _, sub := range []struct{ suffix, kind string }{
			{"/DIM-1/", "nether"},
			{"/DIM1/", "the_end"},
		} {
			already := false
			for _, d := range sys.Dimensions {
				if d.Kind == sub.kind {
					already = true
					break
				}
			}
			if already {
				continue
			}
			prefix := base + sub.suffix
			for _, f := range files {
				if strings.HasPrefix(f.Name, prefix) && !f.FileInfo().IsDir() {
					sys.Dimensions = append(sys.Dimensions, models.WorldDimension{
						Kind: sub.kind, Path: base + strings.TrimSuffix(sub.suffix, "/"),
					})
					break
				}
			}
		}
	}

	// Build a prefix → system map for size attribution (longest prefix wins).
	type prefixEntry struct {
		prefix string
		sys    *models.WorldSystem
	}
	var prefixes []prefixEntry
	for _, de := range dirEntries {
		prefixes = append(prefixes, prefixEntry{de.dir + "/", systems[de.base]})
	}
	for base, sys := range systems {
		for _, d := range sys.Dimensions {
			if d.Kind == "nether" || d.Kind == "the_end" {
				// vanilla sub-dim: its path is base + "/DIM-1" or base + "/DIM1"
				if strings.HasPrefix(d.Path, base+"/") {
					prefixes = append(prefixes, prefixEntry{d.Path + "/", sys})
				}
			}
		}
	}

	// Pass 4: sum sizes and timestamps.
	for _, f := range files {
		if f.FileInfo().IsDir() {
			continue
		}
		bestLen := 0
		var bestSys *models.WorldSystem
		for _, pe := range prefixes {
			if strings.HasPrefix(f.Name, pe.prefix) && len(pe.prefix) > bestLen {
				bestLen = len(pe.prefix)
				bestSys = pe.sys
			}
		}
		if bestSys != nil {
			bestSys.TotalSize += int64(f.UncompressedSize64)
			if t := f.Modified.UnixMilli(); t > bestSys.Modified {
				bestSys.Modified = t
			}
		}
	}

	// Try to determine active world from server.properties in the zip.
	activeName := ""
	for _, f := range files {
		if f.Name == "server.properties" {
			if rc, err := f.Open(); err == nil {
				props := parsePropertiesReader(rc)
				rc.Close()
				activeName = props["level-name"]
			}
			break
		}
	}

	result := make([]models.WorldSystem, 0, len(systems))
	for base, sys := range systems {
		sys.Active = base == activeName
		result = append(result, *sys)
	}
	return result
}

// worldsFromWorldZip handles a single-world backup zip (zip root = world folder).
func worldsFromWorldZip(worldName string, files []*zip.File) []models.WorldSystem {
	sys := models.WorldSystem{
		Name:       worldName,
		Dimensions: []models.WorldDimension{{Kind: "overworld", Path: worldName}},
	}
	netherFound, endFound := false, false
	for _, f := range files {
		if f.Name == "level.dat" {
			if rc, err := f.Open(); err == nil {
				if meta, err := readLevelDatFromReader(rc); err == nil {
					sys.Meta = meta
				}
				rc.Close()
			}
		}
		if strings.HasPrefix(f.Name, "DIM-1/") && !netherFound {
			sys.Dimensions = append(sys.Dimensions, models.WorldDimension{Kind: "nether"})
			netherFound = true
		}
		if strings.HasPrefix(f.Name, "DIM1/") && !endFound {
			sys.Dimensions = append(sys.Dimensions, models.WorldDimension{Kind: "the_end"})
			endFound = true
		}
		if !f.FileInfo().IsDir() {
			sys.TotalSize += int64(f.UncompressedSize64)
			if t := f.Modified.UnixMilli(); t > sys.Modified {
				sys.Modified = t
			}
		}
	}
	return []models.WorldSystem{sys}
}

// parsePropertiesReader reads key=value lines from a Java-style properties reader.
func parsePropertiesReader(r io.Reader) map[string]string {
	props := make(map[string]string)
	data, err := io.ReadAll(r)
	if err != nil {
		return props
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if i := strings.IndexByte(line, '='); i >= 0 {
			props[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
		}
	}
	return props
}

// ─── Helpers ───────────────────────────────────────────────────────────────

func validateFilename(filename string) error {
	if filename != filepath.Base(filename) || strings.ContainsAny(filename, `/\`) {
		return errors.New("invalid backup filename")
	}
	if !strings.HasSuffix(filename, ".zip") {
		return errors.New("invalid backup filename")
	}
	return nil
}

// isServerFilename detects the legacy server-backup naming convention:
// five leading digits followed by an underscore ({5-digit-id}_…).
func isServerFilename(filename string) bool {
	if len(filename) < 7 {
		return false
	}
	for i := 0; i < 5; i++ {
		if filename[i] < '0' || filename[i] > '9' {
			return false
		}
	}
	return filename[5] == '_'
}

// shortID is the five-digit prefix that separates two backups taken in the same
// second, since the rest of the filename is a one-second timestamp.
//
// It used to build a fresh rand.Source from time.Now().UnixNano() on every call.
// Windows' clock granularity is coarse enough that two consecutive calls read the
// identical nanosecond, and two generators seeded identically produce the identical
// first number: measured on Windows 11, back-to-back calls returned the same id
// 99.01% of the time against 0.001% expected by chance. The id was not random, it
// was a function of the clock, which is exactly what it needed not to be.
//
// math/rand/v2's top-level functions are seeded by the runtime and safe for
// concurrent use, so there is no seed here for a coarse clock to poison.
func shortID() string {
	return fmt.Sprintf("%05d", rand.IntN(100000))
}

// reserveBackupFile creates an empty backup file under dir whose name nothing else
// holds, and returns it open for writing alongside that name.
//
// O_EXCL is the point. shortID being genuinely random makes a same-second collision
// unlikely (1 in 100,000), not impossible, and the old os.Create turned one into
// silent data loss: the second zip truncated the first, and the user was left with
// one backup where they had asked for two. Here a taken name is an error we retry
// with a fresh id, so a collision costs a loop iteration rather than a backup.
func reserveBackupFile(dir string) (*os.File, string, error) {
	for attempt := 0; attempt < 10; attempt++ {
		name := fmt.Sprintf("%s_%s.zip", shortID(), time.Now().Format("02_01_06_150405"))
		f, err := os.OpenFile(filepath.Join(dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			return f, name, nil
		}
		if !os.IsExist(err) {
			return nil, "", err
		}
	}
	return nil, "", errors.New("no free backup filename after 10 attempts")
}

func dirSize(srcDir string) int64 {
	var total int64
	_ = filepath.Walk(srcDir, func(_ string, info os.FileInfo, err error) error { //nolint:errcheck // best-effort size estimate for a progress percentage; a walk error just undercounts
		if err == nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

// zipDirWithProgress writes a zip of srcDir into dest, which the caller has already
// created and is responsible for closing. It takes an open file rather than a path
// so that reserving the name and writing to it cannot race: see reserveBackupFile.
func zipDirWithProgress(srcDir string, dest *os.File, onProgress func(int)) error {
	total := dirSize(srcDir)

	w := zip.NewWriter(dest)
	defer w.Close()

	var written int64
	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			if filepath.Base(path) == "session.lock" {
				return nil
			}
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if info.IsDir() {
			if rel != "." {
				_, err = w.Create(rel + "/")
			}
			return err
		}
		// session.lock is held exclusively by the running server; it contains no
		// world data and is recreated automatically on next start.
		if info.Name() == "session.lock" {
			return nil
		}
		fw, err := w.Create(rel)
		if err != nil {
			return err
		}
		src, err := os.Open(path)
		if err != nil {
			return err
		}
		defer src.Close()
		n, err := io.Copy(fw, src)
		written += n
		if total > 0 && onProgress != nil {
			onProgress(int(written * 100 / total))
		}
		return err
	})
}

func unzipTo(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		target := filepath.Join(destDir, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(filepath.Clean(target)+string(os.PathSeparator), filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal path in zip: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			out.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
