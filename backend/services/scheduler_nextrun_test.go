package services

import (
	"testing"
	"time"

	"konnekt/backend/models"
)

func TestNextTimeOfDay(t *testing.T) {
	now := time.Date(2024, 1, 1, 10, 0, 0, 0, time.UTC)

	t.Run("later today", func(t *testing.T) {
		node := models.Node{Config: map[string]interface{}{"time": "11:00"}}
		got := nextTimeOfDay(node, now)
		want := time.Date(2024, 1, 1, 11, 0, 0, 0, time.UTC)
		if !got.Equal(want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("already passed today rolls to tomorrow", func(t *testing.T) {
		node := models.Node{Config: map[string]interface{}{"time": "09:00"}}
		got := nextTimeOfDay(node, now)
		want := time.Date(2024, 1, 2, 9, 0, 0, 0, time.UTC)
		if !got.Equal(want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("malformed time returns zero", func(t *testing.T) {
		node := models.Node{Config: map[string]interface{}{"time": "not-a-time"}}
		if got := nextTimeOfDay(node, now); !got.IsZero() {
			t.Errorf("got %v, want zero time", got)
		}
	})
}

func TestNextCron(t *testing.T) {
	now := time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC) // Mon 09:00

	t.Run("finds next match within window", func(t *testing.T) {
		node := models.Node{Config: map[string]interface{}{"cron": "30 9 * * *"}}
		got := nextCron(node, now)
		want := time.Date(2024, 1, 1, 9, 30, 0, 0, time.UTC)
		if !got.Equal(want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("empty expression returns zero", func(t *testing.T) {
		node := models.Node{Config: map[string]interface{}{"cron": ""}}
		if got := nextCron(node, now); !got.IsZero() {
			t.Errorf("got %v, want zero time", got)
		}
	})
}

func TestNextInterval(t *testing.T) {
	s := newTestScheduler(t)
	now := time.Date(2024, 1, 1, 10, 0, 0, 0, time.UTC)
	g := models.Graph{ID: "g1"}
	node := models.Node{ID: "n1", Config: map[string]interface{}{"intervalMinutes": float64(15)}}

	t.Run("never fired projects from now", func(t *testing.T) {
		got := s.nextInterval(g, node, now)
		want := now.Add(15 * time.Minute)
		if !got.Equal(want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})

	t.Run("seeded lastFired projects from last fire", func(t *testing.T) {
		last := now.Add(-5 * time.Minute)
		s.lastFired[g.ID+":"+node.ID] = last
		got := s.nextInterval(g, node, now)
		want := last.Add(15 * time.Minute)
		if !got.Equal(want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})
}

func TestNextRuns(t *testing.T) {
	s := newTestScheduler(t)
	s.graphs = []models.Graph{
		{ID: "enabled", Enabled: true, Nodes: []models.Node{
			{ID: "n1", Type: "trigger.interval", Config: map[string]interface{}{"intervalMinutes": float64(60)}},
			// A sooner second trigger — NextRuns must pick the minimum.
			{ID: "n2", Type: "trigger.interval", Config: map[string]interface{}{"intervalMinutes": float64(5)}},
		}},
		{ID: "disabled", Enabled: false, Nodes: []models.Node{
			{ID: "n1", Type: "trigger.interval", Config: map[string]interface{}{"intervalMinutes": float64(5)}},
		}},
		{ID: "event-only", Enabled: true, Nodes: []models.Node{
			{ID: "n1", Type: "trigger.player", Config: map[string]interface{}{"type": "Joined"}},
		}},
	}

	before := time.Now()
	runs, err := s.NextRuns()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, ok := runs["disabled"]; ok {
		t.Error("disabled graph should be omitted")
	}
	if _, ok := runs["event-only"]; ok {
		t.Error("graph without a time trigger should be omitted")
	}
	got, ok := runs["enabled"]
	if !ok {
		t.Fatal("enabled graph missing from NextRuns")
	}
	// Never fired, so the 5-minute trigger projects ~5 minutes from now and wins
	// over the 60-minute one.
	wantLo := before.Add(5 * time.Minute).UnixMilli()
	wantHi := time.Now().Add(5 * time.Minute).UnixMilli()
	if got < wantLo || got > wantHi {
		t.Errorf("next run = %d, want the soonest trigger in [%d, %d]", got, wantLo, wantHi)
	}
}

// TestScheduleNextRunsEventName pins the wire name. The Go constant and the
// frontend's EVENTS.SCHEDULE_NEXT_RUNS mirror in lib/constants.ts are hand-kept
// with no codegen, and a mismatch fails silently (no event, no error).
func TestScheduleNextRunsEventName(t *testing.T) {
	if EventScheduleNextRuns != "schedule:next-runs" {
		t.Errorf("EventScheduleNextRuns = %q, want schedule:next-runs", EventScheduleNextRuns)
	}
}

func TestEmitNextRuns(t *testing.T) {
	s := newTestScheduler(t)
	s.graphs = []models.Graph{{ID: "g1", Enabled: true, Nodes: []models.Node{
		{ID: "n1", Type: "trigger.interval", Config: map[string]interface{}{"intervalMinutes": float64(10)}},
	}}}

	got := subscribeNextRuns(t, s)
	s.emitNextRuns()

	runs := awaitNextRuns(t, got)
	if _, ok := runs["g1"]; !ok {
		t.Errorf("payload = %v, want a g1 entry", runs)
	}
}

// TestGraphMutatorsEmitNextRuns covers the three CRUD emit sites. It doubles as
// a deadlock guard: emitNextRuns takes s.mu (and s.cooldownMu via nextInterval),
// so an emit misplaced under either lock hangs here instead of in production.
func TestGraphMutatorsEmitNextRuns(t *testing.T) {
	s := newTestScheduler(t)
	// Without this, writeGraphs joins onto "" and litters scheduler.json into
	// the package directory.
	s.dataDir = t.TempDir()

	got := subscribeNextRuns(t, s)

	saved, err := s.SaveGraph(models.Graph{Name: "g", Enabled: true, Nodes: []models.Node{
		{ID: "n1", Type: "trigger.interval", Config: map[string]interface{}{"intervalMinutes": float64(10)}},
	}})
	if err != nil {
		t.Fatalf("SaveGraph: %v", err)
	}
	if runs := awaitNextRuns(t, got); len(runs) != 1 {
		t.Errorf("after SaveGraph: payload = %v, want one entry", runs)
	}

	if err := s.SetGraphEnabled(saved.ID, false); err != nil {
		t.Fatalf("SetGraphEnabled: %v", err)
	}
	if runs := awaitNextRuns(t, got); len(runs) != 0 {
		t.Errorf("after disabling: payload = %v, want empty", runs)
	}

	if err := s.DeleteGraph(saved.ID); err != nil {
		t.Fatalf("DeleteGraph: %v", err)
	}
	if runs := awaitNextRuns(t, got); len(runs) != 0 {
		t.Errorf("after DeleteGraph: payload = %v, want empty", runs)
	}
}

// subscribeNextRuns buffers EventScheduleNextRuns payloads. EventBus fans out to
// handlers on their own goroutines, so delivery is asynchronous.
func subscribeNextRuns(t *testing.T, s *SchedulerService) chan map[string]int64 {
	t.Helper()
	got := make(chan map[string]int64, 8)
	s.bus.Subscribe(EventScheduleNextRuns, func(data any) {
		runs, ok := data.(map[string]int64)
		if !ok {
			return
		}
		got <- runs
	})
	return got
}

func awaitNextRuns(t *testing.T, got chan map[string]int64) map[string]int64 {
	t.Helper()
	select {
	case runs := <-got:
		return runs
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for schedule:next-runs (emit misplaced under a lock?)")
		return nil
	}
}

func TestFindTriggerNode(t *testing.T) {
	t.Run("no trigger errors", func(t *testing.T) {
		g := models.Graph{ID: "g1", Nodes: []models.Node{{ID: "a1", Type: "action.command"}}}
		if _, err := findTriggerNode(g); err == nil {
			t.Error("expected error for graph with no trigger node")
		}
	})

	t.Run("single trigger returns its id", func(t *testing.T) {
		g := models.Graph{ID: "g2", Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player"},
			{ID: "a1", Type: "action.command"},
		}}
		id, err := findTriggerNode(g)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if id != "t1" {
			t.Errorf("id = %q, want t1", id)
		}
	})

	t.Run("multiple triggers errors", func(t *testing.T) {
		g := models.Graph{ID: "g3", Nodes: []models.Node{
			{ID: "t1", Type: "trigger.player"},
			{ID: "t2", Type: "trigger.server"},
		}}
		if _, err := findTriggerNode(g); err == nil {
			t.Error("expected error for graph with multiple trigger nodes")
		}
	})
}
