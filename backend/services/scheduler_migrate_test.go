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

	// This used to pass two server configs and no active id. That state is no
	// longer reachable: #363 made ConfigService adopt the first server when
	// nothing is active, so a fixture that saves a config cannot leave the active
	// id empty. Configured servers with no selection among them is exactly the
	// hole that issue closed, and the pure function's own branch for it is still
	// covered by TestResolveMigrationServerID. What survives end to end is the
	// case below: no servers at all, so there is nothing to assign.
	t.Run("left ambient when there are no servers at all", func(t *testing.T) {
		s, dataDir := newMigrationFixture(t,
			[]models.Graph{{ID: "g1"}},
			nil,
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

// ─── Folding command presets onto the command field (#161) ─────────────────
//
// Same stakes as the migration above: it runs once against a real user's
// scheduler.json. The rule it has to reproduce is the old precedence, where a
// non-empty preset beat whatever was typed in the command field, so a graph
// that ran "time set day" before the change still runs it after.

func cmdNode(id, blockType string, cfg map[string]interface{}) models.Node {
	return models.Node{ID: id, Type: blockType, Config: cfg}
}

func TestFoldCommandPresets(t *testing.T) {
	cases := []struct {
		name        string
		node        models.Node
		wantCommand string
		wantChanged bool
	}{
		{
			name:        "a chosen preset becomes the command",
			node:        cmdNode("n", "action.command", map[string]interface{}{"preset": "time set day", "command": ""}),
			wantCommand: "time set day",
			wantChanged: true,
		},
		{
			// The case the bug was about: the typed command was being ignored at
			// runtime, so the preset is what the graph actually did.
			name:        "a preset still wins over a typed command, as it did before",
			node:        cmdNode("n", "action.command", map[string]interface{}{"preset": "time set day", "command": "say hello"}),
			wantCommand: "time set day",
			wantChanged: true,
		},
		{
			name:        "an empty preset leaves the typed command alone",
			node:        cmdNode("n", "action.command", map[string]interface{}{"preset": "", "command": "say hello"}),
			wantCommand: "say hello",
			wantChanged: true,
		},
		{
			name:        "a lifecycle sentinel survives as the command",
			node:        cmdNode("n", "action.command", map[string]interface{}{"preset": "__restart__", "command": ""}),
			wantCommand: "__restart__",
			wantChanged: true,
		},
		{
			name:        "rcon nodes fold the same way",
			node:        cmdNode("n", "action.rcon", map[string]interface{}{"preset": "save-all", "command": "list"}),
			wantCommand: "save-all",
			wantChanged: true,
		},
		{
			name:        "an already-migrated node is left untouched",
			node:        cmdNode("n", "action.command", map[string]interface{}{"command": "say hello"}),
			wantCommand: "say hello",
			wantChanged: false,
		},
		{
			name:        "a block that never had the pair is ignored",
			node:        cmdNode("n", "action.backup", map[string]interface{}{"preset": "whatever"}),
			wantCommand: "",
			wantChanged: false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			graphs := []models.Graph{{ID: "g", Nodes: []models.Node{c.node}}}

			got, changed := foldCommandPresets(graphs)
			if changed != c.wantChanged {
				t.Fatalf("changed = %v, want %v", changed, c.wantChanged)
			}

			cfg := got[0].Nodes[0].Config
			if c.wantCommand != "" {
				if cfg["command"] != c.wantCommand {
					t.Errorf("command = %v, want %q", cfg["command"], c.wantCommand)
				}
			}
			// The whole point is that there is one value now. A surviving
			// preset key would be a second one for execCommand to prefer.
			if c.wantChanged {
				if _, still := cfg["preset"]; still {
					t.Error("preset key survived the fold")
				}
			}
		})
	}
}

func TestFoldCommandPresetsIsIdempotent(t *testing.T) {
	graphs := []models.Graph{{ID: "g", Nodes: []models.Node{
		cmdNode("n", "action.command", map[string]interface{}{"preset": "time set day", "command": "say hi"}),
	}}}

	graphs, first := foldCommandPresets(graphs)
	if !first {
		t.Fatal("first fold reported no change")
	}
	// A second launch must not rewrite scheduler.json again.
	graphs, second := foldCommandPresets(graphs)
	if second {
		t.Error("second fold reported a change on already-folded graphs")
	}
	if graphs[0].Nodes[0].Config["command"] != "time set day" {
		t.Errorf("command drifted on the second fold: %v", graphs[0].Nodes[0].Config["command"])
	}
}

func TestFoldCommandPresetsToleratesNilConfig(t *testing.T) {
	graphs := []models.Graph{{ID: "g", Nodes: []models.Node{{ID: "n", Type: "action.command"}}}}

	if _, changed := foldCommandPresets(graphs); changed {
		t.Error("a node with no config reported a change")
	}
}
