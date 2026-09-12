package services

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"konnekt/backend/models"
)

// newTestScheduler builds a minimal SchedulerService with no Wails runtime,
// no ConfigService, and the native block registry — enough to drive runGraph
// headlessly. EventBus.Emit is nil-context-safe, so bus.Emit calls are no-ops
// beyond in-process Subscribe fan-out (unused here).
func newTestScheduler(t *testing.T) *SchedulerService {
	t.Helper()
	s := &SchedulerService{
		running:   make(map[string]bool),
		lastFired: make(map[string]time.Time),
		stopTime:  make(chan struct{}),
	}
	s.bus = NewEventBus()
	s.deps = serviceDeps{bus: s.bus}
	s.registry = NewBlockRegistry()
	registerBuiltins(s.registry)
	registerDataBuiltins(s.registry)
	return s
}

// registerTestMarker registers a "test.marker" control-flow passthrough block
// whose executor appends its "markerId" config value to *visited — used to
// assert control-flow execution order/branching without depending on a real
// action's side effects.
func registerTestMarker(reg *BlockRegistry, visited *[]string) {
	must(reg.RegisterBlock(models.BlockDef{
		ID:             "test.marker",
		Category:       "action",
		ControlInputs:  []string{"trigger"},
		ControlOutputs: []string{"onComplete"},
	}, func(e *ExecContext) ExecResult {
		*visited = append(*visited, e.GetString("markerId"))
		return ExecResult{Port: "onComplete"}
	}))
}

// registerTestCapture registers a "test.capture" block whose executor stores
// its resolved "value" data input into *captured — used to assert a value
// actually flowed through data edges (seed -> pure-data pull-eval -> overlay).
func registerTestCapture(reg *BlockRegistry, captured *float64) {
	must(reg.RegisterBlock(models.BlockDef{
		ID:             "test.capture",
		Category:       "action",
		ControlInputs:  []string{"trigger"},
		ControlOutputs: []string{"onComplete"},
		DataInputs:     []models.DataPort{{ID: "value", Type: "number"}},
	}, func(e *ExecContext) ExecResult {
		*captured = e.GetFloat("value", -9999)
		return ExecResult{Port: "onComplete"}
	}))
}

func seed(entryNodeID string) map[string]map[string]interface{} {
	return map[string]map[string]interface{}{entryNodeID: {}, "trigger": {}}
}

func TestRunGraph_ControlFlowOrder(t *testing.T) {
	s := newTestScheduler(t)
	var visited []string
	registerTestMarker(s.registry, &visited)

	g := models.Graph{
		ID: "g1",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "a1", Type: "test.marker", Config: map[string]interface{}{"markerId": "a1"}},
			{ID: "a2", Type: "test.marker", Config: map[string]interface{}{"markerId": "a2"}},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "a1", TargetPort: "trigger"},
			{ID: "e2", Kind: "control", Source: "a1", SourcePort: "onComplete", Target: "a2", TargetPort: "trigger"},
		},
	}

	rec := s.runGraph(g, "t1", "manual", seed("t1"))

	if rec.Status != "success" {
		t.Fatalf("status = %q, want success (error: %s)", rec.Status, rec.Error)
	}
	if len(rec.Nodes) != 3 {
		t.Fatalf("executed %d nodes, want 3", len(rec.Nodes))
	}
	wantOrder := []string{"t1", "a1", "a2"}
	for i, n := range rec.Nodes {
		if n.NodeID != wantOrder[i] {
			t.Errorf("node %d = %q, want %q", i, n.NodeID, wantOrder[i])
		}
		if n.Status != "success" {
			t.Errorf("node %q status = %q, want success", n.NodeID, n.Status)
		}
	}
	if len(visited) != 2 || visited[0] != "a1" || visited[1] != "a2" {
		t.Errorf("visited = %v, want [a1 a2]", visited)
	}
}

