package services

import (
	"fmt"
	"os"
	"path/filepath"
)

// WriteDataFile writes data to {dir}/{name}, creating dir first if it is
// missing.
//
// Everything the app persists — the server list, the active server, app
// settings, the tile layout and its presets, custom commands, command buttons
// and the scheduler's graphs and history — lands as a flat file directly in
// the Wails app data directory. That directory is created once, at startup
// (app.go), and nothing re-created it afterwards: every one of those writes
// used a bare os.WriteFile, so a data directory that was never created, or was
// removed or renamed while the app runs, turned every save into a bare ENOENT
// naming a file rather than the missing directory that actually caused it.
// Creating it here makes each writer self-sufficient, which is the convention
// the per-server writers (backup, config_editor, modservice) already follow.
//
// An empty dir is rejected rather than joined, because filepath.Join("", name)
// is a *relative* path: the old behaviour silently wrote the file into the
// process's working directory — wherever the user happened to launch Konnekt
// from — instead of failing.
func WriteDataFile(dir, name string, data []byte) error {
	if dir == "" {
		return fmt.Errorf("write %s: data directory is not set", name)
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create data directory %s: %w", dir, err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
