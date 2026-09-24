package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"konnekt/backend/models"
)

// newPropsFixture wires a ServerService to a real ConfigService with one
// server, so SetConfig's lookup is what finds the file.
func newPropsFixture(t *testing.T) (*ServerService, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := NewConfigService()
	cfg.SetDataDir(filepath.Join(t.TempDir(), "konnekt"))
	if err := cfg.SaveServerConfig(models.ServerConfig{ID: "srv", Name: "Survival", WorkingDir: dir}); err != nil {
		t.Fatalf("SaveServerConfig: %v", err)
	}
	srv := NewServerService()
	srv.SetConfig(cfg)
	return srv, dir
}

func writeProps(t *testing.T, dir, body string, mod time.Time) {
	t.Helper()
	path := filepath.Join(dir, "server.properties")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write server.properties: %v", err)
	}
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
}

// #412: the app has just launched, or the server was last run outside
// Konnekt. Start has never read the file, and the figure is still the file's.
func TestStoppedServerReadsMaxPlayersBeforeAnyBoot(t *testing.T) {
	srv, dir := newPropsFixture(t)
	writeProps(t, dir, "max-players=50\n", time.Unix(1_000, 0))

	if got := srv.Status("srv").MaxPlayers; got != 50 {
		t.Errorf("Status().MaxPlayers = %d, want 50", got)
	}
	if got := srv.MaxPlayers("srv"); got != 50 {
		t.Errorf("MaxPlayers() = %d, want 50", got)
	}
}

// #412: max-players edited while stopped shows before the next boot.
func TestStoppedServerFollowsAnEditedMaxPlayers(t *testing.T) {
	srv, dir := newPropsFixture(t)
	writeProps(t, dir, "max-players=50\n", time.Unix(1_000, 0))
	srv.Status("srv")

	writeProps(t, dir, "max-players=8\n", time.Unix(2_000, 0))
	if got := srv.Status("srv").MaxPlayers; got != 8 {
		t.Errorf("MaxPlayers after the edit = %d, want 8", got)
	}
}

// The file is parsed only when its stamp moves. Same size, same mtime, new
// content: the cached figure stands, which is what keeps the 10s status tick
// to one stat.
func TestStoppedServerDoesNotReparseAnUnchangedFile(t *testing.T) {
	srv, dir := newPropsFixture(t)
	mod := time.Unix(1_000, 0)
	writeProps(t, dir, "max-players=50\n", mod)
	srv.Status("srv")

	writeProps(t, dir, "max-players=60\n", mod)
	if got := srv.Status("srv").MaxPlayers; got != 50 {
		t.Errorf("MaxPlayers = %d, want the cached 50", got)
	}
}

// A running server re-reads the file only at its next boot, so an edit made
// while it runs is not what it is enforcing yet.
func TestRunningServerKeepsItsBootedMaxPlayers(t *testing.T) {
	srv, dir := newPropsFixture(t)
	writeProps(t, dir, "max-players=50\n", time.Unix(1_000, 0))
	in := srv.instanceFor("srv")
	in.mu.Lock()
	in.running = true
	in.maxPlayers = 30
	in.mu.Unlock()

	if got := srv.Status("srv").MaxPlayers; got != 30 {
		t.Errorf("MaxPlayers while running = %d, want the booted 30", got)
	}
}

// With no file to read, a stopped server falls back to what its last boot
// read, and to the default before any boot.
func TestStoppedServerWithoutPropertiesFallsBack(t *testing.T) {
	srv, _ := newPropsFixture(t)
	if got := srv.Status("srv").MaxPlayers; got != defaultMaxPlayers {
		t.Errorf("MaxPlayers = %d, want the %d default", got, defaultMaxPlayers)
	}

	in := srv.instanceFor("srv")
	in.mu.Lock()
	in.maxPlayers = 30
	in.mu.Unlock()
	if got := srv.Status("srv").MaxPlayers; got != 30 {
		t.Errorf("MaxPlayers = %d, want the last boot's 30", got)
	}
}

func TestPushStatusEmitsTheServersStatus(t *testing.T) {
	srv, dir := newPropsFixture(t)
	bus := NewEventBus()
	srv.SetBus(bus)
	statuses := collect(bus, EventServerStatus)
	writeProps(t, dir, "max-players=50\n", time.Unix(1_000, 0))

	srv.PushStatus("srv")

	got := statuses()
	if len(got) != 1 {
		t.Fatalf("want 1 server:status, got %d", len(got))
	}
	st, ok := got[0].(models.ServerStatusEvent)
	if !ok {
		t.Fatalf("payload should be models.ServerStatusEvent, got %T", got[0])
	}
	if st.ServerID != "srv" || st.MaxPlayers != 50 {
		t.Errorf("pushed %q with MaxPlayers %d, want srv with 50", st.ServerID, st.MaxPlayers)
	}
}
