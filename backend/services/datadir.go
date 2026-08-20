package services

import (
	"fmt"
	"os"
	"path/filepath"
)

// DataDir is the app data directory every persisted file lands in.
//
// Single source of truth because two callers need it at different times:
// main() opens the log before wails.Run, and app.startup wires it into the
// services. It used to be computed inline in startup only, which is fine right
// up until a second caller has to agree with it.
//
// Falls back to "." on the platform lookup failing, matching the previous
// inline behaviour: a relative data dir is bad, but refusing to start is worse
// for a local-first app, and WriteDataFile still reports a real error naming
// the directory on the first save.
func DataDir() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = "."
	}
	return filepath.Join(configDir, "konnekt")
}

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
