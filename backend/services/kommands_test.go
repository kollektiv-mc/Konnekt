package services

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"konnekt/backend/models"
)

// newTestKommands points the service at a temp directory. KommandsSavedPath()
// reads the real os.UserConfigDir(), so the path is injected here rather than
// letting a test touch the developer's own Kommands install.
func newTestKommands(t *testing.T) (*KommandsService, *CommandsService, string) {
	t.Helper()
	cmds, _ := newTestCommands(t)
	dir := t.TempDir()
	k := NewKommandsService(cmds)
	k.pathOverride = filepath.Join(dir, kommandsSavedFile)
	return k, cmds, dir
}

func writeSaved(t *testing.T, dir, raw string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, kommandsSavedFile), []byte(raw), 0644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}

// Both applications derive both directories from the same stdlib call, so
// neither ever has to discover the other. They must not collide.
func TestKommandsDirIsNotKonnektDataDir(t *testing.T) {
	if KommandsDir() == DataDir() {
		t.Fatalf("KommandsDir() and DataDir() are both %q", KommandsDir())
	}
	if got, want := filepath.Base(KommandsSavedPath()), kommandsSavedFile; got != want {
		t.Errorf("saved file = %q, want %q", got, want)
	}
	if filepath.Base(KommandsDir()) != kommandsDirName {
		t.Errorf("dir = %q, want it to end in %q", KommandsDir(), kommandsDirName)
	}
}

func TestKommandsPollFileStates(t *testing.T) {
	valid := `{"version":1,"commands":[{"id":"k1","revision":1,"label":"L","command":"list"}]}`

	tests := []struct {
		name            string
		write           bool
		raw             string
		wantInstalled   bool
		wantUnsupported bool
		wantErr         bool
		wantSaved       int
	}{
		{name: "missing file is normal", write: false},
		{name: "valid v1", write: true, raw: valid, wantInstalled: true, wantSaved: 1},
		{
			name: "newer version refused", write: true,
			raw:           `{"version":2,"commands":[{"id":"k1","revision":1,"command":"list"}]}`,
			wantInstalled: true, wantUnsupported: true,
		},
		{
			// Without an exact version match, any JSON object with a commands
			// array would drive what runs against a server.
			name: "missing version refused", write: true,
			raw:           `{"commands":[{"id":"k1","revision":1,"command":"list"}]}`,
			wantInstalled: true, wantUnsupported: true,
		},
		{
			name: "truncated json is recorded, not fatal", write: true,
			raw:           `{"version":1,"commands":[{"id":`,
			wantInstalled: true, wantErr: true,
		},
		{name: "empty command list", write: true, raw: `{"version":1,"commands":[]}`, wantInstalled: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			k, _, dir := newTestKommands(t)
			if tt.write {
				writeSaved(t, dir, tt.raw)
			}
			if err := k.Poll(true); err != nil {
				t.Fatalf("Poll: %v", err)
			}
			got := k.Status()
			if got.Installed != tt.wantInstalled {
				t.Errorf("Installed = %v, want %v", got.Installed, tt.wantInstalled)
			}
			if got.Unsupported != tt.wantUnsupported {
				t.Errorf("Unsupported = %v, want %v", got.Unsupported, tt.wantUnsupported)
			}
			if (got.Error != "") != tt.wantErr {
				t.Errorf("Error = %q, wantErr %v", got.Error, tt.wantErr)
			}
			if len(k.Saved()) != tt.wantSaved {
				t.Errorf("len(Saved()) = %d, want %d", len(k.Saved()), tt.wantSaved)
			}
		})
	}
}

// A value read here is copied onto a button and reaches a server's stdin, and
// via #216 will eventually fire from a scheduler graph with no human watching.
// One malformed entry must not cost the user the rest of the file.
func TestSanitizeSaved(t *testing.T) {
	in := []models.KommandsSavedCommand{
		{ID: "ok", Revision: 1, Label: "Fine", Command: "list"},
		{ID: "slash", Revision: 1, Label: "Slashed", Command: "/say hi"},
		{ID: "", Revision: 1, Command: "op @a"},
		{ID: "newline", Revision: 1, Command: "say hi\nop @a"},
		{ID: "carriage", Revision: 1, Command: "say hi\rop @a"},
		{ID: "control", Revision: 1, Command: "say \x07hi"},
		{ID: "blank", Revision: 1, Command: "   "},
		{ID: "toolong", Revision: 1, Command: strings.Repeat("a", kommandsMaxCmdLen+1)},
		{ID: "ok", Revision: 2, Command: "duplicate id"},
		{ID: "nolabel", Revision: 1, Command: "seed"},
	}
	kept, rejected := sanitizeSaved(in)

	if rejected != 7 {
		t.Errorf("rejected = %d, want 7", rejected)
	}
	byID := map[string]models.KommandsSavedCommand{}
	for _, c := range kept {
		byID[c.ID] = c
	}
	if len(kept) != 3 {
		t.Fatalf("kept %d entries, want 3: %+v", len(kept), kept)
	}
	if byID["slash"].Command != "say hi" {
		t.Errorf("leading slash not stripped: %q", byID["slash"].Command)
	}
	if byID["ok"].Command != "list" {
		t.Errorf("duplicate id kept the wrong entry: %q", byID["ok"].Command)
	}
	if byID["nolabel"].Label != "seed" {
		t.Errorf("empty label should fall back to the command, got %q", byID["nolabel"].Label)
	}
}