func TestRunGraph_DataFlowPullEvalAndOverlay(t *testing.T) {
	s := newTestScheduler(t)
	var captured float64
	registerTestCapture(s.registry, &captured)

	g := models.Graph{
		ID: "g2",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "c1", Type: "data.constant", Config: map[string]interface{}{"type": "Integer", "value": "5"}},
			// "a" is wired from c1 (overlay must win over this literal 0 default).
			{ID: "m1", Type: "data.mathOp", Config: map[string]interface{}{"op": "mul", "a": float64(0), "b": float64(3)}},
			{ID: "cap", Type: "test.capture"},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "cap", TargetPort: "trigger"},
			{ID: "e2", Kind: "data", Source: "c1", SourcePort: "value", Target: "m1", TargetPort: "a"},
			{ID: "e3", Kind: "data", Source: "m1", SourcePort: "result", Target: "cap", TargetPort: "value"},
		},
	}

	rec := s.runGraph(g, "t1", "manual", seed("t1"))

	if rec.Status != "success" {
		t.Fatalf("status = %q, want success (error: %s)", rec.Status, rec.Error)
	}
	// cap has no control edge from m1/c1 (both pure-data, no control ports) —
	// its only control predecessor is t1. The value must arrive purely via
	// pullDataDependencies' recursive pull-eval: cap pulls m1, m1 pulls c1.
	if captured != 15 {
		t.Errorf("captured = %v, want 15 (constant(5) * config-b(3) via mathOp, wired through data edges)", captured)
	}
}

func TestRunGraph_OnFailedBranching(t *testing.T) {
	s := newTestScheduler(t)
	var visited []string
	registerTestMarker(s.registry, &visited)

	g := models.Graph{
		ID: "g3",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "cmd1", Type: "action.command"}, // no command/preset configured -> always fails
			{ID: "ok", Type: "test.marker", Config: map[string]interface{}{"markerId": "ok-branch"}},
			{ID: "fail", Type: "test.marker", Config: map[string]interface{}{"markerId": "fail-branch"}},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "cmd1", TargetPort: "trigger"},
			{ID: "e2", Kind: "control", Source: "cmd1", SourcePort: "onComplete", Target: "ok", TargetPort: "trigger"},
			{ID: "e3", Kind: "control", Source: "cmd1", SourcePort: "onFailed", Target: "fail", TargetPort: "trigger"},
		},
	}

	rec := s.runGraph(g, "t1", "manual", seed("t1"))

	if rec.Status != "failed" {
		t.Fatalf("status = %q, want failed (cmd1 has no command configured)", rec.Status)
	}
	if len(visited) != 1 || visited[0] != "fail-branch" {
		t.Errorf("visited = %v, want [fail-branch] only — onComplete branch must not run", visited)
	}
	found := false
	for _, n := range rec.Nodes {
		if n.NodeID == "cmd1" {
			found = true
			if n.Status != "failed" || n.FiredPort != "onFailed" {
				t.Errorf("cmd1 record = %+v, want status=failed firedPort=onFailed", n)
			}
		}
	}
	if !found {
		t.Error("cmd1 not recorded in run")
	}
}

func TestRunGraph_DataTypeValidationShortCircuits(t *testing.T) {
	s := newTestScheduler(t)

	g := models.Graph{
		ID: "g4",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "c1", Type: "data.constant", Config: map[string]interface{}{"type": "String", "value": "hello"}},
			{ID: "m1", Type: "data.mathOp", Config: map[string]interface{}{"op": "add"}},
		},
		Edges: []models.Edge{
			// String constant wired into mathOp's numeric input "a" — incompatible.
			{ID: "e1", Kind: "data", Source: "c1", SourcePort: "value", Target: "m1", TargetPort: "a"},
		},
	}

	rec := s.runGraph(g, "t1", "manual", seed("t1"))

	if rec.Status != "failed" {
		t.Fatalf("status = %q, want failed", rec.Status)
	}
	if !strings.Contains(rec.Error, "data type validation failed") {
		t.Errorf("error = %q, want mention of data type validation", rec.Error)
	}
	if len(rec.Nodes) != 0 {
		t.Errorf("executed %d nodes, want 0 (must short-circuit before any node runs)", len(rec.Nodes))
	}
}

func TestRunGraph_ControlCycleHitsNodeCap(t *testing.T) {
	s := newTestScheduler(t)
	var visited []string
	registerTestMarker(s.registry, &visited)

	g := models.Graph{
		ID: "g5",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "a", Type: "test.marker", Config: map[string]interface{}{"markerId": "a"}},
			{ID: "b", Type: "test.marker", Config: map[string]interface{}{"markerId": "b"}},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "a", TargetPort: "trigger"},
			{ID: "e2", Kind: "control", Source: "a", SourcePort: "onComplete", Target: "b", TargetPort: "trigger"},
			{ID: "e3", Kind: "control", Source: "b", SourcePort: "onComplete", Target: "a", TargetPort: "trigger"},
		},
	}

	rec := s.runGraph(g, "t1", "manual", seed("t1"))

	if rec.Status != "failed" {
		t.Fatalf("status = %q, want failed", rec.Status)
	}
	if !strings.Contains(rec.Error, "possible cycle") {
		t.Errorf("error = %q, want mention of possible cycle", rec.Error)
	}
	if len(rec.Nodes) != maxNodesPerRun {
		t.Errorf("executed %d nodes, want exactly maxNodesPerRun=%d", len(rec.Nodes), maxNodesPerRun)
	}
}

