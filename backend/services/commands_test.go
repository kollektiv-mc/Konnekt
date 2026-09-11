package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"konnekt/backend/models"
)

func newTestCommands(t *testing.T) (*CommandsService, string) {
	t.Helper()
	dir := t.TempDir()
	s := NewCommandsService()
	s.SetDataDir(dir)
	return s, dir
}

func writeButtons(t *testing.T, dir string, raw string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, commandButtonsFile), []byte(raw), 0644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}

// The distinction the previous string-returning binding could not make: "no
// file yet, seed the defaults" against "the user deleted every button".
func TestCommandsGetSeededFlag(t *testing.T) {
	tests := []struct {
		name       string
		write      bool
		raw        string
		wantSeeded bool
		wantItems  int
	}{
		{name: "no file at all", write: false, wantSeeded: false},
		{name: "zero-length file", write: true, raw: "", wantSeeded: false},
		{name: "empty array", write: true, raw: `[]`, wantSeeded: true, wantItems: 0},
		{
			name:       "legacy four-field items",
			write:      true,
			raw:        `[{"id":"1","label":"List","kind":"cmd","value":"list"}]`,
			wantSeeded: true,
			wantItems:  1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, dir := newTestCommands(t)
			if tt.write {
				writeButtons(t, dir, tt.raw)
			}
			got, err := s.Get()
			if err != nil {
				t.Fatalf("Get: %v", err)
			}
			if got.Seeded != tt.wantSeeded {
				t.Errorf("Seeded = %v, want %v", got.Seeded, tt.wantSeeded)
			}
			if len(got.Items) != tt.wantItems {
				t.Errorf("len(Items) = %d, want %d", len(got.Items), tt.wantItems)
			}
		})
	}
}

// A file written by the pre-link build has no "group" and no "link". It has to
// keep parsing, because the on-disk format deliberately did not change.
func TestCommandsLegacyFileParsesWithoutLink(t *testing.T) {
	s, dir := newTestCommands(t)
	writeButtons(t, dir, `[{"id":"1","label":"Stop","kind":"lifecycle","value":"stop"}]`)
	got, err := s.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Items[0].Link != nil {
		t.Errorf("Link = %+v, want nil", got.Items[0].Link)
	}
	if got.Items[0].Group != "" {
		t.Errorf("Group = %q, want empty", got.Items[0].Group)
	}
}

func TestCommandsSaveGetRoundTrip(t *testing.T) {
	s, _ := newTestCommands(t)
	want := []models.CommandButton{
		{ID: "a", Label: "List", Kind: "cmd", Value: "list", Group: "Info"},
		{
			ID: "b", Label: "Kit", Kind: "cmd", Value: "give @p stone",
			Link: &models.CommandLink{
				Source: models.LinkSourceKommands, ID: "k1", Revision: 2,
				Status: models.LinkStatusOK,
			},
		},
	}
	if err := s.Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := s.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(got.Items) != 2 || got.Items[0].ID != "a" || got.Items[1].ID != "b" {
		t.Fatalf("order or contents lost: %+v", got.Items)
	}
	if got.Items[0].Group != "Info" {
		t.Errorf("Group = %q, want Info", got.Items[0].Group)
	}
	if got.Items[1].Link == nil || got.Items[1].Link.Revision != 2 {
		t.Errorf("Link lost: %+v", got.Items[1].Link)
	}
}

func linked(id, kommandsID string, rev int, status string) models.CommandButton {
	return models.CommandButton{
		ID: id, Label: "old label", Kind: "cmd", Value: "old value",
		Link: &models.CommandLink{
			Source: models.LinkSourceKommands, ID: kommandsID, Revision: rev, Status: status,
		},
	}
}

