package services

import (
	"testing"
	"time"

	"konnekt/backend/models"
)

// ─── A graph acts on the server it was authored against (#236) ─────────────
//
// Every run used to resolve its target from active_server.json at fire time, so
// clicking a different server in the sidebar silently re-pointed every schedule
// the user had written. A backup graph authored against A backed up B.

// registerServerProbe registers a block that records the ServerID its
// ExecContext was handed, which is the server every action in that run acts on.
func registerServerProbe(reg *BlockRegistry, seen *[]string) {
	must(reg.RegisterBlock(models.BlockDef{
		ID:             "test.serverProbe",
		Category:       "action",
		ControlInputs:  []string{"trigger"},
		ControlOutputs: []string{"onComplete"},
	}, func(e *ExecContext) ExecResult {
		*seen = append(*seen, e.ServerID)
		return ExecResult{Port: "onComplete"}
	}))
}

// probeGraph is one trigger wired to one server probe.
func probeGraph(id, serverID string) models.Graph {
	return models.Graph{
		ID:       id,
		ServerID: serverID,
		Enabled:  true,
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "a1", Type: "test.serverProbe"},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "a1", TargetPort: "trigger"},
		},
	}
}

// newScopedScheduler builds a scheduler whose ConfigService names activeID as
// the selected server, so a test can prove a run ignores it.
func newScopedScheduler(t *testing.T, activeID string, configIDs ...string) *SchedulerService {
	t.Helper()
	dataDir := t.TempDir()
	cfgSvc := &ConfigService{}
	cfgSvc.SetDataDir(dataDir)
	for _, id := range configIDs {
		if err := cfgSvc.SaveServerConfig(models.ServerConfig{ID: id, Name: id}); err != nil {
			t.Fatal(err)
		}
	}
	if activeID != "" {
		if err := cfgSvc.SetActiveServerID(activeID); err != nil {
			t.Fatal(err)
		}
	}

	s := &SchedulerService{
		running:   make(map[string]bool),
		lastFired: make(map[string]time.Time),
		stopTime:  make(chan struct{}),
		dataDir:   dataDir,
	}
	s.bus = NewEventBus()
	s.deps = serviceDeps{bus: s.bus, config: cfgSvc}
	s.registry = NewBlockRegistry()
	registerBuiltins(s.registry)
	registerDataBuiltins(s.registry)
	return s
}

func TestRunGraphActsOnTheGraphsServer(t *testing.T) {
	// B is selected in the sidebar. The graph was authored against A.
	s := newScopedScheduler(t, "b", "a", "b")
	var seen []string
	registerServerProbe(s.registry, &seen)

	rec := s.runGraph(probeGraph("g1", "a"), "t1", "manual", seed("t1"))

	if rec.Status != "success" {
		t.Fatalf("status = %q, want success (error: %s)", rec.Status, rec.Error)
	}
	if len(seen) != 1 || seen[0] != "a" {
		t.Errorf("the run acted on %v, want [a]: the sidebar must not re-point a schedule", seen)
	}
}

// A graph the migration could not assign keeps the behaviour it has always had.
func TestRunGraphWithNoOwnerFallsBackToTheActiveServer(t *testing.T) {
	s := newScopedScheduler(t, "b", "a", "b")
	var seen []string
	registerServerProbe(s.registry, &seen)

	rec := s.runGraph(probeGraph("g1", ""), "t1", "manual", seed("t1"))

	if rec.Status != "success" {
		t.Fatalf("status = %q, want success (error: %s)", rec.Status, rec.Error)
	}
	if len(seen) != 1 || seen[0] != "b" {
		t.Errorf("the run acted on %v, want [b]: an unassigned graph stays ambient", seen)
	}
}

// The attribute scope and every ExecContext in a run must name one server. They
// used to be independent reads of the active server, agreeing only by luck of
// timing; an @attribute that read one server while the action hit another is a
// condition that guards the wrong thing.
func TestRunGraphResolvesAttributesAgainstTheSameServer(t *testing.T) {
	s := newScopedScheduler(t, "b", "a", "b")

	var probeServer, attrServer string
	must(s.registry.RegisterBlock(models.BlockDef{
		ID:             "test.scopeProbe",
		Category:       "action",
		ControlInputs:  []string{"trigger"},
		ControlOutputs: []string{"onComplete"},
	}, func(e *ExecContext) ExecResult {
		probeServer = e.ServerID
		attrServer = e.Attrs.ServerID()
		return ExecResult{Port: "onComplete"}
	}))

	g := probeGraph("g1", "a")
	g.Nodes[1].Type = "test.scopeProbe"

	if rec := s.runGraph(g, "t1", "manual", seed("t1")); rec.Status != "success" {
		t.Fatalf("status = %q, want success (error: %s)", rec.Status, rec.Error)
	}
	if probeServer != "a" || attrServer != "a" {
		t.Errorf("block server = %q, attribute server = %q; both must be the graph's", probeServer, attrServer)
	}
}

// A dry run previews the graph's server too, or the spreadsheet shows values
// read off a server the graph will never touch.
func TestPreviewNodeActsOnTheGraphsServer(t *testing.T) {
	s := newScopedScheduler(t, "b", "a", "b")

	var seen string
	must(s.registry.RegisterBlock(models.BlockDef{
		ID:          "test.pureProbe",
		Category:    "data",
		DataOutputs: []models.DataPort{{ID: "out", Type: "string"}},
	}, func(e *ExecContext) ExecResult {
		seen = e.ServerID
		e.SetOutput("out", e.ServerID)
		return ExecResult{}
	}))

	g := models.Graph{
		ID:       "g1",
		ServerID: "a",
		Nodes:    []models.Node{{ID: "d1", Type: "test.pureProbe"}},
	}
	if _, err := s.PreviewNode(g, "d1"); err != nil {
		t.Fatalf("PreviewNode: %v", err)
	}
	if seen != "a" {
		t.Errorf("preview acted on %q, want a", seen)
	}
}
