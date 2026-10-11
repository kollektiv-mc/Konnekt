package services

import (
	"context"
	"strings"
	"testing"
	"time"

	"konnekt/backend/models"
)

// shrinkTimeouts swaps the engine's default limits for the duration of a test,
// the way backup tests swap statBackup.
func shrinkTimeouts(t *testing.T, node, run time.Duration) {
	t.Helper()
	origNode, origRun := nodeTimeout, maxRunDuration
	nodeTimeout, maxRunDuration = node, run
	t.Cleanup(func() { nodeTimeout, maxRunDuration = origNode, origRun })
}

// registerTestSlow registers a block that works for `work` unless its context
// ends first, declaring `limit` seconds as its own time limit (0 declares none).
func registerTestSlow(reg *BlockRegistry, id string, limit int, work time.Duration) {
	must(reg.RegisterBlock(models.BlockDef{
		ID:             id,
		Category:       "action",
		ControlInputs:  []string{"trigger"},
		ControlOutputs: []string{"onComplete"},
		TimeoutSeconds: limit,
	}, func(e *ExecContext) ExecResult {
		select {
		case <-time.After(work):
			return ExecResult{Port: "onComplete"}
		case <-e.Ctx.Done():
			return ExecResult{Port: "onFailed", Err: e.Ctx.Err()}
		}
	}))
}

// slowGraph is a trigger wired to one node of the given block type.
func slowGraph(blockType string) models.Graph {
	return models.Graph{
		ID: "slow",
		Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
			{ID: "a1", Type: blockType, Config: map[string]interface{}{}},
		},
		Edges: []models.Edge{
			{ID: "e1", Kind: "control", Source: "t1", SourcePort: "onComplete", Target: "a1", TargetPort: "trigger"},
		},
	}
}

func TestBlockTimeout(t *testing.T) {
	shrinkTimeouts(t, 60*time.Second, 30*time.Minute)
	tests := []struct {
		name string
		secs int
		want time.Duration
	}{
		{"declares nothing", 0, 60 * time.Second},
		{"negative counts as nothing", -5, 60 * time.Second},
		{"declared limit", 3600, time.Hour},
		{"shorter than the default", 10, 10 * time.Second},
		{"overflowing value is clamped", int(^uint(0) >> 1), maxBlockTimeout},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := blockTimeout(models.BlockDef{TimeoutSeconds: tc.secs}); got != tc.want {
				t.Errorf("blockTimeout(%d) = %v, want %v", tc.secs, got, tc.want)
			}
		})
	}
}