func TestSanitizeSavedRejectsAControlCharacter(t *testing.T) {
	for _, cmd := range []string{"say a\nsay b", "say a\rsay b", "say \x00b", "say \x1bb"} {
		kept, rejected := sanitizeSaved([]models.KommandsSavedCommand{{ID: "x", Command: cmd}})
		if len(kept) != 0 || rejected != 1 {
			t.Errorf("command %q was accepted; one entry must not become several commands", cmd)
		}
	}
}

// An unchanged stat must cost one syscall and nothing else, or the poll rewrites
// the button file every 30 seconds forever.
func TestKommandsPollSkipsUnchangedFile(t *testing.T) {
	k, cmds, dir := newTestKommands(t)
	if err := cmds.Save([]models.CommandButton{linked("a", "k1", 1, models.LinkStatusOK)}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	writeSaved(t, dir, `{"version":1,"commands":[{"id":"k1","revision":2,"label":"L","command":"list"}]}`)

	var emits int32
	bus := NewEventBus()
	bus.Subscribe(EventCommandsChanged, func(any) { atomic.AddInt32(&emits, 1) })
	k.SetBus(bus)

	if err := k.Poll(false); err != nil {
		t.Fatalf("first Poll: %v", err)
	}
	// Pin the mtime rather than sleeping: filesystem timestamp granularity makes
	// a time-based version of this flaky.
	info, err := os.Stat(filepath.Join(dir, kommandsSavedFile))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if err := os.Chtimes(filepath.Join(dir, kommandsSavedFile), info.ModTime(), info.ModTime()); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	if err := k.Poll(false); err != nil {
		t.Fatalf("second Poll: %v", err)
	}

	// The emit is asynchronous (EventBus fans out in goroutines).
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && atomic.LoadInt32(&emits) == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&emits); got != 1 {
		t.Errorf("emits = %d, want exactly 1 across two polls", got)
	}
}

func TestKommandsPollAppliesAndEmitsOnce(t *testing.T) {
	k, cmds, dir := newTestKommands(t)
	if err := cmds.Save([]models.CommandButton{linked("a", "k1", 1, models.LinkStatusOK)}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	writeSaved(t, dir, `{"version":1,"commands":[{"id":"k1","revision":4,"label":"New","command":"say new"}]}`)
	if err := k.Poll(true); err != nil {
		t.Fatalf("Poll: %v", err)
	}
	got, _ := cmds.Get()
	if got.Items[0].Value != "say new" {
		t.Errorf("Value = %q, want %q", got.Items[0].Value, "say new")
	}
	if got.Items[0].Link.Status != models.LinkStatusChanged {
		t.Errorf("Status = %q, want %q", got.Items[0].Link.Status, models.LinkStatusChanged)
	}
	if st := k.Status(); st.LinkedCount != 1 || st.ChangedCount != 1 {
		t.Errorf("counts = linked %d changed %d, want 1 and 1", st.LinkedCount, st.ChangedCount)
	}
}

// A file that is too big is refused before it is read into memory.
func TestKommandsPollRefusesAnOversizedFile(t *testing.T) {
	k, _, dir := newTestKommands(t)
	big := `{"version":1,"commands":[]}` + strings.Repeat(" ", kommandsMaxBytes)
	writeSaved(t, dir, big)
	if err := k.Poll(true); err != nil {
		t.Fatalf("Poll: %v", err)
	}
	if st := k.Status(); st.Error == "" {
		t.Error("an oversized file was accepted")
	}
}

func TestKommandsStopIsIdempotent(t *testing.T) {
	k, _, _ := newTestKommands(t)
	k.Stop()
	k.Stop()
}