func TestRunGraph_ConcurrencyGuardSkipsSecondRun(t *testing.T) {
	s := newTestScheduler(t)
	s.running["g6"] = true // simulate an already-active run for this graph

	g := models.Graph{ID: "g6", Nodes: []models.Node{{ID: "t1", Type: "trigger.player"}}}
	rec := s.runGraph(g, "t1", "manual", seed("t1"))

	if rec.Status != "skipped" {
		t.Errorf("status = %q, want skipped", rec.Status)
	}
}

// ── ExecContext getters ────────────────────────────────────────────────────

func TestExecContextGetters(t *testing.T) {
	ec := &ExecContext{Config: map[string]interface{}{
		"n":   float64(3.5),
		"s":   "hello",
		"bad": "not-a-number",
	}}
	if got := ec.GetFloat("n", 0); got != 3.5 {
		t.Errorf("GetFloat(n) = %v, want 3.5", got)
	}
	if got := ec.GetFloat("missing", 9); got != 9 {
		t.Errorf("GetFloat(missing) = %v, want default 9", got)
	}
	// Documented current behavior: GetFloat only type-switches on
	// float64/int/int64, so a string value (even one that isn't a valid
	// number) silently falls through to the default rather than erroring.
	if got := ec.GetFloat("bad", 9); got != 9 {
		t.Errorf("GetFloat(bad) = %v, want default 9 (string values fall through)", got)
	}
	if got := ec.GetString("s"); got != "hello" {
		t.Errorf("GetString(s) = %q, want hello", got)
	}
	if got := ec.GetString("missing"); got != "" {
		t.Errorf("GetString(missing) = %q, want empty", got)
	}
}

// ── Block executors ─────────────────────────────────────────────────────────

func TestExecConstant(t *testing.T) {
	cases := []struct {
		name    string
		typ     string
		value   string
		want    interface{}
		wantErr bool
	}{
		{"string", "String", "hello", "hello", false},
		{"float", "Float", "3.5", 3.5, false},
		{"integer", "Integer", "42", float64(42), false},
		{"boolean true", "Boolean", "true", float64(1), false},
		{"boolean false", "Boolean", "false", float64(0), false},
		{"float parse error", "Float", "abc", nil, true},
		{"integer parse error", "Integer", "abc", nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ec := &ExecContext{
				Config:  map[string]interface{}{"type": c.typ, "value": c.value},
				dataOut: map[string]interface{}{},
			}
			res := execConstant(ec)
			if c.wantErr {
				if res.Err == nil {
					t.Fatal("expected error, got none")
				}
				return
			}
			if res.Err != nil {
				t.Fatalf("unexpected error: %v", res.Err)
			}
			if ec.dataOut["value"] != c.want {
				t.Errorf("value = %v (%T), want %v (%T)", ec.dataOut["value"], ec.dataOut["value"], c.want, c.want)
			}
		})
	}
}

func TestExecMathOp(t *testing.T) {
	cases := []struct {
		name    string
		a, b    float64
		op      string
		want    float64
		wantErr bool
	}{
		{"add", 2, 3, "add", 5, false},
		{"sub", 5, 3, "sub", 2, false},
		{"mul", 4, 3, "mul", 12, false},
		{"div", 9, 3, "div", 3, false},
		{"div by zero", 9, 0, "div", 0, true},
		{"mod", 10, 3, "mod", 1, false},
		{"mod by zero", 10, 0, "mod", 0, true},
		{"diff positive result", 3, 10, "diff", 7, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ec := &ExecContext{
				Config:  map[string]interface{}{"a": c.a, "b": c.b, "op": c.op},
				dataOut: map[string]interface{}{},
			}
			res := execMathOp(ec)
			if c.wantErr {
				if res.Err == nil {
					t.Fatal("expected error, got none")
				}
				return
			}
			if res.Err != nil {
				t.Fatalf("unexpected error: %v", res.Err)
			}
			if ec.dataOut["result"] != c.want {
				t.Errorf("result = %v, want %v", ec.dataOut["result"], c.want)
			}
		})
	}
}