func TestRunDuration_GrowsOnlyWithDeclaredLimits(t *testing.T) {
	shrinkTimeouts(t, 60*time.Second, 30*time.Minute)
	s := newTestScheduler(t)
	registerTestSlow(s.registry, "test.plain", 0, 0)
	registerTestSlow(s.registry, "test.hour", 3600, 0)
	registerTestSlow(s.registry, "test.ten-min", 600, 0)

	node := func(id, typ string) models.Node { return models.Node{ID: id, Type: typ} }
	tests := []struct {
		name  string
		nodes []models.Node
		want  time.Duration
	}{
		{"no nodes", nil, 30 * time.Minute},
		{"ordinary blocks only", []models.Node{
			node("t", "trigger.player"), node("a", "test.plain"), node("b", "test.plain"),
		}, 30 * time.Minute},
		{"unknown block type", []models.Node{node("a", "no.such.block")}, 30 * time.Minute},
		{"declared total under the floor", []models.Node{
			node("a", "test.ten-min"), node("b", "test.plain"),
		}, 30 * time.Minute},
		{"one long block", []models.Node{
			node("a", "test.plain"), node("b", "test.hour"),
		}, time.Hour},
		{"limits add up", []models.Node{
			node("a", "test.hour"), node("b", "test.hour"), node("c", "test.ten-min"),
		}, 2*time.Hour + 10*time.Minute},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := s.runDuration(models.Graph{Nodes: tc.nodes}); got != tc.want {
				t.Errorf("runDuration = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestRunGraph_DeclaredLimitOutlivesDefault(t *testing.T) {
	shrinkTimeouts(t, 50*time.Millisecond, 50*time.Millisecond)
	s := newTestScheduler(t)
	// Works for 200ms: past both the shrunk node default and the shrunk run
	// floor, inside the one second it declares.
	registerTestSlow(s.registry, "test.long", 1, 200*time.Millisecond)

	rec := s.runGraph(slowGraph("test.long"), "t1", "manual", seed("t1"))

	if rec.Status != "success" {
		t.Fatalf("status = %q, want success (error: %s)", rec.Status, rec.Error)
	}
}

func TestRunGraph_UndeclaredBlockStillCutAtDefault(t *testing.T) {
	shrinkTimeouts(t, 50*time.Millisecond, time.Hour)
	s := newTestScheduler(t)
	registerTestSlow(s.registry, "test.plain", 0, 5*time.Second)

	start := time.Now()
	rec := s.runGraph(slowGraph("test.plain"), "t1", "manual", seed("t1"))

	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("run took %v, want it cut near the 50ms default", elapsed)
	}
	if rec.Status != "failed" {
		t.Fatalf("status = %q, want failed", rec.Status)
	}
}

func TestRunGraph_TimedOutNodeNamesItsLimit(t *testing.T) {
	t.Run("declared limit", func(t *testing.T) {
		shrinkTimeouts(t, 60*time.Second, 30*time.Minute)
		s := newTestScheduler(t)
		registerTestSlow(s.registry, "test.one-second", 1, time.Minute)

		rec := s.runGraph(slowGraph("test.one-second"), "t1", "manual", seed("t1"))

		if rec.Status != "failed" {
			t.Fatalf("status = %q, want failed", rec.Status)
		}
		for _, got := range []string{rec.Error, rec.Nodes[1].Error} {
			if !strings.Contains(got, "timed out after 1s") {
				t.Errorf("error %q does not name the 1s limit", got)
			}
		}
	})

	t.Run("default limit", func(t *testing.T) {
		shrinkTimeouts(t, 50*time.Millisecond, time.Hour)
		s := newTestScheduler(t)
		registerTestSlow(s.registry, "test.plain", 0, time.Minute)

		rec := s.runGraph(slowGraph("test.plain"), "t1", "manual", seed("t1"))

		if !strings.Contains(rec.Nodes[1].Error, "timed out after 0.05s") {
			t.Errorf("node error %q does not name the default limit", rec.Nodes[1].Error)
		}
	})

	t.Run("run cap expiring first is not blamed on the node", func(t *testing.T) {
		shrinkTimeouts(t, time.Hour, 50*time.Millisecond)
		s := newTestScheduler(t)
		registerTestSlow(s.registry, "test.plain", 0, time.Minute)

		rec := s.runGraph(slowGraph("test.plain"), "t1", "manual", seed("t1"))

		if rec.Status != "failed" || rec.Error != "run exceeded maximum duration" {
			t.Errorf("status = %q, error = %q, want the run cap's own error", rec.Status, rec.Error)
		}
		if strings.Contains(rec.Nodes[1].Error, "timed out after") {
			t.Errorf("node error %q blames the node's limit for the run cap", rec.Nodes[1].Error)
		}
	})
}

func TestRunGraph_RunCapFollowsDeclaredLimits(t *testing.T) {
	shrinkTimeouts(t, time.Hour, 50*time.Millisecond)

	t.Run("graph without declared limits is capped at the floor", func(t *testing.T) {
		s := newTestScheduler(t)
		registerTestSlow(s.registry, "test.plain", 0, 200*time.Millisecond)

		rec := s.runGraph(slowGraph("test.plain"), "t1", "manual", seed("t1"))

		if rec.Status != "failed" || rec.Error != "run exceeded maximum duration" {
			t.Errorf("status = %q, error = %q, want the run cap to stop it", rec.Status, rec.Error)
		}
	})

	t.Run("graph with a declared limit gets the room it declared", func(t *testing.T) {
		s := newTestScheduler(t)
		registerTestSlow(s.registry, "test.long", 1, 200*time.Millisecond)

		rec := s.runGraph(slowGraph("test.long"), "t1", "manual", seed("t1"))

		if rec.Status != "success" {
			t.Errorf("status = %q, want success (error: %s)", rec.Status, rec.Error)
		}
	})
}

func TestExecuteNode_CancelledRunStopsLongBlock(t *testing.T) {
	shrinkTimeouts(t, 60*time.Second, 30*time.Minute)
	s := newTestScheduler(t)
	registerTestSlow(s.registry, "test.day", 86400, 24*time.Hour)

	node := models.Node{ID: "a1", Type: "test.day", Config: map[string]interface{}{}}
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(20*time.Millisecond, cancel)

	start := time.Now()
	res := s.executeNode(ctx, node, nil, map[string]models.Node{"a1": node},
		map[string]map[string]interface{}{}, newAttrScope(s.deps, "", map[string]string{}))

	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("block ran %v after cancel, want it stopped at once", elapsed)
	}
	if res.Err == nil || !strings.Contains(res.Err.Error(), "context canceled") {
		t.Errorf("err = %v, want a cancellation", res.Err)
	}
	if strings.Contains(res.Err.Error(), "timed out after") {
		t.Errorf("err = %v, a cancelled run is not a timeout", res.Err)
	}
}
