package services

import (
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

func TestCronMatches(t *testing.T) {
	// 2024-01-01 is a Monday.
	mon := time.Date(2024, 1, 1, 9, 30, 0, 0, time.UTC)

	cases := []struct {
		name string
		expr string
		want bool
	}{
		{"wildcard always matches", "* * * * *", true},
		{"step matches multiple", "*/5 * * * *", true}, // 30 % 5 == 0
		{"step does not match", "*/7 * * * *", false},  // 30 % 7 != 0
		{"specific minute+hour match", "30 9 * * *", true},
		{"specific minute mismatch", "31 9 * * *", false},
		{"specific hour mismatch", "30 8 * * *", false},
		{"range match", "20-40 * * * *", true},
		{"range mismatch", "0-10 * * * *", false},
		{"list match", "0,30,45 * * * *", true},
		{"list mismatch", "0,15,45 * * * *", false},
		{"wrong field count", "* * * *", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := cronMatches(c.expr, mon); got != c.want {
				t.Errorf("cronMatches(%q, %v) = %v, want %v", c.expr, mon, got, c.want)
			}
		})
	}
}

func TestCooldownAllows(t *testing.T) {
	s := newTestScheduler(t)

	t.Run("first call allowed, immediate repeat blocked by default cooldown", func(t *testing.T) {
		key := "g:node1"
		if !s.cooldownAllows(key, nil) {
			t.Fatal("first call should be allowed")
		}
		if s.cooldownAllows(key, nil) {
			t.Error("immediate repeat should be blocked by the default 5-minute cooldown")
		}
	})

	t.Run("cooldownSeconds 0 always allows", func(t *testing.T) {
		key := "g:node2"
		cfg := map[string]interface{}{"cooldownSeconds": float64(0)}
		if !s.cooldownAllows(key, cfg) {
			t.Fatal("first call should be allowed")
		}
		if !s.cooldownAllows(key, cfg) {
			t.Error("cooldownSeconds:0 should always allow")
		}
	})
}

// A time-of-day trigger whose config cannot be parsed must never fire. It used
// to: strconv.Atoi's errors were discarded, so "ab:cd" read as 00:00 and the
// graph ran at midnight while the tile showed no next run for it.
func TestMaybeFireTimeOfDay(t *testing.T) {
	midnight := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	graph := func(id string) models.Graph { return models.Graph{ID: id, Name: id} }
	node := func(cfg string) models.Node {
		return models.Node{ID: "n1", Config: map[string]interface{}{"time": cfg}}
	}

	t.Run("malformed time does not fire at midnight", func(t *testing.T) {
		s := newTestScheduler(t)
		s.maybeFireTimeOfDay(graph("g1"), node("ab:cd"), midnight)
		s.cooldownMu.Lock()
		defer s.cooldownMu.Unlock()
		if _, fired := s.lastFired["g1:n1"]; fired {
			t.Fatal("a trigger with an unparseable time fired")
		}
	})

	t.Run("a matching time fires once per day", func(t *testing.T) {
		s := newTestScheduler(t)
		// Mark the graph as already running so the goroutine runGraph spawns
		// returns as "skipped" without executing anything; what this test pins
		// is the decision to fire, which is the lastFired write.
		s.runningMu.Lock()
		s.running["g2"] = true
		s.runningMu.Unlock()

		s.maybeFireTimeOfDay(graph("g2"), node("00:00"), midnight)
		s.cooldownMu.Lock()
		last, fired := s.lastFired["g2:n1"]
		s.cooldownMu.Unlock()
		if !fired || !last.Equal(midnight) {
			t.Fatalf("lastFired = %v, %v; want the fire recorded at %v", last, fired, midnight)
		}

		// Same minute, later tick: the once-a-day debounce holds.
		later := midnight.Add(30 * time.Second)
		s.maybeFireTimeOfDay(graph("g2"), node("00:00"), later)
		s.cooldownMu.Lock()
		defer s.cooldownMu.Unlock()
		if !s.lastFired["g2:n1"].Equal(midnight) {
			t.Fatal("the same trigger fired twice in one day")
		}
	})

	t.Run("a non-matching minute does not fire", func(t *testing.T) {
		s := newTestScheduler(t)
		s.maybeFireTimeOfDay(graph("g3"), node("00:01"), midnight)
		s.cooldownMu.Lock()
		defer s.cooldownMu.Unlock()
		if _, fired := s.lastFired["g3:n1"]; fired {
			t.Fatal("fired a minute early")
		}
	})
}

