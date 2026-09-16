package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"konnekt/backend/models"
)

// ─── The active server id names a server that exists (#363) ────────────────
//
// Nothing used to hold that. SetActiveServerID was the only writer and the
// sidebar its only caller, so deleting the server you were on left the file
// naming it, while the frontend store worked the correction out three times
// over and wrote it back none of them. Go and the UI then disagreed about which
// server was active until the user happened to click one, and #236's graph
// migration could not resolve an id it was right to refuse.

// activeServerFixture returns a ConfigService over a temp dir holding the given
// servers, with activeID written straight to disk so a test can set up the
// dangling state that SetActiveServerID would not produce on its own.
func activeServerFixture(t *testing.T, activeID string, ids ...string) (*ConfigService, string) {
	t.Helper()
	dir := t.TempDir()

	configs := make([]models.ServerConfig, 0, len(ids))
	for _, id := range ids {
		configs = append(configs, models.ServerConfig{ID: id, Name: id})
	}
	data, err := json.Marshal(configs)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "servers.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	if activeID != "" {
		raw, err := json.Marshal(activeID)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "active_server.json"), raw, 0644); err != nil {
			t.Fatal(err)
		}
	}

	s := &ConfigService{}
	return s, dir
}

func activeID(t *testing.T, s *ConfigService) string {
	t.Helper()
	id, err := s.GetActiveServerID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestSetDataDirRepairsADanglingActiveServer(t *testing.T) {
	t.Run("a deleted server is replaced by the first remaining one", func(t *testing.T) {
		s, dir := activeServerFixture(t, "gone", "a", "b")
		s.SetDataDir(dir)
		if got := activeID(t, s); got != "a" {
			t.Errorf("active = %q, want a: the sidebar falls back to the first config too", got)
		}
	})

	t.Run("no active server adopts the first one", func(t *testing.T) {
		s, dir := activeServerFixture(t, "", "a", "b")
		s.SetDataDir(dir)
		if got := activeID(t, s); got != "a" {
			t.Errorf("active = %q, want a", got)
		}
	})

	t.Run("a dangling id with no servers left is cleared", func(t *testing.T) {
		s, dir := activeServerFixture(t, "gone")
		s.SetDataDir(dir)
		if got := activeID(t, s); got != "" {
			t.Errorf("active = %q, want it cleared", got)
		}
	})

	t.Run("a valid id is left alone", func(t *testing.T) {
		s, dir := activeServerFixture(t, "b", "a", "b")
		s.SetDataDir(dir)
		if got := activeID(t, s); got != "b" {
			t.Errorf("active = %q, want b: a healthy install is not re-pointed", got)
		}
	})
}

// A healthy install must not rewrite the file on every launch, the same
// discipline the scheduler's graph migration holds.
func TestSetDataDirWritesNothingWhenNothingIsWrong(t *testing.T) {
	s, dir := activeServerFixture(t, "a", "a", "b")
	path := filepath.Join(dir, "active_server.json")

	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}

	s.SetDataDir(dir)

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(old) {
		t.Error("active_server.json was rewritten with nothing to repair")
	}
}

// An install with no servers and no active id has nothing to name. Writing here
// would create the file purely to say so.
func TestSetDataDirCreatesNoFileForAnEmptyInstall(t *testing.T) {
	s, dir := activeServerFixture(t, "")
	s.SetDataDir(dir)

	if _, err := os.Stat(filepath.Join(dir, "active_server.json")); !os.IsNotExist(err) {
		t.Errorf("active_server.json exists on an install with no servers (%v)", err)
	}
}