func TestExecCondition(t *testing.T) {
	cases := []struct {
		name            string
		left, right, op string
		wantPort        string
	}{
		{"eq true", "5", "5", "eq", "onTrue"},
		{"eq false", "5", "6", "eq", "onFalse"},
		{"ne true", "5", "6", "ne", "onTrue"},
		{"contains true", "hello world", "world", "contains", "onTrue"},
		{"contains false", "hello world", "xyz", "contains", "onFalse"},
		{
			// Documented current quirk: gt/lt compare left/right as plain
			// strings (lexicographic), not numerically. "10" < "9" here
			// because '1' < '9' in ASCII, even though 10 > 9 numerically.
			name: "gt is lexicographic not numeric", left: "10", right: "9", op: "gt", wantPort: "onFalse",
		},
		{"gt lexicographic true case", "9", "10", "gt", "onTrue"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ec := &ExecContext{Config: map[string]interface{}{
				"left": c.left, "right": c.right, "op": c.op,
			}}
			res := execCondition(ec)
			if res.Port != c.wantPort {
				t.Errorf("port = %q, want %q", res.Port, c.wantPort)
			}
		})
	}
}

func TestExecDelay(t *testing.T) {
	t.Run("zero seconds completes immediately", func(t *testing.T) {
		ec := &ExecContext{Ctx: context.Background(), Config: map[string]interface{}{"seconds": float64(0)}}
		res := execDelay(ec)
		if res.Port != "onComplete" || res.Err != nil {
			t.Errorf("got %+v, want onComplete/nil", res)
		}
	})
	t.Run("cancelled context fails", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		ec := &ExecContext{Ctx: ctx, Config: map[string]interface{}{"seconds": float64(5)}}
		res := execDelay(ec)
		if res.Err == nil {
			t.Error("expected error from cancelled context, got nil")
		}
	})
}

func TestExecRandomNumber(t *testing.T) {
	t.Run("min equals max is deterministic", func(t *testing.T) {
		ec := &ExecContext{Config: map[string]interface{}{"min": float64(5), "max": float64(5)}, dataOut: map[string]interface{}{}}
		res := execRandomNumber(ec)
		if res.Err != nil {
			t.Fatalf("unexpected error: %v", res.Err)
		}
		if ec.dataOut["value"] != float64(5) {
			t.Errorf("value = %v, want 5", ec.dataOut["value"])
		}
	})
	t.Run("max less than min is corrected to min", func(t *testing.T) {
		ec := &ExecContext{Config: map[string]interface{}{"min": float64(10), "max": float64(5)}, dataOut: map[string]interface{}{}}
		res := execRandomNumber(ec)
		if res.Err != nil {
			t.Fatalf("unexpected error: %v", res.Err)
		}
		if ec.dataOut["value"] != float64(10) {
			t.Errorf("value = %v, want 10 (max<min corrected to min)", ec.dataOut["value"])
		}
	})
}

// A response body cut off mid-transfer used to be handed to the graph as the
// body, with onComplete: io.ReadAll's error was discarded. It is a failure of
// the request and routes to onFailed, with the status still reported.
func TestExecHTTPSurfacesATruncatedBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Declare more than is sent; net/http closes the connection on the
		// mismatch and the client's ReadAll ends in an unexpected EOF.
		w.Header().Set("Content-Length", "100")
		if _, err := io.WriteString(w, "partial"); err != nil {
			t.Errorf("write: %v", err)
		}
	}))
	defer ts.Close()

	ec := &ExecContext{
		Ctx:     context.Background(),
		Config:  map[string]interface{}{"url": ts.URL, "method": "GET"},
		dataOut: map[string]interface{}{},
	}
	res := execHTTP(ec)
	if res.Port != "onFailed" {
		t.Fatalf("port = %q, want onFailed", res.Port)
	}
	if res.Err == nil || !strings.Contains(res.Err.Error(), "read response") {
		t.Errorf("err = %v, want it to name the read step", res.Err)
	}
	if !errors.Is(res.Err, io.ErrUnexpectedEOF) {
		t.Errorf("err = %v, want it to wrap io.ErrUnexpectedEOF", res.Err)
	}
	if got := ec.dataOut["status"]; got != float64(http.StatusOK) {
		t.Errorf("status output = %v, want %v", got, float64(http.StatusOK))
	}
	if _, set := ec.dataOut["body"]; set {
		t.Error("a truncated body was still published as the body output")
	}
}
