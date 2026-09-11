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

	// mu guards the file. Every mutation here is read-modify-write (SyncLinks
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

// SyncLinks makes the button list agree with what Kommands currently has
// linked, and persists the result if anything moved.
//
// Kommands decides which of its commands are in Konnekt: the shared file holds
// exactly the ones the user linked there, so this side is a view of that list
// rather than a second place to build it. One pass does three things:
//
//   - An entry with no button here gets one, created linked and appended. A
//     batch is appended oldest first, so a first sync reads in the order the
//     commands were made rather than reversed.
//   - A button whose entry's revision moved takes the new label and value and
//     is marked "changed", so the UI can say so. Applied first and surfaced
//     after, never a prompt per edit: that is the decision on #213, and it is
//     also why the badge stays until acknowledged.
//   - A button whose entry is gone is removed. Absence is the user unlinking
//     or deleting the command in Kommands, and the button exists only because
//     it was linked. This reverses an earlier decision to keep such a button
//     and mark it broken, which was taken when a button authored here was
//     bound to a Kommands command afterwards, so removing it would have
//     destroyed the user's own work. MarkLinksBroken keeps that protection for
//     the one case it still fits: the whole file being gone.
//
// Returns whether anything changed, so the caller only emits an event when
// there is something to react to. The poll runs on a timer and a no-op emit
// every 30 seconds would be noise.
func (s *CommandsService) SyncLinks(saved []models.KommandsSavedCommand) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	set, err := s.getLocked()
	if err != nil {
		return false, err
	}
	// Nothing has ever been seeded, so there is nothing to sync into.
	// Deliberately not an error, and deliberately not a write: seeding is the
	// frontend's job and doing it here would race it. The frontend polls again
	// right after seeding, which is when the first sync lands.
	if !set.Seeded {
		return false, nil
	}

	byID := make(map[string]models.KommandsSavedCommand, len(saved))
	for _, c := range saved {
		byID[c.ID] = c
	}

	changed := false
	present := make(map[string]bool, len(saved))
	kept := make([]models.CommandButton, 0, len(set.Items)+len(saved))
	for _, it := range set.Items {
		link := it.Link
		if link == nil || link.Source != models.LinkSourceKommands {
			kept = append(kept, it)
			continue
		}
		// Only plain commands follow a link. A "lifecycle" button's value is one
		// of a fixed set of power actions the frontend dispatches on, and a
		// "special" button's value names a dialog — letting the shared file
		// rewrite either would turn "Stop" into something else entirely. Nothing
		// creates such a button any more; one from an older file is left alone,
		// and still counts as present so it does not get a twin.
		if it.Kind != "cmd" {
			slog.Warn("commands: ignoring link on a non-command button",
				"id", it.ID, "kind", it.Kind)
			present[link.ID] = true
			kept = append(kept, it)
			continue
		}
		orig, ok := byID[link.ID]
		if !ok {
			changed = true
			continue
		}
		present[link.ID] = true
		switch {
		case orig.Revision != link.Revision:
			// A real update, and the button follows its original wholesale. Not
			// "newer": a restored Kommands backup carries a lower revision and
			// the shared file is authoritative either way.
			it.Label = orig.Label
			it.Value = orig.Command
			link.Revision = orig.Revision
			link.Status = models.LinkStatusChanged
			changed = true
		case link.Status == models.LinkStatusBroken:
			// The file came back with the entry in it. The link works again, so
			// stop saying it does not.
			link.Status = models.LinkStatusOK
			changed = true
		}
		// An equal revision does NOT reset an unacknowledged "changed" back to
		// "ok": that is precisely the state a badge is waiting to be seen in,
		// and clearing it here would make it vanish on the next poll.
		kept = append(kept, it)
	}

	for i := len(saved) - 1; i >= 0; i-- {
		c := saved[i]
		if present[c.ID] {
			continue
		}
		kept = append(kept, models.CommandButton{
			ID:    newID(),
			Label: c.Label,
			Kind:  "cmd",
			Value: c.Command,
			Link: &models.CommandLink{
				Source:   models.LinkSourceKommands,
				ID:       c.ID,
				Revision: c.Revision,
				Status:   models.LinkStatusOK,
			},
		})
		present[c.ID] = true
		changed = true
	}

	if !changed {
		return false, nil
	}
	if err := s.saveLocked(kept); err != nil {
		return false, err
	}
	return true, nil
}

// MarkLinksBroken flags every linked button when the shared file itself is
// gone, and reports whether anything moved.
//
// Not the same event as an entry missing from the file, which SyncLinks reads
// as the user unlinking that one command. A file that is gone is an uninstall,
// a moved config directory, or a Kommands that has been reset: the buttons
// still hold the last text they were given and still run it, so they stay, and
// the UI offers to keep each as a plain command or remove it. If the file comes
// back with the entries in it, SyncLinks clears the mark.
func (s *CommandsService) MarkLinksBroken() (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	set, err := s.getLocked()
	if err != nil {
		return false, err
	}
	if !set.Seeded {
		return false, nil
	}
	changed := false
	items := set.Items
	for i := range items {
		link := items[i].Link
		if link == nil || link.Source != models.LinkSourceKommands {
			continue
		}
		if link.Status == models.LinkStatusBroken {
			continue
		}
		link.Status = models.LinkStatusBroken
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
