package services

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"konnekt/backend/models"
)

// startTriggers subscribes to EventBus events and launches the time-trigger
// ticker. Called from SetContext after graphs are loaded.
func (s *SchedulerService) startTriggers() {
	// Player events — single trigger.player block filtered by type config.
	s.bus.Subscribe(EventPlayerJoined, func(data any) {
		payload, _ := data.(map[string]string)
		seed := map[string]interface{}{
			"playerName": payload["name"],
			"playerIP":   payload["ip"],
		}
		s.fireTypedEventTriggers(attributedServerID(EventPlayerJoined, payload["serverID"]),
			"trigger.player", "Joined", seed, "event:player:joined")
	})
	s.bus.Subscribe(EventPlayerLeft, func(data any) {
		payload, _ := data.(map[string]string)
		seed := map[string]interface{}{
			"playerName": payload["name"],
			"playerIP":   "",
		}
		s.fireTypedEventTriggers(attributedServerID(EventPlayerLeft, payload["serverID"]),
			"trigger.player", "Left", seed, "event:player:left")
	})

	// Server lifecycle events — single trigger.server block filtered by type config.
	s.bus.Subscribe(EventServerStarted, func(data any) {
		payload, ok := data.(models.ServerLifecycleEvent)
		if !ok {
			slog.Error("scheduler: server:started payload has the wrong type",
				"payloadType", fmt.Sprintf("%T", data))
			return
		}
		s.fireTypedEventTriggers(attributedServerID(EventServerStarted, payload.ServerID),
			"trigger.server", "Started", map[string]interface{}{}, "event:server:started")
	})
	s.bus.Subscribe(EventServerStopped, func(data any) {
		// Asserted with ok and reported, never swallowed. This read used to be
		// `payload, _ :=`, which turns a payload-type change into a zero value:
		// Expected false, so every clean stop would fire the Crashed trigger with
		// nothing logged anywhere. The same shape cost the TPS triggers below.
		payload, ok := data.(models.ServerStoppedEvent)
		if !ok {
			slog.Error("scheduler: server:stopped payload has the wrong type",
				"payloadType", fmt.Sprintf("%T", data))
			return
		}
		t := "Stopped"
		label := "event:server:stopped"
		if !payload.Expected {
			t = "Crashed"
			label = "event:server:crashed"
		}
		s.fireTypedEventTriggers(attributedServerID(EventServerStopped, payload.ServerID),
			"trigger.server", t, map[string]interface{}{}, label)
	})

	// Backup events — single trigger.backup block routed by _route seed key.
	s.bus.Subscribe(EventBackupCompleted, func(data any) {
		payload, _ := data.(map[string]interface{})
		filename, _ := payload["filename"].(string)
		serverID, _ := payload["serverID"].(string)
		seed := map[string]interface{}{
			"_route":   "onComplete",
			"filename": filename,
		}
		s.fireRoutedEventTriggers(attributedServerID(EventBackupCompleted, serverID),
			"trigger.backup", seed, "event:backup:completed")
	})
	// Deliberately not EventRestoreFailed as well: the block says "Fires when a
	// backup completes or fails", and a restore is not a backup. Restore
	// failures used to arrive here disguised as backup:failed (#280).
	s.bus.Subscribe(EventBackupFailed, func(data any) {
		payload, _ := data.(map[string]interface{})
		serverID, _ := payload["serverID"].(string)
		seed := map[string]interface{}{
			"_route": "onFailed",
		}
		s.fireRoutedEventTriggers(attributedServerID(EventBackupFailed, serverID),
			"trigger.backup", seed, "event:backup:failed")
	})

	s.bus.Subscribe(EventStatsSnapshot, func(data any) {
		snap, ok := data.(models.StatsSnapshotEvent)
		if !ok {
			slog.Error("scheduler: stats:snapshot payload has the wrong type",
				"payloadType", fmt.Sprintf("%T", data))
			return
		}
		s.fireTPSTriggers(attributedServerID(EventStatsSnapshot, snap.ServerID), snap.StatsSnapshot)
	})

	// Time-based ticker (per-minute resolution).
	go s.runTimeTicker()
}

// fireTypedEventTriggers finds enabled graphs with a trigger node of the given
// type whose node.Config["type"] == configType and launches a run for each,
// respecting the per-trigger cooldown. The extra config match is what enables
// merged parametric trigger blocks.
func (s *SchedulerService) fireTypedEventTriggers(serverID, triggerType, configType string, seedData map[string]interface{}, label string) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	for _, g := range graphs {
		if !g.Enabled || !s.graphAnswersTo(g, serverID) {
			continue
		}
		for _, node := range g.Nodes {
			if node.Type != triggerType {
				continue
			}
			t, _ := node.Config["type"].(string)
			if t != configType {
				continue
			}
			cooldownKey := g.ID + ":" + node.ID
			if !s.cooldownAllows(cooldownKey, node.Config) {
				continue
			}
			seed := map[string]map[string]interface{}{
				node.ID:   seedData,
				"trigger": seedData,
			}
			gCopy, nID := g, node.ID
			go func() {
				s.runGraph(gCopy, nID, label, seed)
			}()
		}
	}
}

