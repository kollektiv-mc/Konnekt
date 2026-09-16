package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"konnekt/backend/models"
)

// ─── Assigning a server to graphs written before graphs had one (#236) ──────
//
// This migration runs once against a real user's scheduler.json and there is no
// second chance at it. Every branch of it is pinned here, including the ones
// that deliberately do nothing: assigning a graph to a server that does not
// exist hides a schedule behind a server nobody can select, which is a worse
// failure than leaving it ambient.

func TestResolveMigrationServerID(t *testing.T) {
	three := []models.ServerConfig{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	one := []models.ServerConfig{{ID: "only"}}

	cases := []struct {
		name     string
		activeID string
		configs  []models.ServerConfig
		want     string
	}{
		{"the active server, when it exists", "b", three, "b"},
		{"the only server, whatever active says", "b", one, "only"},
		{"the only server, when active is empty", "", one, "only"},
		{"nothing, when active names a deleted server", "gone", three, ""},
		{"nothing, when there is no active server", "", three, ""},
		{"nothing, when there are no servers at all", "a", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveMigrationServerID(tc.activeID, tc.configs); got != tc.want {
				t.Errorf("resolveMigrationServerID(%q, %v) = %q, want %q",
					tc.activeID, tc.configs, got, tc.want)
			}
		})
	}
}

func TestAssignMissingServerIDs(t *testing.T) {
	t.Run("fills only the empty ones", func(t *testing.T) {
		in := []models.Graph{
			{ID: "g1"},
			{ID: "g2", ServerID: "already"},
			{ID: "g3"},
		}
		out, changed := assignMissingServerIDs(in, "srv")
		if !changed {
			t.Fatal("changed = false, want true")
		}
		if out[0].ServerID != "srv" || out[2].ServerID != "srv" {
			t.Errorf("unassigned graphs = %q/%q, want srv", out[0].ServerID, out[2].ServerID)
		}
		if out[1].ServerID != "already" {
			t.Errorf("assigned graph = %q, want it untouched", out[1].ServerID)
		}
		// The input slice is not written through: SetDataDir keeps the loaded
		// copy until the migration returns, and a half-migrated slice under a
		// failed write would be the worst of both.
		if in[0].ServerID != "" {
			t.Errorf("input graph was mutated in place: %q", in[0].ServerID)
		}
	})

	t.Run("an already-migrated file reports no change", func(t *testing.T) {
		in := []models.Graph{{ID: "g1", ServerID: "srv"}}
		if _, changed := assignMissingServerIDs(in, "srv"); changed {
			t.Error("changed = true on an already-migrated file; it would be rewritten every launch")
		}
	})

	t.Run("no target assigns nothing", func(t *testing.T) {
		in := []models.Graph{{ID: "g1"}}
		out, changed := assignMissingServerIDs(in, "")
		if changed || out[0].ServerID != "" {
			t.Errorf("changed = %v, serverID = %q; want the graph left ambient", changed, out[0].ServerID)
		}
	})

	t.Run("an empty file reports no change", func(t *testing.T) {
		if _, changed := assignMissingServerIDs(nil, "srv"); changed {
			t.Error("changed = true with no graphs")
		}
	})
}

// newMigrationFixture writes scheduler.json holding graphs, plus the given
// server configs and active id, and returns a scheduler pointed at that dir.
func newMigrationFixture(t *testing.T, graphs []models.Graph, configs []models.ServerConfig, activeID string) (*SchedulerService, string) {
	t.Helper()
	dataDir := t.TempDir()

	cfgSvc := &ConfigService{}
	cfgSvc.SetDataDir(dataDir)
	for _, c := range configs {
		if c.Name == "" {
			c.Name = c.ID
		}
		if err := cfgSvc.SaveServerConfig(c); err != nil {
			t.Fatal(err)
		}
	}
	if activeID != "" {
		if err := cfgSvc.SetActiveServerID(activeID); err != nil {
			t.Fatal(err)
		}
	}

	data, err := json.Marshal(graphs)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "scheduler.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	s := &SchedulerService{
		running:   make(map[string]bool),
		lastFired: make(map[string]time.Time),
		stopTime:  make(chan struct{}),
	}
	s.bus = NewEventBus()
	s.deps = serviceDeps{bus: s.bus, config: cfgSvc}
	s.registry = NewBlockRegistry()
	return s, dataDir
}

