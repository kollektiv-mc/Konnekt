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

func TestApplyLinks(t *testing.T) {
	saved := []models.KommandsSavedCommand{
		{ID: "k1", Revision: 5, Label: "new label", Command: "new value"},
	}

	tests := []struct {
		name        string
		items       []models.CommandButton
		saved       []models.KommandsSavedCommand
		wantChanged bool
		wantStatus  string
		wantValue   string
		wantPrev    string
	}{
		{
			name:        "same revision is a no-op",
			items:       []models.CommandButton{linked("a", "k1", 5, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: false,
			wantStatus:  models.LinkStatusOK,
			wantValue:   "old value",
		},
		{
			name:        "higher revision applies and stashes the previous",
			items:       []models.CommandButton{linked("a", "k1", 4, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: true,
			wantStatus:  models.LinkStatusChanged,
			wantValue:   "new value",
			wantPrev:    "old value",
		},
		{
			// A restored Kommands backup. The shared file is authoritative, so a
			// lower revision still applies rather than being ignored as stale.
			name:        "lower revision still applies",
			items:       []models.CommandButton{linked("a", "k1", 9, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: true,
			wantStatus:  models.LinkStatusChanged,
			wantValue:   "new value",
			wantPrev:    "old value",
		},
		{
			name:        "missing original marks broken and keeps the value",
			items:       []models.CommandButton{linked("a", "gone", 1, models.LinkStatusOK)},
			saved:       saved,
			wantChanged: true,
			wantStatus:  models.LinkStatusBroken,
			wantValue:   "old value",
		},
		{
			name:        "a restored original clears broken",
			items:       []models.CommandButton{linked("a", "k1", 5, models.LinkStatusBroken)},
			saved:       saved,
			wantChanged: true,
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
			wantStatus:  models.LinkStatusChanged,
			wantValue:   "old value",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, _ := newTestCommands(t)
			if err := s.Save(tt.items); err != nil {
				t.Fatalf("Save: %v", err)
			}
			changed, err := s.ApplyLinks(tt.saved)
			if err != nil {
				t.Fatalf("ApplyLinks: %v", err)
			}
			if changed != tt.wantChanged {
				t.Errorf("changed = %v, want %v", changed, tt.wantChanged)
			}
			got, err := s.Get()
			if err != nil {
				t.Fatalf("Get: %v", err)
			}
			if len(got.Items) != len(tt.items) {
				t.Fatalf("item count changed: %d -> %d", len(tt.items), len(got.Items))
			}
			it := got.Items[0]
			if it.Link.Status != tt.wantStatus {
				t.Errorf("Status = %q, want %q", it.Link.Status, tt.wantStatus)
			}
			if it.Value != tt.wantValue {
				t.Errorf("Value = %q, want %q", it.Value, tt.wantValue)
			}
			if tt.wantPrev != "" && it.Link.PrevValue != tt.wantPrev {
				t.Errorf("PrevValue = %q, want %q", it.Link.PrevValue, tt.wantPrev)
			}
		})
	}
}

// Two updates before the user acknowledges must leave Revert pointing at the
// last state they actually saw, not at the first surprise.
func TestApplyLinksKeepsFirstPrevWhileUnacknowledged(t *testing.T) {
	s, _ := newTestCommands(t)
	if err := s.Save([]models.CommandButton{linked("a", "k1", 1, models.LinkStatusOK)}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	for _, rev := range []int{2, 3} {
		if _, err := s.ApplyLinks([]models.KommandsSavedCommand{
			{ID: "k1", Revision: rev, Label: "l", Command: "v"},
		}); err != nil {
			t.Fatalf("ApplyLinks rev %d: %v", rev, err)
		}
	}
	got, _ := s.Get()
	if got.Items[0].Link.PrevValue != "old value" {
		t.Errorf("PrevValue = %q, want the last acknowledged value %q",
			got.Items[0].Link.PrevValue, "old value")
	}
}

// A link on a lifecycle or dialog button would let the shared file rewrite what
// "Stop" does. Go refuses rather than trusting the frontend not to offer it.
func TestApplyLinksIgnoresNonCommandKinds(t *testing.T) {
	s, _ := newTestCommands(t)
	item := linked("a", "k1", 1, models.LinkStatusOK)
	item.Kind = "lifecycle"
	item.Value = "stop"
	if err := s.Save([]models.CommandButton{item}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	changed, err := s.ApplyLinks([]models.KommandsSavedCommand{
		{ID: "k1", Revision: 2, Label: "x", Command: "deop @a"},
	})
	if err != nil {
		t.Fatalf("ApplyLinks: %v", err)
	}
	if changed {
		t.Error("changed = true, want false for a lifecycle button")
	}
	got, _ := s.Get()
	if got.Items[0].Value != "stop" {
		t.Errorf("Value = %q, want it untouched at %q", got.Items[0].Value, "stop")
	}
}

// Seeding is the frontend's job; touching an unseeded file here would race it.
func TestApplyLinksDoesNothingBeforeSeeding(t *testing.T) {
	s, dir := newTestCommands(t)
	changed, err := s.ApplyLinks([]models.KommandsSavedCommand{{ID: "k1", Revision: 1}})
	if err != nil {
		t.Fatalf("ApplyLinks: %v", err)
	}
	if changed {
		t.Error("changed = true, want false with nothing seeded")
	}
	if _, err := os.Stat(filepath.Join(dir, commandButtonsFile)); !os.IsNotExist(err) {
		t.Error("ApplyLinks created the file; it must not write before seeding")
	}
}

// A UI save that lands after a sync writes back the old revision, so the next
// poll re-applies. Self-healing rather than a lost update — it looks like a bug
// until traced, so it is pinned here.
func TestApplyLinksRecoversFromAStaleSave(t *testing.T) {
	s, _ := newTestCommands(t)
	saved := []models.KommandsSavedCommand{{ID: "k1", Revision: 7, Label: "new", Command: "new"}}
	if err := s.Save([]models.CommandButton{linked("a", "k1", 6, models.LinkStatusOK)}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if _, err := s.ApplyLinks(saved); err != nil {
		t.Fatalf("ApplyLinks: %v", err)
	}
	// The stale write: the UI had the pre-sync array in hand.
	if err := s.Save([]models.CommandButton{linked("a", "k1", 6, models.LinkStatusOK)}); err != nil {
		t.Fatalf("stale Save: %v", err)
	}
	changed, err := s.ApplyLinks(saved)
	if err != nil {
		t.Fatalf("ApplyLinks after stale save: %v", err)
	}
	if !changed {
		t.Fatal("changed = false; a stale save must be re-reconciled")
	}
	got, _ := s.Get()
	if got.Items[0].Value != "new" {
		t.Errorf("Value = %q, want %q", got.Items[0].Value, "new")
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
