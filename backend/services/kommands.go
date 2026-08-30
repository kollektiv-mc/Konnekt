package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"konnekt/backend/models"
)

const (
	kommandsDirName   = "kommands"
	kommandsSavedFile = "saved-commands.json"

	// kommandsPollInterval is the "while the window is open" cadence. It is
	// deliberately slack: the responsive path is the window-focus refresh the
	// frontend triggers, and this only has to catch an edit made in a Kommands
	// window sitting beside an already-focused Konnekt.
	kommandsPollInterval = 30 * time.Second

	// Bounds on what the shared file may contain. Konnekt does not own this
	// file, so it is untrusted input in the ordinary sense: something else
	// writes it and a bug there must not become a problem here.
	kommandsMaxBytes    = 2 << 20 // 2 MiB
	kommandsMaxCommands = 2000
	kommandsMaxCmdLen   = 512
)

// KommandsService reads the commands Kommands has saved, and never writes them.
//
// The read-only posture is the invariant the whole linked-command design rests
// on: with exactly one writer there is no merge, no conflict and no third
// owner, so the two applications cannot diverge.
//
// Change detection is an os.Stat mtime poll rather than a filesystem watch.
// That was a deliberate choice over fsnotify: agent_docs/DEPENDENCIES.md gates
// new Go dependencies, one small file checked every 30 seconds does not justify
// one, and startup and live-update collapse into the same "read it when it
// differs from what we last saw" path either way.
type KommandsService struct {
	commands *CommandsService
	bus      *EventBus

	mu       sync.Mutex
	lastMod  time.Time
	lastSize int64
	// seen is whether a stat has ever succeeded, so the zero lastMod does not
	// read as "we have seen a file with a zero timestamp".
	seen   bool
	status models.KommandsStatus
	// saved is the sanitised list from the last successful read, so the UI can
	// offer "link this button to that command" without re-reading the file on
	// every render.
	saved []models.KommandsSavedCommand

	// stop closes once, from beforeClose. ctx cancellation covers the same
	// ground, but relying on it alone would let ApplyLinks write to disk while
	// the app is shutting down, and it makes the poll untestable without a
	// real 30-second wait.
	stop     chan struct{}
	stopOnce sync.Once

	// pathOverride redirects the shared file, for tests only. The real path
	// comes from os.UserConfigDir(), which a test must not write into: it is the
	// developer's own Kommands install.
	pathOverride string
}

func NewKommandsService(commands *CommandsService) *KommandsService {
	return &KommandsService{
		commands: commands,
		status:   models.KommandsStatus{Path: KommandsSavedPath()},
		stop:     make(chan struct{}),
	}
}

func (s *KommandsService) SetBus(bus *EventBus) {
	s.bus = bus
}

// KommandsDir is Kommands' app data directory, derived the same way
// services.DataDir() derives Konnekt's. Neither application ever has to
// discover the other's location: both are os.UserConfigDir() plus a known name.
func KommandsDir() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		// Matches DataDir()'s fallback. A relative path is wrong, but for a
		// read-only optional integration the honest outcome is "no file found",
		// which is exactly what a bogus path produces.
		configDir = "."
	}
	return filepath.Join(configDir, kommandsDirName)
}

// KommandsSavedPath is the shared file both applications agree on.
func KommandsSavedPath() string {
	return filepath.Join(KommandsDir(), kommandsSavedFile)
}

func (s *KommandsService) savedPath() string {
	if s.pathOverride != "" {
		return s.pathOverride
	}
	return KommandsSavedPath()
}

// Status returns the last computed view of the shared file.
func (s *KommandsService) Status() models.KommandsStatus {
	s.mu.Lock()
	st := s.status
	s.mu.Unlock()
	// Counted outside the lock: LinkCounts takes CommandsService's lock, and
	// holding both in one order here while ApplyLinks holds them in the other
	// is how a deadlock gets written.
	st.LinkedCount, st.BrokenCount, st.ChangedCount = s.commands.LinkCounts()
	return st
}

