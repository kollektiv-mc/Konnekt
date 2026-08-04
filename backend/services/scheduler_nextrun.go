package services

import (
	"strconv"
	"strings"
	"time"

	"konnekt/backend/models"
)

// cronScanWindow bounds the forward scan for the next cron match (minute
// resolution). 14 days comfortably covers monthly schedules without an
// unbounded loop when an expression can never match.
const cronScanWindow = 14 * 24 * 60

// NextRuns returns graphID → next scheduled fire time (Unix ms) for enabled
// graphs that have at least one time-based trigger (interval / timeOfDay /
// cron). Event-driven graphs have no deterministic next run and are omitted.
func (s *SchedulerService) NextRuns() (map[string]int64, error) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	now := time.Now()
	out := make(map[string]int64)
	for _, g := range graphs {
		if !g.Enabled {
			continue
		}
		var best int64
		for _, node := range g.Nodes {
			next := s.nextFireForNode(g, node, now)
			if next.IsZero() {
				continue
			}
			ms := next.UnixMilli()
			if best == 0 || ms < best {
				best = ms
			}
		}
		if best != 0 {
			out[g.ID] = best
		}
	}
	return out, nil
}

// emitNextRuns pushes the current graphID → next-fire map to the frontend so
// the scheduler tile's countdown stays fresh without polling.
//
// Callers MUST hold neither s.mu nor s.cooldownMu: NextRuns takes s.mu.RLock
// and, via nextInterval, s.cooldownMu — and sync.RWMutex is not reentrant, so
// emitting under either lock self-deadlocks. Emit after the mutator's Unlock,
// and never from maybeFireInterval/maybeFireTimeOfDay/maybeFireCron/
// cooldownAllows, all of which hold s.cooldownMu.
func (s *SchedulerService) emitNextRuns() {
	runs, err := s.NextRuns()
	if err != nil {
		return
	}
	s.bus.Emit(EventScheduleNextRuns, runs)
}

// nextFireForNode computes the next fire time for a single time-based trigger
// node, honouring the in-memory lastFired bookkeeping. Returns the zero time
// for non-time triggers or expressions that cannot match.
func (s *SchedulerService) nextFireForNode(g models.Graph, node models.Node, now time.Time) time.Time {
	switch node.Type {
	case "trigger.interval":
		return s.nextInterval(g, node, now)
	case "trigger.timeOfDay":
		return nextTimeOfDay(node, now)
	case "trigger.cron":
		return nextCron(node, now)
	default:
		return time.Time{}
	}
}

func (s *SchedulerService) nextInterval(g models.Graph, node models.Node, now time.Time) time.Time {
	minutes := 60.0
	if v, ok := node.Config["intervalMinutes"].(float64); ok && v > 0 {
		minutes = v
	}
	interval := time.Duration(minutes) * time.Minute

	key := g.ID + ":" + node.ID
	s.cooldownMu.Lock()
	last, ok := s.lastFired[key]
	s.cooldownMu.Unlock()
	if ok {
		return last.Add(interval)
	}
	// Never fired yet: the first ticker pass seeds lastFired≈now, so the first
	// real fire lands roughly one interval out.
	return now.Add(interval)
}

func nextTimeOfDay(node models.Node, now time.Time) time.Time {
	target, _ := node.Config["time"].(string) // "HH:MM"
	parts := strings.SplitN(target, ":", 2)
	if len(parts) != 2 {
		return time.Time{}
	}
	h, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	m, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil {
		return time.Time{}
	}
	fire := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
	if !fire.After(now) {
		fire = fire.Add(24 * time.Hour)
	}
	return fire
}

func nextCron(node models.Node, now time.Time) time.Time {
	expr, _ := node.Config["cron"].(string)
	if strings.TrimSpace(expr) == "" {
		return time.Time{}
	}
	start := now.Truncate(time.Minute).Add(time.Minute)
	for i := 0; i < cronScanWindow; i++ {
		t := start.Add(time.Duration(i) * time.Minute)
		if cronMatches(expr, t) {
			return t
		}
	}
	return time.Time{}
}
