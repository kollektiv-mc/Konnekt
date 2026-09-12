package services

import (
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
