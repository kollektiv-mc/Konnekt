package services

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"konnekt/backend/models"
)

// commandButtonsFile is the on-disk name, unchanged from when app.go read and
// wrote it inline as an opaque string.
const commandButtonsFile = "command_buttons.json"

// CommandsService owns the Commands tile's button list.
//
// It exists because linked commands need Go to read individual items (#213
// Phase 4). Before this, GetCommandButtons/SaveCommandButtons passed the file's
// bytes through as a string and nothing on this side knew what a button was.
type CommandsService struct {
	dataDir string
	bus     *EventBus

	// mu guards the file. Every mutation here is read-modify-write (ApplyLinks
	// especially), and the poll goroutine can run one concurrently with a save
	// arriving from the UI.
	mu sync.Mutex
}

func NewCommandsService() *CommandsService {
	return &CommandsService{}
}

func (s *CommandsService) SetDataDir(dir string) {
	s.dataDir = dir
}

func (s *CommandsService) SetBus(bus *EventBus) {
	s.bus = bus
}

// Get returns the button list, and whether a file existed at all.
//
// A missing file reports Seeded=false and no error: a first launch is not a
// failure. A file holding an empty array reports Seeded=true with no items,
// which is how "the user removed every button" stays distinguishable from
// "never seeded" and does not get its defaults put back on next launch.
func (s *CommandsService) Get() (models.CommandButtonSet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getLocked()
}

func (s *CommandsService) getLocked() (models.CommandButtonSet, error) {
	empty := models.CommandButtonSet{Items: []models.CommandButton{}}
	if s.dataDir == "" {
		return empty, fmt.Errorf("read %s: data directory is not set", commandButtonsFile)
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, commandButtonsFile))
	if os.IsNotExist(err) {
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	// A zero-length file is treated as absent rather than as a parse error. It
	// is what a crash between create and write leaves behind, and re-seeding is
	// a better answer there than refusing to show the tile.
	if len(data) == 0 {
		return empty, nil
	}
	var items []models.CommandButton
	if err := json.Unmarshal(data, &items); err != nil {
		return empty, fmt.Errorf("parse %s: %w", commandButtonsFile, err)
	}
	if items == nil {
		items = []models.CommandButton{}
	}
	return models.CommandButtonSet{Seeded: true, Items: items}, nil
}

// Save writes the whole list. The frontend owns ordering, so this is a
// replacement rather than a merge.
func (s *CommandsService) Save(items []models.CommandButton) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(items)
}

func (s *CommandsService) saveLocked(items []models.CommandButton) error {
	if items == nil {
		items = []models.CommandButton{}
	}
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	// WriteDataFile creates the directory and writes atomically, so a crash
	// mid-save leaves the previous list intact rather than a truncated one.
	return WriteDataFile(s.dataDir, commandButtonsFile, data)
}

// ApplyLinks reconciles every linked button against what Kommands currently has
// saved, and persists the result if anything moved.
//
// The decision this implements: an edit in Kommands is applied automatically
// and then surfaced non-blocking, rather than prompting per change. So this
// writes the new value through and leaves a "changed" marker for the UI, which
// the user acknowledges (or reverts) when they get to it.
//
// Returns whether anything changed, so the caller only emits an event when
// there is something to react to. The poll runs on a timer and a no-op emit
// every 30 seconds would be noise.
func (s *CommandsService) ApplyLinks(saved []models.KommandsSavedCommand) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	set, err := s.getLocked()
	if err != nil {
		return false, err
	}
	// Nothing has ever been seeded, so there is nothing to link. Deliberately
	// not an error, and deliberately not a write: seeding is the frontend's job
	// and doing it here would race it.
	if !set.Seeded {
		return false, nil
	}

	byID := make(map[string]models.KommandsSavedCommand, len(saved))
	for _, c := range saved {
		byID[c.ID] = c
	}

	changed := false
	items := set.Items
	for i := range items {
		link := items[i].Link
		if link == nil || link.Source != models.LinkSourceKommands {
			continue
		}
		// Only plain commands follow a link. A "lifecycle" button's value is one
		// of a fixed set of power actions the frontend dispatches on, and a
		// "special" button's value names a dialog — letting the shared file
		// rewrite either would turn "Stop" into something else entirely.
		if items[i].Kind != "cmd" {
			slog.Warn("commands: ignoring link on a non-command button",
				"id", items[i].ID, "kind", items[i].Kind)
			continue
		}
		orig, ok := byID[link.ID]
		if !ok {
			// The original is gone. Keep the button, mark the link.
			if link.Status != models.LinkStatusBroken {
				link.Status = models.LinkStatusBroken
				changed = true
			}
			continue
		}
		if orig.Revision == link.Revision {
			// Up to date. Note this does NOT reset an unacknowledged "changed"
			// back to "ok": the revision matching is precisely the state a badge
			// is waiting to be seen in, and clearing it here would make the badge
			// vanish on the next poll before the user ever noticed it.
			if link.Status == models.LinkStatusBroken {
				// A deleted-then-restored original at the same revision. The link
				// works again, so stop saying it does not.
				link.Status = models.LinkStatusOK
				changed = true
			}
			continue
		}
		// A real update. Stash what it replaced so Revert has somewhere to go,
		// then apply label and value together — the button follows its original
		// wholesale, and anyone wanting their own name uses the fork-on-edit path.
		//
		// Not stashed if a previous change is still unacknowledged: two updates
		// arriving before the user looks would otherwise leave Revert pointing
		// at the first surprise instead of at the last state they actually saw.
		if link.Status != models.LinkStatusChanged {
			link.PrevLabel = items[i].Label
			link.PrevValue = items[i].Value
		}
		items[i].Label = orig.Label
		items[i].Value = orig.Command
		link.Revision = orig.Revision
		link.Status = models.LinkStatusChanged
		changed = true
	}

	if !changed {
		return false, nil
	}
	if err := s.saveLocked(items); err != nil {
		return false, err
	}
	return true, nil
}

// LinkCounts reports how many buttons are linked, broken and awaiting
// acknowledgement, for the library's status chip.
func (s *CommandsService) LinkCounts() (linked, broken, changed int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	set, err := s.getLocked()
	if err != nil {
		return 0, 0, 0
	}
	for _, it := range set.Items {
		if it.Link == nil || it.Link.Source != models.LinkSourceKommands {
			continue
		}
		linked++
		switch it.Link.Status {
		case models.LinkStatusBroken:
			broken++
		case models.LinkStatusChanged:
			changed++
		}
	}
	return linked, broken, changed
}
