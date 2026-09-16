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

// The knock-on to #236's graph migration is deliberately not tested here.
// models.Graph has no ServerID on main yet, so the test that proves a repaired
// active id lets that migration resolve belongs wherever the two changes first
// sit together, not in a file that cannot compile without one of them.