func TestDeleteServerConfigRepointsTheActiveServer(t *testing.T) {
	t.Run("deleting the active server moves to the first remaining", func(t *testing.T) {
		s, dir := activeServerFixture(t, "a", "a", "b")
		s.SetDataDir(dir)

		if err := s.DeleteServerConfig("a"); err != nil {
			t.Fatal(err)
		}
		if got := activeID(t, s); got != "b" {
			t.Errorf("active = %q, want b: it must not name the server just deleted", got)
		}
	})

	t.Run("deleting another server leaves the active one alone", func(t *testing.T) {
		s, dir := activeServerFixture(t, "b", "a", "b")
		s.SetDataDir(dir)

		if err := s.DeleteServerConfig("a"); err != nil {
			t.Fatal(err)
		}
		if got := activeID(t, s); got != "b" {
			t.Errorf("active = %q, want b", got)
		}
	})

	t.Run("deleting the last server clears it", func(t *testing.T) {
		s, dir := activeServerFixture(t, "a", "a")
		s.SetDataDir(dir)

		if err := s.DeleteServerConfig("a"); err != nil {
			t.Fatal(err)
		}
		if got := activeID(t, s); got != "" {
			t.Errorf("active = %q, want it cleared", got)
		}
	})
}

func TestSaveServerConfigAdoptsTheFirstServer(t *testing.T) {
	t.Run("the first server becomes active", func(t *testing.T) {
		s, dir := activeServerFixture(t, "")
		s.SetDataDir(dir)

		if err := s.SaveServerConfig(models.ServerConfig{ID: "first", Name: "First"}); err != nil {
			t.Fatal(err)
		}
		if got := activeID(t, s); got != "first" {
			t.Errorf("active = %q, want first", got)
		}
	})

	t.Run("a later server does not steal the selection", func(t *testing.T) {
		s, dir := activeServerFixture(t, "a", "a")
		s.SetDataDir(dir)

		if err := s.SaveServerConfig(models.ServerConfig{ID: "b", Name: "B"}); err != nil {
			t.Fatal(err)
		}
		if got := activeID(t, s); got != "a" {
			t.Errorf("active = %q, want a: adding a server must not switch to it", got)
		}
	})

	t.Run("editing a server does not change the selection", func(t *testing.T) {
		s, dir := activeServerFixture(t, "b", "a", "b")
		s.SetDataDir(dir)

		if err := s.SaveServerConfig(models.ServerConfig{ID: "a", Name: "Renamed"}); err != nil {
			t.Fatal(err)
		}
		if got := activeID(t, s); got != "b" {
			t.Errorf("active = %q, want b", got)
		}
	})
}

// The reason this matters beyond the id itself: #236's graph migration refuses a
// dangling active id, and with more than one server to choose between it leaves
// the graph unassigned, which is what forces the two fallbacks that issue left
// behind. Repairing the id first is what lets the migration resolve.
//
// This test could not be written when the fix was, because models.Graph had no
// ServerID on main until #362 merged. It is the case the two changes only make
// checkable together.
func TestGraphMigrationResolvesOnceTheActiveIdIsRepaired(t *testing.T) {
	dir := t.TempDir()

	cfgSvc := &ConfigService{}
	cfgSvc.SetDataDir(dir)
	// Three servers, not two. Deleting one of two leaves a single config, and
	// resolveMigrationServerID falls back to the only server there is whatever
	// the active id says, so the test would pass with this fix reverted.
	for _, id := range []string{"a", "b", "c"} {
		if err := cfgSvc.SaveServerConfig(models.ServerConfig{ID: id, Name: id}); err != nil {
			t.Fatal(err)
		}
	}
	// Select a server and then delete it, which is exactly the state the app used
	// to leave on disk: an active id naming something that is gone.
	if err := cfgSvc.SetActiveServerID("c"); err != nil {
		t.Fatal(err)
	}
	if err := cfgSvc.DeleteServerConfig("c"); err != nil {
		t.Fatal(err)
	}

	graphs, err := json.Marshal([]models.Graph{{ID: "g1", Name: "g1"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "scheduler.json"), graphs, 0644); err != nil {
		t.Fatal(err)
	}

	sched := &SchedulerService{
		running:   make(map[string]bool),
		lastFired: make(map[string]time.Time),
		stopTime:  make(chan struct{}),
	}
	sched.bus = NewEventBus()
	sched.deps = serviceDeps{bus: sched.bus, config: cfgSvc}
	sched.registry = NewBlockRegistry()
	sched.SetDataDir(dir)

	if len(sched.graphs) != 1 || sched.graphs[0].ServerID != "a" {
		t.Errorf("graph owner = %+v, want the surviving server a: a dangling active id leaves it unassigned", sched.graphs)
	}
}