// fireRoutedEventTriggers fires all trigger nodes of the given type, seeding
// _route so triggerRouted can pick the appropriate control output port.
func (s *SchedulerService) fireRoutedEventTriggers(serverID, triggerType string, seedData map[string]interface{}, label string) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	for _, g := range graphs {
		if !g.Enabled || !s.graphAnswersTo(g, serverID) {
			continue
		}
		for _, node := range g.Nodes {
			if node.Type != triggerType {
				continue
			}
			cooldownKey := g.ID + ":" + node.ID
			if !s.cooldownAllows(cooldownKey, node.Config) {
				continue
			}
			seed := map[string]map[string]interface{}{
				node.ID:   seedData,
				"trigger": seedData,
			}
			gCopy, nID := g, node.ID
			go func() {
				s.runGraph(gCopy, nID, label, seed)
			}()
		}
	}
}

// fireTPSTriggers checks TPS-threshold trigger nodes.
func (s *SchedulerService) fireTPSTriggers(serverID string, snap models.StatsSnapshot) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	for _, g := range graphs {
		if !g.Enabled || !s.graphAnswersTo(g, serverID) {
			continue
		}
		for _, node := range g.Nodes {
			if node.Type != "trigger.tpsThreshold" {
				continue
			}
			threshold := 14.0
			if v, ok := node.Config["threshold"]; ok {
				switch n := v.(type) {
				case float64:
					threshold = n
				case string:
					if f, err := strconv.ParseFloat(n, 64); err == nil {
						threshold = f
					}
				}
			}
			if snap.TPS >= threshold {
				continue
			}
			cooldownKey := g.ID + ":" + node.ID
			if !s.cooldownAllows(cooldownKey, node.Config) {
				continue
			}
			seed := map[string]map[string]interface{}{
				node.ID:   {"tps": snap.TPS},
				"trigger": {"tps": snap.TPS},
			}
			gCopy, nID := g, node.ID
			go func() {
				s.runGraph(gCopy, nID, "event:tps:low", seed)
			}()
		}
	}
}

// attributedServerID reports the server an event came from, and is the one place
// a missing id is noticed. (serverevents_test.go has an eventServerID of its
// own, which reads the id off a payload; this one judges what came back.)
//
// Every server-scoped payload has carried a serverID since #233, so an empty one
// means an emit site was added without one. Filtering strictly on it would make
// every schedule for that event stop firing, silently, which is the failure
// #233's own notes call the most maddening kind. An empty id therefore matches
// every graph, which is what these triggers did before this change, and says so
// loudly enough to be fixed.
func attributedServerID(event, serverID string) string {
	if serverID == "" {
		slog.Error("scheduler: event carries no server id, firing every graph for it",
			"event", event)
	}
	return serverID
}

// graphAnswersTo reports whether a graph should run for an event from serverID.
//
// A graph with an owner answers to that server and to no other. It is the same
// server the run will act on (runServerID), so the trigger side and the
// execution side cannot disagree. Before this, every graph fired for every
// server's events and then ran against whichever server the sidebar named,
// which is the defect itself.
//
// The filter applies only when both sides are known, and that restraint is
// load-bearing in both directions. An unattributed event is not a filter (see
// attributedServerID). Neither is a graph the migration could not assign, on an
// install whose active server does not resolve: it has no owner to compare
// against, and answering to nothing would make it stop firing with nothing said
// anywhere. That is a worse fault than the over-firing it replaces, so such a
// graph keeps running exactly as it did and gains an owner as soon as one can be
// resolved.
func (s *SchedulerService) graphAnswersTo(g models.Graph, serverID string) bool {
	owner := s.runServerID(g)
	if serverID == "" || owner == "" {
		return true
	}
	return owner == serverID
}

// cooldownAllows returns true if enough time has elapsed since this trigger last
// fired. Default cooldown is 5 minutes; configurable via "cooldownSeconds".
func (s *SchedulerService) cooldownAllows(key string, config map[string]interface{}) bool {
	cooldown := 5 * 60 * time.Second
	if v, ok := config["cooldownSeconds"]; ok {
		switch n := v.(type) {
		case float64:
			if n >= 0 {
				cooldown = time.Duration(n) * time.Second
			}
		}
	}

	s.cooldownMu.Lock()
	defer s.cooldownMu.Unlock()
	last, ok := s.lastFired[key]
	if ok && time.Since(last) < cooldown {
		return false
	}
	s.lastFired[key] = time.Now()
	return true
}

// runTimeTicker evaluates time-based triggers once per minute.
func (s *SchedulerService) runTimeTicker() {
	// Align to the next minute boundary for predictable time-of-day matching.
	now := time.Now()
	next := now.Truncate(time.Minute).Add(time.Minute)
	select {
	case <-time.After(time.Until(next)):
	case <-s.stopTime:
		return
	}

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		s.evaluateTimeTriggers(time.Now())
		// Push the recomputed countdown to the UI. Safe here — evaluateTimeTriggers
		// has released s.mu and s.cooldownMu by now (see emitNextRuns).
		s.emitNextRuns()
		select {
		case <-ticker.C:
		case <-s.stopTime:
			return
		}
	}
}