// Poll checks the shared file and applies any change to the linked buttons.
//
// Safe and cheap to call often: an unchanged mtime and size return after one
// os.Stat. force re-reads even when the stat is unchanged, which the startup
// call uses because "what we last saw" is empty at that point.
func (s *KommandsService) Poll(force bool) error {
	path := s.savedPath()

	info, statErr := os.Stat(path)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			// Kommands is not installed, or has never saved anything. The
			// overwhelmingly common case, and not a failure.
			s.setStatus(models.KommandsStatus{Path: path})
			s.mu.Lock()
			s.seen = false
			s.mu.Unlock()
			return nil
		}
		s.setStatus(models.KommandsStatus{Path: path, Error: statErr.Error()})
		return statErr
	}

	s.mu.Lock()
	unchanged := s.seen && !force &&
		info.ModTime().Equal(s.lastMod) && info.Size() == s.lastSize
	s.mu.Unlock()
	if unchanged {
		return nil
	}

	if info.Size() > kommandsMaxBytes {
		s.rememberStat(info)
		s.setStatus(models.KommandsStatus{
			Path:      path,
			Installed: true,
			Error:     fmt.Sprintf("%s is larger than %d bytes", kommandsSavedFile, kommandsMaxBytes),
		})
		return nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		s.setStatus(models.KommandsStatus{Path: path, Installed: true, Error: err.Error()})
		return err
	}

	var file models.KommandsFile
	if err := json.Unmarshal(data, &file); err != nil {
		// A half-written file is a real possibility if Kommands ever writes
		// non-atomically. Record the stat so we do not re-read the same broken
		// bytes every 30 seconds, and keep the buttons exactly as they are.
		s.rememberStat(info)
		s.setStatus(models.KommandsStatus{
			Path:      path,
			Installed: true,
			Error:     fmt.Sprintf("parse %s: %v", kommandsSavedFile, err),
		})
		return nil
	}

	// Exact match rather than "not newer". A file with no version field at all
	// unmarshals to 0, and treating that as "version 1 by default" would let
	// any JSON object with a commands array drive what runs against a server.
	if file.Version != models.KommandsSchemaVersion {
		s.rememberStat(info)
		s.setStatus(models.KommandsStatus{
			Path: path, Installed: true, Unsupported: true, Version: file.Version,
		})
		return nil
	}

	if len(file.Commands) > kommandsMaxCommands {
		file.Commands = file.Commands[:kommandsMaxCommands]
	}
	kept, rejected := sanitizeSaved(file.Commands)

	s.rememberStat(info)
	s.setStatus(models.KommandsStatus{
		Path:       path,
		Installed:  true,
		Version:    file.Version,
		SavedCount: len(kept),
		Rejected:   rejected,
	})
	s.mu.Lock()
	s.saved = kept
	s.mu.Unlock()

	changed, err := s.commands.ApplyLinks(kept)
	if err != nil {
		slog.Error("kommands: apply links", "error", err)
		return err
	}
	if changed && s.bus != nil {
		s.bus.Emit(EventCommandsChanged, map[string]any{"source": models.LinkSourceKommands})
	}
	return nil
}

func (s *KommandsService) rememberStat(info os.FileInfo) {
	s.mu.Lock()
	s.lastMod = info.ModTime()
	s.lastSize = info.Size()
	s.seen = true
	s.mu.Unlock()
}

func (s *KommandsService) setStatus(st models.KommandsStatus) {
	s.mu.Lock()
	s.status = st
	s.mu.Unlock()
}

// Saved returns the sanitised commands from the last successful read.
//
// Served from cache rather than re-reading, because the library asks for this
// on every render to decide which of Kommands' commands are not linked yet.
func (s *KommandsService) Saved() []models.KommandsSavedCommand {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.KommandsSavedCommand, len(s.saved))
	copy(out, s.saved)
	return out
}

// sanitizeSaved drops entries this build will not hand to a server, and reports
// how many it dropped.
//
// This is the boundary check for the whole feature. A value here is copied onto
// a command button, and from there it reaches SendCommand and the server's
// stdin — and via #216 it will eventually fire from a scheduler graph with no
// human in the loop. The shared file is authenticated by where it lives (only a
// local process can write it), which is what makes the transport sound; this is
// what makes the payload sound.
//
// Rejecting rather than escaping, and skipping the entry rather than the file:
// one malformed command should not cost the user every other link.
func sanitizeSaved(in []models.KommandsSavedCommand) ([]models.KommandsSavedCommand, int) {
	kept := make([]models.KommandsSavedCommand, 0, len(in))
	seen := make(map[string]bool, len(in))
	rejected := 0
	for _, c := range in {
		if c.ID == "" || seen[c.ID] {
			rejected++
			continue
		}
		// Kommands' own UI shows commands with a leading slash; the console
		// input and every entry in PRESETS goes without one. Strip exactly one
		// so both spellings mean the same thing.
		cmd := strings.TrimPrefix(strings.TrimSpace(c.Command), "/")
		if cmd == "" || len(cmd) > kommandsMaxCmdLen || hasControlChar(cmd) {
			rejected++
			continue
		}
		c.Command = cmd
		if c.Label == "" {
			c.Label = cmd
		}
		seen[c.ID] = true
		kept = append(kept, c)
	}
	return kept, rejected
}

// hasControlChar reports whether s holds a character that would let one entry
// become more than one command once written to a server's stdin.
func hasControlChar(s string) bool {
	for _, r := range s {
		if r == '\n' || r == '\r' || unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// Start runs the background poll until ctx is cancelled or Stop is called.
//
// The first poll is forced, which is the "changed while Konnekt was closed"
// case; the issue's own point is that it and the live case are one mechanism,
// so there is no separate catch-up path.
func (s *KommandsService) Start(ctx context.Context) {
	go func() {
		if err := s.Poll(true); err != nil {
			slog.Warn("kommands: initial poll", "error", err)
		}
		ticker := time.NewTicker(kommandsPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.stop:
				return
			case <-ticker.C:
				if err := s.Poll(false); err != nil {
					slog.Warn("kommands: poll", "error", err)
				}
			}
		}
	}()
}

// Stop ends the poll. Idempotent, so calling it from beforeClose and again from
// a test is fine.
func (s *KommandsService) Stop() {
	s.stopOnce.Do(func() { close(s.stop) })
}