// ─── Payload types the triggers assert on (#233) ──────────────────────────
//
// These two subscriptions type-assert what the bus hands them, and both used to
// swallow a miss. Changing an emitted payload type without changing the assert
// alongside it is invisible at compile time and silent at run time: a
// server:stopped miss yields the zero ServerStopped, whose Expected is false, so
// every clean shutdown would fire the Crashed trigger; a stats:snapshot miss
// returns early, so every TPS trigger would simply stop firing. Nothing is
// logged in either case and no test outside these two would go red.
//
// They are worth the setup cost because the failure is in the reader, not the
// writer: the events above are provably correct and these still break.

// runTrigger fires one bus event against a scheduler holding the given graphs
// and reports which graph ids actually ran.
func runTrigger(t *testing.T, graphs []models.Graph, event string, payload any) map[string]bool {
	t.Helper()
	s := newTestScheduler(t)
	s.graphs = graphs
	s.startTriggers()
	t.Cleanup(func() { close(s.stopTime) })

	var mu sync.Mutex
	ran := make(map[string]bool)
	s.bus.Subscribe(EventScheduleRunStarted, func(data any) {
		p, _ := data.(map[string]interface{})
		id, _ := p["graphId"].(string)
		mu.Lock()
		ran[id] = true
		mu.Unlock()
	})

	s.bus.Emit(event, payload)

	// The bus fans out in goroutines and runGraph launches another, so settle
	// rather than read immediately. A false negative here would hide the bug
	// this test exists for, so the wait is generous.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(ran)
		mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond) // let a second, wrong graph show up if it is going to

	mu.Lock()
	defer mu.Unlock()
	out := make(map[string]bool, len(ran))
	for k, v := range ran {
		out[k] = v
	}
	return out
}

func serverTriggerGraph(id, configType string) models.Graph {
	return models.Graph{
		ID:      id,
		Name:    id,
		Enabled: true,
		Nodes: []models.Node{{
			ID:     "n1",
			Type:   "trigger.server",
			Config: map[string]interface{}{"type": configType},
		}},
	}
}

func TestGracefulStopFiresStoppedAndNotCrashed(t *testing.T) {
	ran := runTrigger(t,
		[]models.Graph{
			serverTriggerGraph("g-stopped", "Stopped"),
			serverTriggerGraph("g-crashed", "Crashed"),
		},
		EventServerStopped,
		models.ServerStoppedEvent{
			ServerStopped: models.ServerStopped{Expected: true, ExitCode: 0},
			ServerID:      "srv1",
		})

	if !ran["g-stopped"] {
		t.Error("a clean stop did not fire the Stopped trigger")
	}
	if ran["g-crashed"] {
		t.Error("a clean stop fired the Crashed trigger, which is what a swallowed type assertion looks like")
	}
}

func TestUnexpectedStopStillFiresCrashed(t *testing.T) {
	ran := runTrigger(t,
		[]models.Graph{
			serverTriggerGraph("g-stopped", "Stopped"),
			serverTriggerGraph("g-crashed", "Crashed"),
		},
		EventServerStopped,
		models.ServerStoppedEvent{
			ServerStopped: models.ServerStopped{Expected: false, ExitCode: 1},
			ServerID:      "srv1",
		})

	if !ran["g-crashed"] {
		t.Error("an unexpected exit did not fire the Crashed trigger")
	}
	if ran["g-stopped"] {
		t.Error("an unexpected exit fired the Stopped trigger")
	}
}

func TestSnapshotStillReachesTheTPSTriggers(t *testing.T) {
	ran := runTrigger(t,
		[]models.Graph{{
			ID:      "g-tps",
			Name:    "g-tps",
			Enabled: true,
			Nodes: []models.Node{{
				ID:     "n1",
				Type:   "trigger.tpsThreshold",
				Config: map[string]interface{}{"threshold": 15.0},
			}},
		}},
		EventStatsSnapshot,
		models.StatsSnapshotEvent{
			StatsSnapshot: models.StatsSnapshot{TPS: 5},
			ServerID:      "srv1",
		})

	if !ran["g-tps"] {
		t.Error("a below-threshold snapshot did not fire the TPS trigger; the subscription's type assertion no longer matches what stats.go emits")
	}
}

func TestTPSTriggerStillIgnoresAHealthySnapshot(t *testing.T) {
	ran := runTrigger(t,
		[]models.Graph{{
			ID:      "g-tps",
			Name:    "g-tps",
			Enabled: true,
			Nodes: []models.Node{{
				ID:     "n1",
				Type:   "trigger.tpsThreshold",
				Config: map[string]interface{}{"threshold": 15.0},
			}},
		}},
		EventStatsSnapshot,
		models.StatsSnapshotEvent{
			StatsSnapshot: models.StatsSnapshot{TPS: 20},
			ServerID:      "srv1",
		})

	if ran["g-tps"] {
		t.Error("a healthy snapshot fired the TPS trigger")
	}
}
