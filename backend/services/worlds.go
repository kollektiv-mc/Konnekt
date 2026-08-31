package services

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"konnekt/backend/models"
)

// serverGuard is the slice of ServerService the world operations need: the
// running check that gates the destructive ones, and the save-quiesce pair
// DuplicateWorld borrows from the backup path. An interface so a test can
// assert the quiesce ordering without a real server process behind it.
type serverGuard interface {
	IsRunning(serverID string) bool
	PrepareForBackup(serverID string) bool
	ResumeSaves(serverID string)
}

type WorldService struct {
	config *ConfigService
	server serverGuard
	backup *BackupService
}

func NewWorldService(cfg *ConfigService, srv *ServerService, backup *BackupService) *WorldService {
	return &WorldService{config: cfg, server: srv, backup: backup}
}

// ListWorlds scans the active server's working directory for world folders.
// It groups Paper/Spigot dimension siblings (world_nether, world_the_end) and
// vanilla sub-dimensions (DIM-1, DIM1) into a single WorldSystem per base name.
func (s *WorldService) ListWorlds(serverID string) ([]models.WorldSystem, error) {
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return nil, err
	}
	if cfg.WorkingDir == "" {
		return []models.WorldSystem{}, nil
	}

	props, err := readProperties(filepath.Join(cfg.WorkingDir, "server.properties"))
	if err != nil {
		return nil, err
	}
	activeName := props["level-name"]
	if activeName == "" {
		activeName = "world"
	}

	entries, err := os.ReadDir(cfg.WorkingDir)
	if err != nil {
		return nil, err
	}

	// Two-pass: collect all candidate dirs, then group by base name.
	// A world dir is any directory that directly contains level.dat.
	baseSystems := make(map[string]*models.WorldSystem)
	baseDimension := make(map[string]string) // dir name → base name

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		levelDat := filepath.Join(cfg.WorkingDir, name, "level.dat")
		if _, err := os.Stat(levelDat); err != nil {
			continue // not a world folder
		}

		base, kind := classifyWorldDir(name)
		baseDimension[name] = base
		if _, ok := baseSystems[base]; !ok {
			baseSystems[base] = &models.WorldSystem{Name: base}
		}

		dim := buildDimension(filepath.Join(cfg.WorkingDir, name), kind)
		sys := baseSystems[base]
		sys.Dimensions = append(sys.Dimensions, dim)
		sys.TotalSize += dim.Size
		if dim.Modified > sys.Modified {
			sys.Modified = dim.Modified
		}
	}

	// For each system's overworld, also check for vanilla sub-dimensions.
	for base, sys := range baseSystems {
		overworldPath := filepath.Join(cfg.WorkingDir, base)
		for _, subDir := range []struct {
			path string
			kind string
		}{
			{filepath.Join(overworldPath, "DIM-1"), "nether"},
			{filepath.Join(overworldPath, "DIM1"), "the_end"},
		} {
			if _, err := os.Stat(subDir.path); err != nil {
				continue
			}
			// Only add if not already represented by a sibling folder.
			already := false
			for _, d := range sys.Dimensions {
				if d.Kind == subDir.kind {
					already = true
					break
				}
			}
			if !already {
				dim := buildDimension(subDir.path, subDir.kind)
				sys.Dimensions = append(sys.Dimensions, dim)
				sys.TotalSize += dim.Size
				if dim.Modified > sys.Modified {
					sys.Modified = dim.Modified
				}
			}
		}

		// Read level.dat metadata from the overworld folder.
		meta, err := readLevelDat(filepath.Join(overworldPath, "level.dat"))
		if err == nil {
			sys.Meta = meta
		}
		sys.Active = base == activeName
	}

	result := make([]models.WorldSystem, 0, len(baseSystems))
	for _, sys := range baseSystems {
		result = append(result, *sys)
	}
	return result, nil
}

// SetActiveWorld writes level-name in server.properties. Refuses while running.
func (s *WorldService) SetActiveWorld(serverID, name string) error {
	if err := validateWorldName(name); err != nil {
		return err
	}
	if s.server.IsRunning(serverID) {
		return errors.New("stop the server before switching worlds")
	}
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	worldPath := filepath.Join(cfg.WorkingDir, name)
	if _, err := os.Stat(worldPath); err != nil {
		return fmt.Errorf("world %q not found", name)
	}
	return writeProperty(filepath.Join(cfg.WorkingDir, "server.properties"), "level-name", name)
}

// DeleteWorld removes the world folder and its dimension siblings. Refuses while
// running or if the target is the active world (to prevent orphaning the server).
func (s *WorldService) DeleteWorld(serverID, name string) error {
	if err := validateWorldName(name); err != nil {
		return err
	}
	if s.server.IsRunning(serverID) {
		return errors.New("stop the server before deleting a world")
	}
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	props, _ := readProperties(filepath.Join(cfg.WorkingDir, "server.properties"))
	active := props["level-name"]
	if active == "" {
		active = "world"
	}
	if name == active {
		return errors.New("cannot delete the active world; switch to another world first")
	}

	for _, path := range worldSiblings(cfg.WorkingDir, name) {
		if _, err := os.Stat(path); err == nil {
			if err := os.RemoveAll(path); err != nil {
				return fmt.Errorf("delete %q: %w", path, err)
			}
		}
	}
	return nil
}

