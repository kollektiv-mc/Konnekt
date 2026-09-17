package services

import (
	"strings"
	"sync"
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

// ─── An event fires only the graphs that answer to its server ──────────────

// awaitRuns waits briefly for the goroutines the fire* paths launch and returns
// the graph ids that ran. The trigger paths are fire-and-forget by design, so a
// test has to give them a moment rather than a channel.
func awaitRuns(t *testing.T, seen *[]string, mu *sync.Mutex, want int) []string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(*seen)
		mu.Unlock()
		if n >= want {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	// A moment past the target, so an extra run that should not have happened
	// has a chance to show up and fail the assertion.
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	return append([]string{}, *seen...)
}

// registerRunRecorder records the graph each run belongs to, via the server the
// run was handed, which is what the filter decides.
func registerRunRecorder(s *SchedulerService, seen *[]string, mu *sync.Mutex) {
	must(s.registry.RegisterBlock(models.BlockDef{
		ID:             "test.runRecorder",
		Category:       "action",
		ControlInputs:  []string{"trigger"},
		ControlOutputs: []string{"onComplete"},
	}, func(e *ExecContext) ExecResult {
		mu.Lock()
		*seen = append(*seen, e.GetString("graphId"))
		mu.Unlock()
		return ExecResult{Port: "onComplete"}
	}))
}

// playerGraph is a player-joined trigger wired to the run recorder.
func playerGraph(id, serverID string) models.Graph {
	g := probeGraph(id, serverID)
	g.Nodes[1] = models.Node{
		ID:     "a1",
		Type:   "test.runRecorder",
		Config: map[string]interface{}{"graphId": id},
	}
	return g
}

func TestPlayerEventFiresOnlyThatServersGraphs(t *testing.T) {
	s := newScopedScheduler(t, "a", "a", "b")
	var seen []string
	var mu sync.Mutex
	registerRunRecorder(s, &seen, &mu)
	s.graphs = []models.Graph{playerGraph("onA", "a"), playerGraph("onB", "b")}

	s.fireTypedEventTriggers("b", "trigger.player", "Joined",
		map[string]interface{}{}, "event:player:joined")

	if got := awaitRuns(t, &seen, &mu, 1); len(got) != 1 || got[0] != "onB" {
		t.Errorf("B's player event ran %v, want [onB] only", got)
	}
}

func TestBackupEventFiresOnlyThatServersGraphs(t *testing.T) {
	s := newScopedScheduler(t, "a", "a", "b")
	var seen []string
	var mu sync.Mutex
	registerRunRecorder(s, &seen, &mu)

	onA, onB := playerGraph("onA", "a"), playerGraph("onB", "b")
	onA.Nodes[0] = models.Node{ID: "t1", Type: "trigger.backup"}
	onB.Nodes[0] = models.Node{ID: "t1", Type: "trigger.backup"}
	s.graphs = []models.Graph{onA, onB}

	s.fireRoutedEventTriggers("a", "trigger.backup",
		map[string]interface{}{"_route": "onComplete"}, "event:backup:completed")

	if got := awaitRuns(t, &seen, &mu, 1); len(got) != 1 || got[0] != "onA" {
		t.Errorf("A's backup event ran %v, want [onA] only", got)
	}
}

func TestTPSEventFiresOnlyThatServersGraphs(t *testing.T) {
	s := newScopedScheduler(t, "a", "a", "b")
	var seen []string
	var mu sync.Mutex
	registerRunRecorder(s, &seen, &mu)

	onA, onB := playerGraph("onA", "a"), playerGraph("onB", "b")
	onA.Nodes[0] = models.Node{ID: "t1", Type: "trigger.tpsThreshold"}
	onB.Nodes[0] = models.Node{ID: "t1", Type: "trigger.tpsThreshold"}
	s.graphs = []models.Graph{onA, onB}

	s.fireTPSTriggers("b", models.StatsSnapshot{TPS: 2})

	if got := awaitRuns(t, &seen, &mu, 1); len(got) != 1 || got[0] != "onB" {
		t.Errorf("B's low-TPS snapshot ran %v, want [onB] only", got)
	}
}

// A disabled graph is still skipped, so the new condition did not replace the
// old one by sitting in front of it.
func TestServerFilterDoesNotResurrectDisabledGraphs(t *testing.T) {
	s := newScopedScheduler(t, "a", "a")
	var seen []string
	var mu sync.Mutex
	registerRunRecorder(s, &seen, &mu)

	off := playerGraph("off", "a")
	off.Enabled = false
	s.graphs = []models.Graph{off}

	s.fireTypedEventTriggers("a", "trigger.player", "Joined",
		map[string]interface{}{}, "event:player:joined")

	if got := awaitRuns(t, &seen, &mu, 0); len(got) != 0 {
		t.Errorf("a disabled graph ran: %v", got)
	}
}

// The two cases where filtering would silently stop a schedule instead of
// re-pointing one, which is the worse fault of the two.
func TestUnknownServerNeverSilencesAGraph(t *testing.T) {
	t.Run("an event with no server id fires everything", func(t *testing.T) {
		s := newScopedScheduler(t, "a", "a", "b")
		var seen []string
		var mu sync.Mutex
		registerRunRecorder(s, &seen, &mu)
		s.graphs = []models.Graph{playerGraph("onA", "a"), playerGraph("onB", "b")}

		s.fireTypedEventTriggers("", "trigger.player", "Joined",
			map[string]interface{}{}, "event:player:joined")

		if got := awaitRuns(t, &seen, &mu, 2); len(got) != 2 {
			t.Errorf("an unattributed event ran %v, want both graphs", got)
		}
	})

	t.Run("a graph with no resolvable owner answers to any server", func(t *testing.T) {
		// No configs and no active server: the migration had nothing to assign.
		s := newScopedScheduler(t, "")
		var seen []string
		var mu sync.Mutex
		registerRunRecorder(s, &seen, &mu)
		s.graphs = []models.Graph{playerGraph("ambient", "")}

		s.fireTypedEventTriggers("whatever", "trigger.player", "Joined",
			map[string]interface{}{}, "event:player:joined")

		if got := awaitRuns(t, &seen, &mu, 1); len(got) != 1 {
			t.Errorf("an unassignable graph ran %v, want it still firing", got)
		}
	})
}

// Time triggers have no event and so no server to filter on: a nightly backup
// on a server nobody has selected is still due.
func TestTimeTriggersFireEveryServersGraphs(t *testing.T) {
	s := newScopedScheduler(t, "a", "a", "b")
	var seen []string
	var mu sync.Mutex
	registerRunRecorder(s, &seen, &mu)

	onA, onB := playerGraph("onA", "a"), playerGraph("onB", "b")
	cron := map[string]interface{}{"cron": "* * * * *"}
	onA.Nodes[0] = models.Node{ID: "t1", Type: "trigger.cron", Config: cron}
	onB.Nodes[0] = models.Node{ID: "t1", Type: "trigger.cron", Config: cron}
	s.graphs = []models.Graph{onA, onB}

	s.evaluateTimeTriggers(time.Now())

	if got := awaitRuns(t, &seen, &mu, 2); len(got) != 2 {
		t.Errorf("the minute ticker ran %v, want both servers' graphs", got)
	}
}

// ─── The tile sees, and touches, only its own server's graphs ──────────────

// twoServerScheduler holds one graph per server plus one the migration could
// not assign, which is the set every scoping rule has to sort correctly.
func twoServerScheduler(t *testing.T) *SchedulerService {
	t.Helper()
	s := newScopedScheduler(t, "a", "a", "b")
	s.graphs = []models.Graph{
		playerGraph("onA", "a"),
		playerGraph("onB", "b"),
		playerGraph("ambient", ""),
	}
	return s
}

func graphIDs(graphs []models.Graph) []string {
	ids := make([]string, 0, len(graphs))
	for _, g := range graphs {
		ids = append(ids, g.ID)
	}
	return ids
}

func TestGetGraphsListsOneServersGraphs(t *testing.T) {
	s := twoServerScheduler(t)

	// A is the active server, so the unassigned graph answers to it: that is
	// the same rule the triggers fire by, and the tile must agree with them.
	got, err := s.GetGraphs("a")
	if err != nil {
		t.Fatal(err)
	}
	if ids := graphIDs(got); strings.Join(ids, ",") != "onA,ambient" {
		t.Errorf("A's graphs = %v, want onA and the unassigned one", ids)
	}

	got, err = s.GetGraphs("b")
	if err != nil {
		t.Fatal(err)
	}
	if ids := graphIDs(got); strings.Join(ids, ",") != "onB" {
		t.Errorf("B's graphs = %v, want onB only", ids)
	}
}

func TestSaveGraphStampsTheCallersServer(t *testing.T) {
	s := twoServerScheduler(t)

	// A graph arriving with somebody else's id does not keep it: the caller is
	// the tile the user is looking at.
	saved, err := s.SaveGraph("b", models.Graph{ID: "new", ServerID: "a", Name: "n"})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ServerID != "b" {
		t.Errorf("saved.ServerID = %q, want b", saved.ServerID)
	}
}

func TestImportStampsTheCallersServer(t *testing.T) {
	s := twoServerScheduler(t)

	// An exported graph is a shape to reuse, not an assignment to carry.
	g, err := s.ImportGraphJSON("b", `{"id":"imported","name":"n","serverId":"a"}`)
	if err != nil {
		t.Fatal(err)
	}
	if g.ServerID != "b" {
		t.Errorf("imported graph's server = %q, want b", g.ServerID)
	}
}

func TestMutatorsRefuseAnotherServersGraph(t *testing.T) {
	t.Run("delete", func(t *testing.T) {
		s := twoServerScheduler(t)
		if err := s.DeleteGraph("b", "onA"); err != nil {
			t.Fatal(err)
		}
		if ids := graphIDs(s.graphs); len(ids) != 3 {
			t.Errorf("graphs = %v, want A's graph untouched by B", ids)
		}
	})

	t.Run("enable", func(t *testing.T) {
		s := twoServerScheduler(t)
		s.graphs[0].Enabled = false
		if err := s.SetGraphEnabled("b", "onA", true); err != nil {
			t.Fatal(err)
		}
		if s.graphs[0].Enabled {
			t.Error("B enabled A's graph")
		}
	})

	t.Run("run now", func(t *testing.T) {
		s := twoServerScheduler(t)
		if _, err := s.RunGraphNow("b", "onA"); err == nil {
			t.Error("B ran A's graph")
		}
	})
}

func TestGetRunHistoryIsScopedThroughTheGraph(t *testing.T) {
	s := twoServerScheduler(t)
	s.history = []models.RunRecord{
		{ID: "r1", GraphID: "onA"},
		{ID: "r2", GraphID: "onB"},
		{ID: "r3", GraphID: "ambient"},
		{ID: "r4", GraphID: "deleted"},
	}

	got, err := s.GetRunHistory("a")
	if err != nil {
		t.Fatal(err)
	}
	// Newest first, A's graphs only, and the record whose graph is gone has no
	// server to be filed under.
	ids := make([]string, 0, len(got))
	for _, r := range got {
		ids = append(ids, r.ID)
	}
	if strings.Join(ids, ",") != "r3,r1" {
		t.Errorf("A's history = %v, want r3 then r1", ids)
	}
}
