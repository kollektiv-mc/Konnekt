package services

import (
	"errors"
	"strings"
	"sync"
	"testing"

	"konnekt/backend/models"
)

// How a run that is over is told: one run-finished event, a failed one with its
// reason, and a failed one also as one red line in the server's console.

func newReportingScheduler(t *testing.T) (*SchedulerService, *[]map[string]interface{}) {
	t.Helper()
	s := newTestScheduler(t)
	s.deps.server = NewServerService()
	var mu sync.Mutex
	var finished []map[string]interface{}
	s.bus.Tap(func(event string, data any) {
		if event != EventScheduleRunFinished {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		finished = append(finished, data.(map[string]interface{}))
	})
	return s, &finished
}

func failedLines(s *SchedulerService, serverID string) []string {
	var lines []string
	for _, l := range s.deps.server.GetConsoleHistory(serverID) {
		if l.Outcome == outcomeFailed {
			lines = append(lines, l.Line)
		}
	}
	return lines
}

func commandGraph(command string) models.Graph {
	return models.Graph{
		ID: "g1", Name: "Nightly", ServerID: "alpha",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "cmd1", Type: "action.command", Config: map[string]interface{}{"command": command}},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "cmd1", TargetPort: "trigger"},
		},
	}
}

func TestFailedRunReachesTheEventAndTheConsole(t *testing.T) {
	s, finished := newReportingScheduler(t)
	rec := s.runGraph(commandGraph(""), "t1", "time:cron", seed("t1"))
	if rec.Status != "failed" || rec.Error == "" {
		t.Fatalf("run = %+v, want failed with a reason", rec)
	}
	if len(*finished) != 1 {
		t.Fatalf("%d run-finished events, want 1", len(*finished))
	}
	ev := (*finished)[0]
	if ev["status"] != "failed" || ev["error"] != rec.Error || ev["graphName"] != "Nightly" || ev["serverID"] != "alpha" {
		t.Errorf("event = %v", ev)
	}
	want := `Scheduled run "Nightly" failed: ` + rec.Error
	if got := failedLines(s, "alpha"); len(got) != 1 || got[0] != want {
		t.Errorf("console = %q, want [%q]", got, want)
	}
}

func TestRunThatWorkedLeavesTheConsoleAlone(t *testing.T) {
	s, finished := newReportingScheduler(t)
	var visited []string
	registerTestMarker(s.registry, &visited)
	g := commandGraph("")
	g.Nodes[1] = models.Node{ID: "cmd1", Type: "test.marker"}
	if rec := s.runGraph(g, "t1", "manual", seed("t1")); rec.Status != "success" {
		t.Fatalf("status = %q", rec.Status)
	}
	if len(*finished) != 1 {
		t.Fatalf("%d run-finished events, want 1", len(*finished))
	}
	if _, ok := (*finished)[0]["error"]; ok {
		t.Errorf("a run that worked carries an error: %v", (*finished)[0])
	}
	if got := failedLines(s, "alpha"); len(got) != 0 {
		t.Errorf("console = %q, want nothing failed", got)
	}
}

// A block that already narrated its failure is not told a second time.
func TestNarratedFailureIsWrittenOnce(t *testing.T) {
	s, _ := newReportingScheduler(t)
	must(s.registry.RegisterBlock(models.BlockDef{
		ID: "test.narrates", Category: "action",
		ControlInputs: []string{"trigger"}, ControlOutputs: []string{"onComplete"},
	}, func(e *ExecContext) ExecResult {
		e.Server().NarrateFailed(e.ServerID, "Upload failed: bucket gone")
		return ExecResult{Port: "onFailed", Err: errors.New("bucket gone"), Narrated: true}
	}))
	g := commandGraph("")
	g.Nodes[1] = models.Node{ID: "cmd1", Type: "test.narrates"}
	s.runGraph(g, "t1", "manual", seed("t1"))
	if got := failedLines(s, "alpha"); len(got) != 1 || got[0] != "Upload failed: bucket gone" {
		t.Errorf("console = %q, want only the block's line", got)
	}
}

// A run refused before any node starts has no run-started, and is still told.
func TestRefusedRunIsStillTold(t *testing.T) {
	s, finished := newReportingScheduler(t)
	g := models.Graph{
		ID: "g4", ServerID: "alpha",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "c1", Type: "data.constant", Config: map[string]interface{}{"type": "String", "value": "hello"}},
			{ID: "m1", Type: "data.mathOp", Config: map[string]interface{}{"op": "add"}},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "data", Source: "c1", SourcePort: "value", Target: "m1", TargetPort: "a"},
		},
	}
	s.runGraph(g, "t1", "manual", seed("t1"))
	if len(*finished) != 1 || (*finished)[0]["status"] != "failed" {
		t.Fatalf("events = %v, want one failed", *finished)
	}
	got := failedLines(s, "alpha")
	if len(got) != 1 || !strings.HasPrefix(got[0], `Scheduled run "Untitled" failed: data type validation failed`) {
		t.Errorf("console = %q", got)
	}
}