// evaluateTimeTriggers fires every enabled graph whose time has come, on every
// server. There is no event here and so nothing to filter on: a nightly backup
// on a server that is not currently selected is still due at that time, and each
// graph runs against its own server (runServerID).
func (s *SchedulerService) evaluateTimeTriggers(now time.Time) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	for _, g := range graphs {
		if !g.Enabled {
			continue
		}
		for _, node := range g.Nodes {
			switch node.Type {
			case "trigger.interval":
				s.maybeFireInterval(g, node, now)
			case "trigger.timeOfDay":
				s.maybeFireTimeOfDay(g, node, now)
			case "trigger.cron":
				s.maybeFireCron(g, node, now)
			}
		}
	}
}

func (s *SchedulerService) maybeFireInterval(g models.Graph, node models.Node, now time.Time) {
	key := g.ID + ":" + node.ID
	minutes := 60.0
	if v, ok := node.Config["intervalMinutes"]; ok {
		switch n := v.(type) {
		case float64:
			if n > 0 {
				minutes = n
			}
		}
	}
	interval := time.Duration(minutes) * time.Minute

	s.cooldownMu.Lock()
	last, ok := s.lastFired[key]
	if ok && now.Sub(last) < interval {
		s.cooldownMu.Unlock()
		return
	}
	if !ok {
		// First tick: set last-fired to now so the interval starts from now.
		s.lastFired[key] = now
		s.cooldownMu.Unlock()
		return
	}
	s.lastFired[key] = now
	s.cooldownMu.Unlock()

	seed := map[string]map[string]interface{}{node.ID: {}, "trigger": {}}
	gCopy, nID := g, node.ID
	go func() { s.runGraph(gCopy, nID, "time:interval", seed) }()
}

func (s *SchedulerService) maybeFireTimeOfDay(g models.Graph, node models.Node, now time.Time) {
	h, m, ok := parseTimeOfDay(node)
	if !ok || now.Hour() != h || now.Minute() != m {
		return
	}
	// Debounce: fire only once per calendar day.
	key := g.ID + ":" + node.ID
	s.cooldownMu.Lock()
	last, ok := s.lastFired[key]
	if ok && last.Year() == now.Year() && last.YearDay() == now.YearDay() {
		s.cooldownMu.Unlock()
		return
	}
	s.lastFired[key] = now
	s.cooldownMu.Unlock()

	seed := map[string]map[string]interface{}{node.ID: {}, "trigger": {}}
	gCopy, nID := g, node.ID
	go func() { s.runGraph(gCopy, nID, "time:timeOfDay", seed) }()
}

// maybeFireCron evaluates a "m h dom mon dow" cron expression at minute resolution.
func (s *SchedulerService) maybeFireCron(g models.Graph, node models.Node, now time.Time) {
	expr, _ := node.Config["cron"].(string)
	if expr == "" {
		return
	}
	if !cronMatches(expr, now) {
		return
	}
	// Debounce: fire at most once per minute.
	key := g.ID + ":" + node.ID
	s.cooldownMu.Lock()
	last, ok := s.lastFired[key]
	if ok && now.Sub(last) < time.Minute {
		s.cooldownMu.Unlock()
		return
	}
	s.lastFired[key] = now
	s.cooldownMu.Unlock()

	seed := map[string]map[string]interface{}{node.ID: {}, "trigger": {}}
	gCopy, nID := g, node.ID
	go func() { s.runGraph(gCopy, nID, "time:cron", seed) }()
}

// cronMatches evaluates a five-field "m h dom mon dow" cron expression.
func cronMatches(expr string, t time.Time) bool {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}
	vals := []int{t.Minute(), t.Hour(), t.Day(), int(t.Month()), int(t.Weekday())}
	maxes := []int{59, 23, 31, 12, 6}
	for i, field := range fields {
		if !cronFieldMatches(field, vals[i], maxes[i]) {
			return false
		}
	}
	return true
}

func cronFieldMatches(field string, val, max int) bool {
	if field == "*" {
		return true
	}
	// Step: */n
	if strings.HasPrefix(field, "*/") {
		n, err := strconv.Atoi(field[2:])
		if err != nil || n <= 0 {
			return false
		}
		return val%n == 0
	}
	// Comma-separated list.
	for _, part := range strings.Split(field, ",") {
		if cronRangeMatches(part, val, max) {
			return true
		}
	}
	return false
}

func cronRangeMatches(part string, val, _ int) bool {
	if idx := strings.Index(part, "-"); idx >= 0 {
		lo, e1 := strconv.Atoi(part[:idx])
		hi, e2 := strconv.Atoi(part[idx+1:])
		if e1 != nil || e2 != nil {
			return false
		}
		return val >= lo && val <= hi
	}
	n, err := strconv.Atoi(part)
	return err == nil && n == val
}