func TestSyncLinks(t *testing.T) {
	saved := []models.KommandsSavedCommand{
		{ID: "k1", Revision: 5, Label: "new label", Command: "new value"},
	}

	tests := []struct {
		name        string
		items       []models.CommandButton
		saved       []models.KommandsSavedCommand
		wantChanged bool
		wantItems   int
		wantStatus  string
		wantValue   string
	}{
		{
			name:        "same revision is a no-op",
			items:       []models.CommandButton{linked("a", "k1", 5, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: false,
			wantItems:   1,
			wantStatus:  models.LinkStatusOK,
			wantValue:   "old value",
		},
		{
			name:        "higher revision applies and badges",
			items:       []models.CommandButton{linked("a", "k1", 4, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: true,
			wantItems:   1,
			wantStatus:  models.LinkStatusChanged,
			wantValue:   "new value",
		},
		{
			// A restored Kommands backup. The shared file is authoritative, so a
			// lower revision still applies rather than being ignored as stale.
			name:        "lower revision still applies",
			items:       []models.CommandButton{linked("a", "k1", 9, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: true,
			wantItems:   1,
			wantStatus:  models.LinkStatusChanged,
			wantValue:   "new value",
		},
		{
			// Absence from a file that is present is the user unlinking or
			// deleting the command in Kommands. The button exists only because
			// of the link, so it goes with it.
			name:        "missing original removes the button",
			items:       []models.CommandButton{linked("a", "gone", 1, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: true,
			wantItems:   1, // k1 is materialized in the same pass
			wantStatus:  models.LinkStatusOK,
			wantValue:   "new value",
		},
		{
			name:        "a file that came back clears broken",
			items:       []models.CommandButton{linked("a", "k1", 5, models.LinkStatusBroken)},
			saved:       saved,
			wantChanged: true,
			wantItems:   1,
			wantStatus:  models.LinkStatusOK,
			wantValue:   "old value",
		},
		{
			// An unacknowledged badge must survive the next poll, or it vanishes
			// before the user ever sees it.
			name:        "up to date does not clear an unacknowledged change",
			items:       []models.CommandButton{linked("a", "k1", 5, models.LinkStatusChanged)},
			saved:       saved,
			wantChanged: false,
			wantItems:   1,
			wantStatus:  models.LinkStatusChanged,
			wantValue:   "old value",
		},
		{
			// The case the whole model rests on: linking in Kommands is what
			// creates the button here, with the original's text and a link
			// that already agrees with it.
			name:        "an entry with no button gets one",
			items:       []models.CommandButton{{ID: "plain", Label: "List", Kind: "cmd", Value: "list"}},
			saved:       saved,
			wantChanged: true,
			wantItems:   2,
			wantStatus:  models.LinkStatusOK,
			wantValue:   "new value",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, _ := newTestCommands(t)
			if err := s.Save(tt.items); err != nil {
				t.Fatalf("Save: %v", err)
			}
			changed, err := s.SyncLinks(tt.saved)
			if err != nil {
				t.Fatalf("SyncLinks: %v", err)
			}
			if changed != tt.wantChanged {
				t.Errorf("changed = %v, want %v", changed, tt.wantChanged)
			}
			got, err := s.Get()
			if err != nil {
				t.Fatalf("Get: %v", err)
			}
			if len(got.Items) != tt.wantItems {
				t.Fatalf("item count = %d, want %d: %+v", len(got.Items), tt.wantItems, got.Items)
			}
			var it *models.CommandButton
			for i := range got.Items {
				if got.Items[i].Link != nil && got.Items[i].Link.ID == "k1" {
					it = &got.Items[i]
				}
			}
			if it == nil {
				t.Fatalf("no button follows k1: %+v", got.Items)
			}
			if it.Link.Status != tt.wantStatus {
				t.Errorf("Status = %q, want %q", it.Link.Status, tt.wantStatus)
			}
			if it.Value != tt.wantValue {
				t.Errorf("Value = %q, want %q", it.Value, tt.wantValue)
			}
			if it.Link.Revision != 5 {
				t.Errorf("Revision = %d, want the file's 5", it.Link.Revision)
			}
		})
	}
}

// A first sync of several linked commands reads in the order they were made.
// The file lists newest first; the buttons are appended oldest first, after
// whatever was already here, and each carries the original's label and text.
func TestSyncLinksMaterializesOldestFirstAfterExistingButtons(t *testing.T) {
	s, _ := newTestCommands(t)
	if err := s.Save([]models.CommandButton{{ID: "plain", Label: "List", Kind: "cmd", Value: "list"}}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	changed, err := s.SyncLinks([]models.KommandsSavedCommand{
		{ID: "newest", Revision: 1, Label: "Newest", Command: "say newest"},
		{ID: "oldest", Revision: 2, Label: "Oldest", Command: "say oldest"},
	})
	if err != nil || !changed {
		t.Fatalf("SyncLinks: changed %v, err %v", changed, err)
	}
	got, _ := s.Get()
	if len(got.Items) != 3 {
		t.Fatalf("len(Items) = %d, want 3", len(got.Items))
	}
	if got.Items[0].ID != "plain" {
		t.Errorf("existing button moved: %+v", got.Items[0])
	}
	if got.Items[1].Link.ID != "oldest" || got.Items[2].Link.ID != "newest" {
		t.Errorf("order = %q, %q; want oldest then newest", got.Items[1].Link.ID, got.Items[2].Link.ID)
	}
	made := got.Items[2]
	if made.Kind != "cmd" || made.Label != "Newest" || made.Value != "say newest" || made.ID == "" {
		t.Errorf("materialized button wrong: %+v", made)
	}
	if made.Link.Revision != 1 || made.Link.Status != models.LinkStatusOK {
		t.Errorf("materialized link wrong: %+v", made.Link)
	}
	// Idempotent: the same file again creates nothing.
	changed, err = s.SyncLinks([]models.KommandsSavedCommand{
		{ID: "newest", Revision: 1, Label: "Newest", Command: "say newest"},
		{ID: "oldest", Revision: 2, Label: "Oldest", Command: "say oldest"},
	})
	if err != nil || changed {
		t.Fatalf("second SyncLinks: changed %v, err %v", changed, err)
	}
}

// Only what is gone goes. A button authored here and a button whose original
// is still linked both survive an unlink of a third.
func TestSyncLinksRemovesOnlyTheUnlinked(t *testing.T) {
	s, _ := newTestCommands(t)
	if err := s.Save([]models.CommandButton{
		{ID: "plain", Label: "List", Kind: "cmd", Value: "list"},
		linked("a", "k1", 1, models.LinkStatusOK),
		linked("b", "k2", 1, models.LinkStatusChanged),
	}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	changed, err := s.SyncLinks([]models.KommandsSavedCommand{
		{ID: "k1", Revision: 1, Label: "l", Command: "v"},
	})
	if err != nil || !changed {
		t.Fatalf("SyncLinks: changed %v, err %v", changed, err)
	}
	got, _ := s.Get()
	if len(got.Items) != 2 || got.Items[0].ID != "plain" || got.Items[1].ID != "a" {
		t.Fatalf("Items = %+v, want plain and a", got.Items)
	}
}

// Two updates before the user acknowledges stay one badge, showing the latest.
func TestSyncLinksTwoUpdatesStayOneBadge(t *testing.T) {
	s, _ := newTestCommands(t)
	if err := s.Save([]models.CommandButton{linked("a", "k1", 1, models.LinkStatusOK)}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	for _, rev := range []int{2, 3} {
		if _, err := s.SyncLinks([]models.KommandsSavedCommand{
			{ID: "k1", Revision: rev, Label: "l", Command: "v" + string(rune('0'+rev))},
		}); err != nil {
			t.Fatalf("SyncLinks rev %d: %v", rev, err)
		}
	}
	got, _ := s.Get()
	if got.Items[0].Value != "v3" || got.Items[0].Link.Status != models.LinkStatusChanged {
		t.Errorf("after two updates: %+v %+v", got.Items[0], got.Items[0].Link)
	}
}

// A link on a lifecycle or dialog button would let the shared file rewrite what
// "Stop" does. Nothing creates one any more; one from an older file is left
// alone, and does not get a twin either.
func TestSyncLinksIgnoresNonCommandKinds(t *testing.T) {
	s, _ := newTestCommands(t)
	item := linked("a", "k1", 1, models.LinkStatusOK)
	item.Kind = "lifecycle"
	item.Value = "stop"
	if err := s.Save([]models.CommandButton{item}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	changed, err := s.SyncLinks([]models.KommandsSavedCommand{
		{ID: "k1", Revision: 2, Label: "x", Command: "deop @a"},
	})
	if err != nil {
		t.Fatalf("SyncLinks: %v", err)
	}
	if changed {
		t.Error("changed = true, want false for a lifecycle button")
	}
	got, _ := s.Get()
	if len(got.Items) != 1 || got.Items[0].Value != "stop" {
		t.Errorf("Items = %+v, want the one lifecycle button untouched", got.Items)
	}
}

// Seeding is the frontend's job; touching an unseeded file here would race it.
func TestSyncLinksDoesNothingBeforeSeeding(t *testing.T) {
	s, dir := newTestCommands(t)
	changed, err := s.SyncLinks([]models.KommandsSavedCommand{{ID: "k1", Revision: 1, Command: "list"}})
	if err != nil {
		t.Fatalf("SyncLinks: %v", err)
	}
	if changed {
		t.Error("changed = true, want false with nothing seeded")
	}
	if _, err := os.Stat(filepath.Join(dir, commandButtonsFile)); !os.IsNotExist(err) {
		t.Error("SyncLinks created the file; it must not write before seeding")
	}
}

// A UI save that lands after a sync writes back the old revision, so the next
// poll re-applies. Self-healing rather than a lost update — it looks like a bug
// until traced, so it is pinned here.
func TestSyncLinksRecoversFromAStaleSave(t *testing.T) {
	s, _ := newTestCommands(t)
	saved := []models.KommandsSavedCommand{{ID: "k1", Revision: 7, Label: "new", Command: "new"}}
	if err := s.Save([]models.CommandButton{linked("a", "k1", 6, models.LinkStatusOK)}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := s.SyncLinks(saved); err != nil {
		t.Fatalf("SyncLinks: %v", err)
	}
	// The stale write: the UI had the pre-sync array in hand.
	if err := s.Save([]models.CommandButton{linked("a", "k1", 6, models.LinkStatusOK)}); err != nil {
		t.Fatalf("stale Save: %v", err)
	}
	changed, err := s.SyncLinks(saved)
	if err != nil {
		t.Fatalf("SyncLinks after stale save: %v", err)
	}
	if !changed {
		t.Fatal("changed = false; a stale save must be re-reconciled")
	}
	got, _ := s.Get()
	if got.Items[0].Value != "new" {
		t.Errorf("Value = %q, want %q", got.Items[0].Value, "new")
	}
}

// The file being gone is not an entry being gone: every linked button is kept
// and marked, a plain button is untouched, and doing it twice writes once.
func TestMarkLinksBroken(t *testing.T) {
	s, _ := newTestCommands(t)
	if err := s.Save([]models.CommandButton{
		{ID: "plain", Label: "List", Kind: "cmd", Value: "list"},
		linked("a", "k1", 1, models.LinkStatusOK),
		linked("b", "k2", 1, models.LinkStatusChanged),
	}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	changed, err := s.MarkLinksBroken()
	if err != nil || !changed {
		t.Fatalf("MarkLinksBroken: changed %v, err %v", changed, err)
	}
	got, _ := s.Get()
	if len(got.Items) != 3 {
		t.Fatalf("a button was removed: %+v", got.Items)
	}
	for _, it := range got.Items[1:] {
		if it.Link.Status != models.LinkStatusBroken || it.Value != "old value" {
			t.Errorf("button %q: %+v %+v", it.ID, it, it.Link)
		}
	}
	changed, err = s.MarkLinksBroken()
	if err != nil || changed {
		t.Fatalf("second MarkLinksBroken: changed %v, err %v", changed, err)
	}
	// Nothing seeded, nothing to mark, nothing written.
	fresh, dir := newTestCommands(t)
	if changed, err := fresh.MarkLinksBroken(); err != nil || changed {
		t.Fatalf("unseeded MarkLinksBroken: changed %v, err %v", changed, err)
	}
	if _, err := os.Stat(filepath.Join(dir, commandButtonsFile)); !os.IsNotExist(err) {
		t.Error("MarkLinksBroken created the file; it must not write before seeding")
	}
}

func TestLinkCounts(t *testing.T) {
	s, _ := newTestCommands(t)
	items := []models.CommandButton{
		{ID: "plain", Label: "List", Kind: "cmd", Value: "list"},
		linked("a", "k1", 1, models.LinkStatusOK),
		linked("b", "k2", 1, models.LinkStatusChanged),
		linked("c", "k3", 1, models.LinkStatusBroken),
	}
	if err := s.Save(items); err != nil {
		t.Fatalf("Save: %v", err)
	}
	gotLinked, gotBroken, gotChanged := s.LinkCounts()
	if gotLinked != 3 || gotBroken != 1 || gotChanged != 1 {
		t.Errorf("LinkCounts() = (%d, %d, %d), want (3, 1, 1)", gotLinked, gotBroken, gotChanged)
	}
}

// The on-disk format is a bare array, unchanged from before the model existed.
// A downgrade must still be able to read what this build wrote.
func TestCommandButtonsFileStaysABareArray(t *testing.T) {
	s, dir := newTestCommands(t)
	if err := s.Save([]models.CommandButton{{ID: "a", Label: "L", Kind: "cmd", Value: "v"}}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, commandButtonsFile))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err != nil {
		t.Fatalf("file is not a bare JSON array: %v (%s)", err, raw)
	}
	if _, ok := arr[0]["link"]; ok {
		t.Error("a nil link was serialized; it must be omitempty so old builds are unaffected")
	}
}
