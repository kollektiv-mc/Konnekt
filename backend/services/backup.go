package services

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
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

// backupRoot returns {dataDir}/backups/{serverID}, the one place the id is
// joined into a path, so an id that is not a single segment fails here for
// every backup method (#307). ListBackups and DeleteBackup take the id
// straight from the caller with no config lookup in front of them.
func (s *BackupService) backupRoot(serverID string) (string, error) {
	if err := validServerID(serverID); err != nil {
		return "", err
	}
	return filepath.Join(s.dataDir, "backups", serverID), nil
}

// serverBackupDir returns {dataDir}/backups/{serverID}/server — where full-server backups are stored.
func (s *BackupService) serverBackupDir(serverID string) (string, error) {
	root, err := s.backupRoot(serverID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "server")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// worldBackupDir returns {dataDir}/backups/{serverID}/worlds/{worldName}.
func (s *BackupService) worldBackupDir(serverID, worldName string) (string, error) {
	root, err := s.backupRoot(serverID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "worlds", worldName)
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
	// loadMeta already treats a missing or unparseable meta.json as empty; what
	// reaches here is a read failure, and the listing degrades to untagged.
	meta, err := s.loadMeta(dir)
	if err != nil {
		slog.Debug("backups: meta.json unreadable", "dir", dir, "error", err)
	}
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
	root, err := s.backupRoot(serverID)
	if err != nil {
		return "", "", "", "", err
	}

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
	root, err := s.backupRoot(serverID)
	if err != nil {
		return nil, err
	}
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
		meta, err := s.loadMeta(root)
		if err != nil {
			slog.Debug("backups: meta.json unreadable", "dir", root, "error", err)
		}
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
// All three take the server whose backup they are narrating, so a backup of B
// no longer speaks in A's console (#239).
// All three are nil-safe: fixtures wire a BackupService without a
// ServerService.
func (s *BackupService) narrate(serverID, line string) {
	if s.server != nil {
		s.server.Narrate(serverID, line)
	}
}

func (s *BackupService) narrateDone(serverID, line string) {
	if s.server != nil {
		s.server.NarrateDone(serverID, line)
	}
}

func (s *BackupService) narrateFailed(serverID, line string) {
	if s.server != nil {
		s.server.NarrateFailed(serverID, line)
	}
}

// quiesce pauses the server's saves for the duration of a copy and returns the
// resume the caller defers. An error means neither RCON nor stdin could carry
// the quiesce, and the copy would come off a world still being written to: the
// caller fails the backup with it rather than zipping anyway and reporting
// success (#309).
//
// A stopped server needs no quiesce and is not an error — it returns a resume
// that does nothing, so the caller has one shape to handle rather than three.
func (s *BackupService) quiesce(serverID string) (func(), error) {
	if s.server == nil {
		return func() {}, nil
	}
	paused, err := s.server.PrepareForBackup(serverID)
	if err != nil {
		return nil, fmt.Errorf("could not pause world saves: %w", err)
	}
	if !paused {
		return func() {}, nil
	}
	return func() {
		_ = s.server.ResumeSaves(serverID) //nolint:errcheck // ResumeSaves logs, narrates and emits its own failure (#309); there is no caller left to report it to
	}, nil
}

// fmtBytes renders a byte count for a console line, in the tiers
// frontend/src/lib/format.ts uses, so the console and the tiles agree on a
// size: a 4 GiB archive is "4.00 GB" in both, where this used to narrate
// "4096.0 MB" (#260).
func fmtBytes(n int64) string {
	const kb, mb, gb = 1 << 10, 1 << 20, 1 << 30
	switch {
	case n < kb:
		return fmt.Sprintf("%d B", n)
	case n < mb:
		return fmt.Sprintf("%.1f KB", float64(n)/kb)
	case n < gb:
		return fmt.Sprintf("%.1f MB", float64(n)/mb)
	default:
		return fmt.Sprintf("%.2f GB", float64(n)/gb)
	}
}

// statBackup is os.Stat, swapped by tests to fail the one step after the zip
// is closed. It exists only as that seam.
var statBackup = os.Stat

// mkdirTempRestore is os.MkdirTemp, swapped by tests to fail the staging step
// a restore takes before it has anything to extract: the one restore failure
// that used to return with no event and no console line (#280).
var mkdirTempRestore = os.MkdirTemp

// renameIntoPlace is os.Rename, swapped by tests to fail one dimension of a
// multi-dimension restore and prove the ones already swapped are put back. Same
// seam as mkdirTempRestore, for the same reason: the rollback matters most in the
// case that is hardest to produce for real.
var renameIntoPlace = os.Rename

// failBackup is every way CreateBackup and CreateWorldBackup can fail once
// backup:started has gone out. The frontend shows an in-progress row from that
// event and clears it only on backup:completed or backup:failed, so a path that
// returned without emitting left the row spinning with no toast and no console
// line (#258): the Stat on the finished archive did exactly that, twice.
// Routing every late failure through here is what keeps a sixth path from
// skipping the emit. The archive is removed because "failed" has to mean "no
// archive": ListBackups stats every file it finds, and one the service could
// not stat itself would surface there as a backup.
func (s *BackupService) failBackup(serverID, destPath string, err error) error {
	_ = os.Remove(destPath) //nolint:errcheck // best-effort cleanup of a partial archive; err is what the caller reports
	s.emitBackupFailed(serverID, err)
	s.narrateFailed(serverID, "Backup failed: "+err.Error())
	return err
}

// failRestore is failBackup's twin for the restore paths (#280). A restore
// narrates "Restoring…" before it touches anything, so every failure after
// that line has to narrate and emit, or the console says a restore began and
// never says what became of it: the staging-directory and set-aside failures
// used to return bare. The event is restore's own. It used to be
// backup:failed, which App.tsx toasts as "Backup failed" and the scheduler
// routes to trigger.backup's onFailed port, both wrong for a restore. The
// staging directory needs no cleanup here: the caller defers its removal.
func (s *BackupService) failRestore(serverID, during string, err error) error {
	s.emitRestoreFailed(serverID, err)
	s.narrateFailed(serverID, "Restore failed while "+during+": "+err.Error())
	return err
}

// emitBackupFailed and emitRestoreFailed share one payload shape. App.tsx
// reads both keys (the error for the toast, the serverID to clear the
// processes row) and useBackupWorlds refreshes only when the serverID
// matches; the restore paths used to send {error} alone, so neither matched
// them (#258), and then sent it as backup:failed, so a failed restore toasted
// as a failed backup (#280).
func (s *BackupService) emitBackupFailed(serverID string, err error) {
	s.emitFailed(EventBackupFailed, serverID, err)
}

func (s *BackupService) emitRestoreFailed(serverID string, err error) {
	s.emitFailed(EventRestoreFailed, serverID, err)
}

func (s *BackupService) emitFailed(event, serverID string, err error) {
	s.bus.Emit(event, map[string]interface{}{
		"serverID": serverID,
		"error":    err.Error(),
	})
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
	s.narrate(serverID, "Backing up the server to "+filename)

	resume, err := s.quiesce(serverID)
	if err != nil {
		_ = dest.Close() //nolint:errcheck // failBackup removes the archive next; the quiesce error is what the caller reports
		return models.Backup{}, s.failBackup(serverID, destPath, err)
	}
	defer resume()

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
		return models.Backup{}, s.failBackup(serverID, destPath, zipErr)
	}

	info, err := statBackup(destPath)
	if err != nil {
		return models.Backup{}, s.failBackup(serverID, destPath, err)
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
	s.narrateDone(serverID, fmt.Sprintf("Backup finished: %s (%s)", b.Filename, fmtBytes(b.SizeBytes)))
	return b, nil
}

// CreateWorldBackup zips an arbitrary world folder (by name) so the Worlds tile
// can back up any world, not just the active one. Each world's backups are
// stored under worlds/{worldName}/ for clean organisation.
//
// The archive holds every dimension of the world, not just the overworld (#26).
// Paper, Spigot and Bukkit keep the nether and the end in sibling folders
// (world_nether, world_the_end); zipping only the named folder dropped both, and
// dropped them quietly, because the Worlds tile draws those siblings as moons
// around the planet whose Backup button had just skipped them. Vanilla's DIM-1
// and DIM1 live inside the overworld folder and were never affected.
//
// This makes a world archive multi-root: "world/" and "world_nether/" side by
// side, where it used to be the overworld folder's contents at the zip root.
// Archives written before this still restore: stagedLayoutIsMultiRoot tells the
// two layouts apart for the restore, worldFilesAreMultiRoot for the read.
func (s *BackupService) CreateWorldBackup(serverID, worldName string) (models.Backup, error) {
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return models.Backup{}, err
	}
	// Checked through existingWorldRoots rather than a bare Stat on the world
	// folder: a path that is there but is not a directory passes a Stat and
	// contributes no root, and zipping an empty root set would report a backup
	// that archived nothing. worldSiblings puts the named folder first, so a
	// roots[0] by any other name means only siblings are there, and siblings
	// alone are not a world.
	roots := existingWorldRoots(cfg.WorkingDir, worldName)
	if len(roots) == 0 || filepath.Base(roots[0]) != worldName {
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
	s.narrate(serverID, fmt.Sprintf("Backing up world %q (%s) to %s", worldName, describeWorldRoots(worldName, roots), filename))

	resume, err := s.quiesce(serverID)
	if err != nil {
		_ = dest.Close() //nolint:errcheck // failBackup removes the archive next; the quiesce error is what the caller reports
		return models.Backup{}, s.failBackup(serverID, destPath, err)
	}
	defer resume()

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
	zipErr := zipRootsWithProgress(roots, dest, onProgress)
	if closeErr := dest.Close(); zipErr == nil {
		zipErr = closeErr
	}
	if zipErr != nil {
		return models.Backup{}, s.failBackup(serverID, destPath, zipErr)
	}

	info, err := statBackup(destPath)
	if err != nil {
		return models.Backup{}, s.failBackup(serverID, destPath, err)
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
	s.narrateDone(serverID, fmt.Sprintf("Backup finished: %s (%s)", b.Filename, fmtBytes(b.SizeBytes)))
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
		s.narrate(serverID, "Restoring the server from "+filename)
		tmp, err := mkdirTempRestore(filepath.Dir(workingDir), "konnekt-restore-*")
		if err != nil {
			return s.failRestore(serverID, "preparing a staging directory", err)
		}
		defer os.RemoveAll(tmp)

		if err := unzipTo(zipPath, tmp); err != nil {
			return s.failRestore(serverID, "extracting", err)
		}

		aside := workingDir + ".bak-" + time.Now().Format("20060102-150405")
		if err := os.Rename(workingDir, aside); err != nil && !os.IsNotExist(err) {
			return s.failRestore(serverID, "moving the current files aside", err)
		}
		if err := os.Rename(tmp, workingDir); err != nil {
			_ = os.Rename(aside, workingDir) //nolint:errcheck // best-effort rollback; err below is already the reported failure
			return s.failRestore(serverID, "swapping files, previous state kept", err)
		}
		_ = os.RemoveAll(aside) //nolint:errcheck // best-effort cleanup of the pre-restore backup dir; restore already succeeded
		s.narrateDone(serverID, "Restore finished, server files replaced")
	} else {
		// World-only restore: replace the world's dimension folders.
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
		parentDir := filepath.Dir(targetDir)

		s.narrate(serverID, fmt.Sprintf("Restoring world %q from %s", worldLabel, filename))

		tmp, err := mkdirTempRestore(parentDir, "konnekt-restore-*")
		if err != nil {
			return s.failRestore(serverID, "preparing a staging directory", err)
		}
		defer os.RemoveAll(tmp)

		if err := unzipTo(zipPath, tmp); err != nil {
			return s.failRestore(serverID, "extracting", err)
		}

		// One swap for the old layout, where the staging dir IS the world folder;
		// one per dimension for the new one. Only what the archive holds is
		// replaced: an archive written before #26 carries the overworld alone, and
		// deleting the nether beside it because it is not in the zip would destroy
		// data the user never asked this restore to touch. A dimension the archive
		// does not mention is left exactly where it is.
		swaps := []worldSwap{{staged: tmp, target: targetDir}}
		if stagedLayoutIsMultiRoot(tmp, worldLabel) {
			swaps, err = stagedWorldSwaps(tmp, parentDir)
			if err != nil {
				return s.failRestore(serverID, "reading the extracted archive", err)
			}
		}

		restored, err := s.swapWorldDirs(serverID, swaps)
		if err != nil {
			return err
		}
		s.narrateDone(serverID, fmt.Sprintf("Restore finished, world %q replaced (%s)",
			worldLabel, describeWorldRoots(worldLabel, restored)))
	}

	s.bus.Emit(EventRestoreCompleted, map[string]string{"serverID": serverID, "filename": filename})
	return nil
}

// worldSwap is one directory the restore puts in place: a folder staged under the
// extraction dir, and where it belongs once the swap succeeds.
type worldSwap struct{ staged, target string }

// stagedWorldSwaps pairs each top-level folder of an extracted multi-root world
// archive with its destination beside the other worlds. Files at the staging root
// are ignored: a multi-root archive puts everything under a dimension folder, so
// anything loose there did not come from one.
func stagedWorldSwaps(tmp, parentDir string) ([]worldSwap, error) {
	entries, err := os.ReadDir(tmp)
	if err != nil {
		return nil, err
	}
	swaps := make([]worldSwap, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		swaps = append(swaps, worldSwap{
			staged: filepath.Join(tmp, e.Name()),
			target: filepath.Join(parentDir, e.Name()),
		})
	}
	if len(swaps) == 0 {
		return nil, errors.New("the archive holds no world folders")
	}
	return swaps, nil
}

// swapWorldDirs moves every staged folder into place, moving whatever is already
// there aside first, and returns the targets it replaced.
//
// Two or more renames cannot be one atomic step, so the guarantee here is the
// weaker one that still leaves a bootable server: either every dimension is the
// restored one, or every dimension is the one that was there before. A failure
// part way through puts the folders it had already swapped back before reporting,
// so a Paper world never ends up with a restored overworld beside the nether it
// was not restored with.
func (s *BackupService) swapWorldDirs(serverID string, swaps []worldSwap) ([]string, error) {
	stamp := time.Now().Format("20060102-150405")

	type completed struct {
		target, aside string
		hadAside      bool
	}
	var done []completed

	rollback := func() {
		for i := len(done) - 1; i >= 0; i-- {
			d := done[i]
			_ = os.RemoveAll(d.target) //nolint:errcheck // best-effort rollback; the error being reported is the one that started it
			if d.hadAside {
				_ = os.Rename(d.aside, d.target) //nolint:errcheck // best-effort rollback, same reason
			}
		}
	}

	for _, sw := range swaps {
		aside := sw.target + ".bak-" + stamp
		hadAside := true
		if err := os.Rename(sw.target, aside); err != nil {
			if !os.IsNotExist(err) {
				rollback()
				return nil, s.failRestore(serverID, "moving the current files aside", err)
			}
			// Nothing there to preserve: a dimension the archive has and this
			// server does not is simply created by the swap below.
			hadAside = false
		}
		if err := renameIntoPlace(sw.staged, sw.target); err != nil {
			if hadAside {
				_ = os.Rename(aside, sw.target) //nolint:errcheck // best-effort rollback of this swap; err below is already the reported failure
			}
			rollback()
			return nil, s.failRestore(serverID, "swapping files, previous state kept", err)
		}
		done = append(done, completed{target: sw.target, aside: aside, hadAside: hadAside})
	}

	targets := make([]string, 0, len(done))
	for _, d := range done {
		if d.hadAside {
			_ = os.RemoveAll(d.aside) //nolint:errcheck // best-effort cleanup of the pre-restore copy; the restore already succeeded
		}
		targets = append(targets, d.target)
	}
	return targets, nil
}

// stagedLayoutIsMultiRoot reads the archive's layout off the extracted tree rather
// than off the zip, which keeps the restore to one pass over the archive and, more
// to the point, keeps a corrupt zip being reported as a failure to extract. Opening
// it a second time beforehand reclassified exactly that case.
func stagedLayoutIsMultiRoot(tmp, worldName string) bool {
	if _, err := os.Stat(filepath.Join(tmp, "level.dat")); err == nil {
		return false
	}
	info, err := os.Stat(filepath.Join(tmp, worldName))
	return err == nil && info.IsDir()
}

// worldFilesAreMultiRoot reads the layout off a world archive's entries.
//
// Two signals, in this order, because either one alone is wrong in one direction.
// A level.dat at the zip root can only be the old layout, and settles the case even
// for an old-layout world that happens to contain a subfolder named after itself.
// With no level.dat at the root, a folder named after the world is the new layout.
// Anything else reads as the old layout, which is the answer that leaves an archive
// this function does not recognise restoring exactly the way it did before.
func worldFilesAreMultiRoot(files []*zip.File, worldName string) bool {
	prefix := worldName + "/"
	named := false
	for _, f := range files {
		if f.Name == "level.dat" {
			return false
		}
		if strings.HasPrefix(f.Name, prefix) {
			named = true
		}
	}
	return named
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
			if hasDimensionKind(sys.Dimensions, sub.kind) {
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
			bestSys.TotalSize += zipEntrySize(f)
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

// worldsFromWorldZip reads the dimensions out of a world backup zip, in either
// layout: the multi-root one CreateWorldBackup has written since #26, or the older
// one whose zip root is the overworld folder itself.
func worldsFromWorldZip(worldName string, files []*zip.File) []models.WorldSystem {
	if worldFilesAreMultiRoot(files, worldName) {
		return worldsFromMultiRootWorldZip(worldName, files)
	}
	return worldsFromSingleRootWorldZip(worldName, files)
}

// worldsFromMultiRootWorldZip reads an archive whose top level is one folder per
// dimension. The dimension list is built in a fixed order rather than in the order
// the entries happen to be stored in, so two archives of the same world describe it
// the same way.
func worldsFromMultiRootWorldZip(worldName string, files []*zip.File) []models.WorldSystem {
	sys := models.WorldSystem{
		Name:       worldName,
		Dimensions: []models.WorldDimension{{Kind: "overworld", Path: worldName}},
	}

	// Paper/Spigot siblings.
	for _, sib := range []struct{ suffix, kind string }{
		{"_nether", "nether"},
		{"_the_end", "the_end"},
	} {
		dir := worldName + sib.suffix
		if zipHasPrefix(files, dir+"/") {
			sys.Dimensions = append(sys.Dimensions, models.WorldDimension{Kind: sib.kind, Path: dir})
		}
	}

	// Vanilla sub-dimensions, only for a kind no sibling already supplied: a server
	// that switched layouts can carry both, and one nether is one dimension.
	for _, sub := range []struct{ dir, kind string }{
		{"DIM-1", "nether"},
		{"DIM1", "the_end"},
	} {
		if hasDimensionKind(sys.Dimensions, sub.kind) {
			continue
		}
		path := worldName + "/" + sub.dir
		if zipHasPrefix(files, path+"/") {
			sys.Dimensions = append(sys.Dimensions, models.WorldDimension{Kind: sub.kind, Path: path})
		}
	}

	levelDat := worldName + "/level.dat"
	for _, f := range files {
		if f.Name == levelDat {
			if rc, err := f.Open(); err == nil {
				if meta, err := readLevelDatFromReader(rc); err == nil {
					sys.Meta = meta
				}
				rc.Close()
			}
		}
		if !f.FileInfo().IsDir() {
			sys.TotalSize += zipEntrySize(f)
			if t := f.Modified.UnixMilli(); t > sys.Modified {
				sys.Modified = t
			}
		}
	}
	return []models.WorldSystem{sys}
}

// zipHasPrefix reports whether any file entry sits under prefix. Directory entries
// alone do not count: an empty folder carries no dimension.
func zipHasPrefix(files []*zip.File, prefix string) bool {
	for _, f := range files {
		if strings.HasPrefix(f.Name, prefix) && !f.FileInfo().IsDir() {
			return true
		}
	}
	return false
}

// hasDimensionKind reports whether dims already covers kind.
func hasDimensionKind(dims []models.WorldDimension, kind string) bool {
	for _, d := range dims {
		if d.Kind == kind {
			return true
		}
	}
	return false
}

// worldsFromSingleRootWorldZip handles the pre-#26 layout (zip root = world folder).
func worldsFromSingleRootWorldZip(worldName string, files []*zip.File) []models.WorldSystem {
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
			sys.TotalSize += zipEntrySize(f)
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
// The zip root is srcDir's contents, so a full-server archive holds "world/",
// "server.properties" and the rest at the top level, mirroring the working dir.
func zipDirWithProgress(srcDir string, dest *os.File, onProgress func(int)) error {
	total := dirSize(srcDir)

	w := zip.NewWriter(dest)
	defer w.Close()

	var written int64
	return writeTreeToZip(w, srcDir, "", total, &written, onProgress)
}

// zipRootsWithProgress writes a zip holding each root under its own base name as a
// top-level folder, so a world archive of a Paper server carries "world/",
// "world_nether/" and "world_the_end/" side by side rather than one folder's
// contents at the root (#26).
//
// Progress is a single 0-100 across every root, not one sweep per root: the caller
// emits it straight to the UI, and a bar that restarts twice on a Paper world reads
// as three backups rather than one.
func zipRootsWithProgress(roots []string, dest *os.File, onProgress func(int)) error {
	var total int64
	for _, root := range roots {
		total += dirSize(root)
	}

	w := zip.NewWriter(dest)
	defer w.Close()

	var written int64
	for _, root := range roots {
		if err := writeTreeToZip(w, root, filepath.Base(root), total, &written, onProgress); err != nil {
			return err
		}
	}
	return nil
}

// writeTreeToZip walks srcDir into w, naming every entry under prefix (empty for a
// zip whose root is srcDir itself). written and total are shared across calls so a
// multi-root archive reports one continuous percentage.
func writeTreeToZip(w *zip.Writer, srcDir, prefix string, total int64, written *int64, onProgress func(int)) error {
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
		name := zipEntryName(prefix, rel)
		if info.IsDir() {
			// An unprefixed root has no entry of its own; a prefixed one does, so
			// an empty dimension folder still round-trips as that dimension.
			if name != "" {
				_, err = w.Create(name + "/")
			}
			return err
		}
		// session.lock is held exclusively by the running server; it contains no
		// world data and is recreated automatically on next start.
		if info.Name() == "session.lock" {
			return nil
		}
		fw, err := w.Create(name)
		if err != nil {
			return err
		}
		src, err := os.Open(path)
		if err != nil {
			return err
		}
		defer src.Close()
		n, err := io.Copy(fw, src)
		*written += n
		if total > 0 && onProgress != nil {
			onProgress(int(*written * 100 / total))
		}
		return err
	})
}

// zipEntryName joins a root prefix with a walk-relative path. rel is "." for the
// root itself, which is the empty name for an unprefixed tree and the bare prefix
// for a prefixed one.
func zipEntryName(prefix, rel string) string {
	if rel == "." {
		return prefix
	}
	if prefix == "" {
		return rel
	}
	return prefix + "/" + rel
}

// Restore reads a zip's central directory, which is a claim made by whoever
// wrote the archive rather than a fact about it. A backup can arrive from
// outside Konnekt, because sharing a world archive is an ordinary thing to do,
// so the limits below bound what a restore can be talked into doing before any
// of it reaches the disk. They are sized to be absurd for a Minecraft server
// and still finite for an archive built to exhaust one: the largest single file
// in a server tree is a mod jar or a region file, and a backup that genuinely
// held a terabyte would not be a zip.
const (
	maxZipEntries   = 1 << 20  // 1,048,576 files in one archive
	maxZipEntrySize = 64 << 30 // 64 GiB for any one entry
	maxZipTotalSize = 1 << 40  // 1 TiB extracted in total
)

// zipEntrySize returns f's declared uncompressed size as a non-negative int64.
// UncompressedSize64 is a uint64 read straight out of the archive, so the bare
// int64 conversion this replaces turned a crafted or corrupt header above
// 2^63 into a negative size. Callers that only display a total want the
// clamp; unzipTo wants the rejection zipDeclaredTotal gives it.
func zipEntrySize(f *zip.File) int64 {
	if f.UncompressedSize64 > maxZipEntrySize {
		return maxZipEntrySize
	}
	return int64(f.UncompressedSize64)
}

// zipDeclaredTotal sums what an archive says it will extract to, refusing a
// directory too large to walk, a single entry too large to be a backup, and a
// total too large to land. The sum is taken in uint64 so it cannot wrap the way
// an int64 accumulator would, and it is compared against the ceiling before it
// is narrowed.
func zipDeclaredTotal(files []*zip.File) (int64, error) {
	if len(files) > maxZipEntries {
		return 0, fmt.Errorf("archive declares %d entries, more than the %d a restore will extract", len(files), maxZipEntries)
	}
	var total uint64
	for _, f := range files {
		if f.FileInfo().IsDir() {
			continue
		}
		if f.UncompressedSize64 > maxZipEntrySize {
			return 0, fmt.Errorf("archive entry %q declares %d bytes, more than the %d a restore will extract", f.Name, f.UncompressedSize64, int64(maxZipEntrySize))
		}
		total += f.UncompressedSize64
		if total > maxZipTotalSize {
			return 0, fmt.Errorf("archive declares more than the %d bytes a restore will extract in total", int64(maxZipTotalSize))
		}
	}
	return int64(total), nil
}

func unzipTo(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	if _, err := zipDeclaredTotal(r.File); err != nil {
		return err
	}

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
		// Unbounded by inspection only. archive/zip's own reader stops at the
		// size the central directory declares and returns zip.ErrFormat rather
		// than yield the next byte, so an entry cannot outrun its header here
		// however well it compresses; zipDeclaredTotal above is what bounds the
		// declaration itself. TestUnzipToStopsAtTheDeclaredSize pins both
		// halves, because this line is only safe for as long as the first one
		// holds. gosec sees an io.Copy out of a compressed stream and can see
		// neither guard.
		_, err = io.Copy(out, rc) // #nosec G110 -- bounded by the declared size (stdlib) and by zipDeclaredTotal
		rc.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