// readPersistedGraphs reads scheduler.json back, which is what the next launch
// sees. An in-memory migration that never reached disk would run again, and
// against a different active server the second time.
func readPersistedGraphs(t *testing.T, dataDir string) []models.Graph {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dataDir, "scheduler.json"))
	if err != nil {
		t.Fatal(err)
	}
	var graphs []models.Graph
	if err := json.Unmarshal(data, &graphs); err != nil {
		t.Fatal(err)
	}
	return graphs
}

func TestSetDataDirAssignsGraphOwners(t *testing.T) {
	t.Run("to the active server", func(t *testing.T) {
		s, dataDir := newMigrationFixture(t,
			[]models.Graph{{ID: "g1"}, {ID: "g2"}},
			[]models.ServerConfig{{ID: "a"}, {ID: "b"}},
			"b",
		)
		s.SetDataDir(dataDir)

		for _, g := range s.graphs {
			if g.ServerID != "b" {
				t.Errorf("graph %s in memory = %q, want b", g.ID, g.ServerID)
			}
		}
		for _, g := range readPersistedGraphs(t, dataDir) {
			if g.ServerID != "b" {
				t.Errorf("graph %s on disk = %q, want b", g.ID, g.ServerID)
			}
		}
	})

	t.Run("to the only server when the active one was deleted", func(t *testing.T) {
		s, dataDir := newMigrationFixture(t,
			[]models.Graph{{ID: "g1"}},
			[]models.ServerConfig{{ID: "survivor"}},
			"deleted",
		)
		s.SetDataDir(dataDir)
		if s.graphs[0].ServerID != "survivor" {
			t.Errorf("serverID = %q, want survivor", s.graphs[0].ServerID)
		}
	})

	t.Run("left ambient when the active one was deleted and several remain", func(t *testing.T) {
		s, dataDir := newMigrationFixture(t,
			[]models.Graph{{ID: "g1"}},
			[]models.ServerConfig{{ID: "a"}, {ID: "b"}, {ID: "c"}},
			"deleted",
		)
		s.SetDataDir(dataDir)
		if s.graphs[0].ServerID != "" {
			t.Errorf("serverID = %q; a graph must never be assigned to a server that is not there", s.graphs[0].ServerID)
		}
	})

	t.Run("left ambient when there is no active server", func(t *testing.T) {
		s, dataDir := newMigrationFixture(t,
			[]models.Graph{{ID: "g1"}},
			[]models.ServerConfig{{ID: "a"}, {ID: "b"}},
			"",
		)
		s.SetDataDir(dataDir)
		if s.graphs[0].ServerID != "" {
			t.Errorf("serverID = %q, want it left ambient", s.graphs[0].ServerID)
		}
	})

	t.Run("a mixed file gains owners only where they are missing", func(t *testing.T) {
		s, dataDir := newMigrationFixture(t,
			[]models.Graph{{ID: "old"}, {ID: "new", ServerID: "a"}},
			[]models.ServerConfig{{ID: "a"}, {ID: "b"}},
			"b",
		)
		s.SetDataDir(dataDir)

		byID := map[string]string{}
		for _, g := range s.graphs {
			byID[g.ID] = g.ServerID
		}
		if byID["old"] != "b" || byID["new"] != "a" {
			t.Errorf("owners = %v, want old on the active server and new left alone", byID)
		}
	})

	t.Run("an already-migrated file is not rewritten", func(t *testing.T) {
		s, dataDir := newMigrationFixture(t,
			[]models.Graph{{ID: "g1", ServerID: "a"}},
			[]models.ServerConfig{{ID: "a"}},
			"a",
		)
		path := filepath.Join(dataDir, "scheduler.json")
		before, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		// Back-date it so a rewrite is visible even at coarse mtime resolution.
		old := before.ModTime().Add(-time.Hour)
		if err := os.Chtimes(path, old, old); err != nil {
			t.Fatal(err)
		}

		s.SetDataDir(dataDir)

		after, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if !after.ModTime().Equal(old) {
			t.Error("scheduler.json was rewritten with nothing to migrate")
		}
	})
}