// RenameWorld renames the overworld folder + Paper/Spigot dimension siblings.
// Refuses while running. Updates level-name if renaming the active world.
func (s *WorldService) RenameWorld(serverID, oldName, newName string) error {
	if err := validateWorldName(oldName); err != nil {
		return err
	}
	if err := validateWorldName(newName); err != nil {
		return err
	}
	if oldName == newName {
		return nil
	}
	if s.server.IsRunning(serverID) {
		return errors.New("stop the server before renaming a world")
	}
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(cfg.WorkingDir, newName)); err == nil {
		return fmt.Errorf("a world named %q already exists", newName)
	}

	props, _ := readProperties(filepath.Join(cfg.WorkingDir, "server.properties"))
	active := props["level-name"]
	if active == "" {
		active = "world"
	}

	// Rename each sibling that exists.
	for _, suffix := range []string{"", "_nether", "_the_end"} {
		oldPath := filepath.Join(cfg.WorkingDir, oldName+suffix)
		newPath := filepath.Join(cfg.WorkingDir, newName+suffix)
		if _, err := os.Stat(oldPath); err != nil {
			continue
		}
		if err := os.Rename(oldPath, newPath); err != nil {
			return fmt.Errorf("rename %q: %w", oldPath, err)
		}
	}

	if oldName == active {
		if err := writeProperty(filepath.Join(cfg.WorkingDir, "server.properties"), "level-name", newName); err != nil {
			return fmt.Errorf("world folder renamed but level-name update failed: %w", err)
		}
	}
	return nil
}

// DuplicateWorld copies the overworld folder + Paper/Spigot dimension siblings
// to newName. A slow operation on large worlds; no progress reporting in alpha.
// Unlike the other world operations it works while the server is running:
// saves are flushed and paused around the copy (the backup path's quiesce),
// so the duplicate cannot capture a region file mid-write.
func (s *WorldService) DuplicateWorld(serverID, name, newName string) error {
	if err := validateWorldName(name); err != nil {
		return err
	}
	if err := validateWorldName(newName); err != nil {
		return err
	}
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(cfg.WorkingDir, newName)); err == nil {
		return fmt.Errorf("a world named %q already exists", newName)
	}

	if s.server != nil && s.server.PrepareForBackup(serverID) {
		defer s.server.ResumeSaves(serverID)
	}

	for _, suffix := range []string{"", "_nether", "_the_end"} {
		src := filepath.Join(cfg.WorkingDir, name+suffix)
		dst := filepath.Join(cfg.WorkingDir, newName+suffix)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		if err := copyDir(src, dst, cfg.WorkingDir); err != nil {
			return fmt.Errorf("duplicate %q: %w", suffix, err)
		}
	}
	return nil
}

// OpenWorldFolder opens the overworld folder in the OS file manager.
func (s *WorldService) OpenWorldFolder(serverID, name string) error {
	if err := validateWorldName(name); err != nil {
		return err
	}
	cfg, err := s.config.GetServerConfig(serverID)
	if err != nil {
		return err
	}
	return OpenPath(filepath.Join(cfg.WorkingDir, name))
}

// BackupWorld zips the target world (+ siblings) via BackupService.
func (s *WorldService) BackupWorld(serverID, name string) (models.Backup, error) {
	if err := validateWorldName(name); err != nil {
		return models.Backup{}, err
	}
	return s.backup.CreateWorldBackup(serverID, name)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// classifyWorldDir returns the base world name and dimension kind for a directory.
// "world_nether" → ("world","nether"), "world_the_end" → ("world","the_end"),
// "world" → ("world","overworld"), "myworld_nether" → ("myworld","nether").
func classifyWorldDir(name string) (base, kind string) {
	if strings.HasSuffix(name, "_the_end") {
		return strings.TrimSuffix(name, "_the_end"), "the_end"
	}
	if strings.HasSuffix(name, "_nether") {
		return strings.TrimSuffix(name, "_nether"), "nether"
	}
	return name, "overworld"
}

// worldSiblings returns all paths that belong to a world (overworld + dimension siblings).
func worldSiblings(workingDir, name string) []string {
	paths := []string{filepath.Join(workingDir, name)}
	for _, suffix := range []string{"_nether", "_the_end"} {
		paths = append(paths, filepath.Join(workingDir, name+suffix))
	}
	return paths
}

func buildDimension(path, kind string) models.WorldDimension {
	size := dirSize(path)
	modified := int64(0)
	if info, err := os.Stat(path); err == nil {
		modified = info.ModTime().UnixMilli()
	}
	return models.WorldDimension{Kind: kind, Path: path, Size: size, Modified: modified}
}

// validateWorldName rejects paths that could escape the working directory.
func validateWorldName(name string) error {
	if name == "" || name == "." || name == ".." {
		return errors.New("invalid world name")
	}
	if name != filepath.Base(name) || strings.ContainsAny(name, `/\`) {
		return errors.New("invalid world name: must be a plain folder name")
	}
	return nil
}

// copyDir recursively copies src to dst, confining all writes to within workingDir.
func copyDir(src, dst, workingDir string) error {
	cleanWork := filepath.Clean(workingDir)
	cleanDst := filepath.Clean(dst)
	if !strings.HasPrefix(cleanDst+string(os.PathSeparator), cleanWork+string(os.PathSeparator)) {
		return errors.New("copy destination escapes working directory")
	}

	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)

		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}

		return copyFile(path, target, info.ModTime())
	})
}

func copyFile(src, dst string, mtime time.Time) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return os.Chtimes(dst, mtime, mtime)
}
