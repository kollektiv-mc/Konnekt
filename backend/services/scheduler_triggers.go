package services

import (
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
		s.fireTypedEventTriggers("trigger.player", "Joined", seed, "event:player:joined")
	})
	s.bus.Subscribe(EventPlayerLeft, func(data any) {
		payload, _ := data.(map[string]string)
		seed := map[string]interface{}{
			"playerName": payload["name"],
			"playerIP":   "",
		}
		s.fireTypedEventTriggers("trigger.player", "Left", seed, "event:player:left")
	})

	// Server lifecycle events — single trigger.server block filtered by type config.
	s.bus.Subscribe(EventServerStarted, func(data any) {
		s.fireTypedEventTriggers("trigger.server", "Started", map[string]interface{}{}, "event:server:started")
	})
	s.bus.Subscribe(EventServerStopped, func(data any) {
		payload, _ := data.(map[string]bool)
		t := "Stopped"
		label := "event:server:stopped"
		if !payload["expected"] {
			t = "Crashed"
			label = "event:server:crashed"
		}
		s.fireTypedEventTriggers("trigger.server", t, map[string]interface{}{}, label)
	})

	// Backup events — single trigger.backup block routed by _route seed key.
	s.bus.Subscribe(EventBackupCompleted, func(data any) {
		payload, _ := data.(map[string]interface{})
		filename, _ := payload["filename"].(string)
		seed := map[string]interface{}{
			"_route":   "onComplete",
			"filename": filename,
		}
		s.fireRoutedEventTriggers("trigger.backup", seed, "event:backup:completed")
	})
	s.bus.Subscribe(EventBackupFailed, func(data any) {
		seed := map[string]interface{}{
			"_route": "onFailed",
		}
		s.fireRoutedEventTriggers("trigger.backup", seed, "event:backup:failed")
	})

	s.bus.Subscribe(EventStatsSnapshot, func(data any) {
		snap, ok := data.(models.StatsSnapshot)
		if !ok {
			return
		}
		s.fireTPSTriggers(snap)
	})

	// Time-based ticker (per-minute resolution).
	go s.runTimeTicker()
}

// fireTypedEventTriggers finds enabled graphs with a trigger node of the given
// type whose node.Config["type"] == configType and launches a run for each,
// respecting the per-trigger cooldown. The extra config match is what enables
// merged parametric trigger blocks.
func (s *SchedulerService) fireTypedEventTriggers(triggerType, configType string, seedData map[string]interface{}, label string) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	for _, g := range graphs {
		if !g.Enabled {
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
func (s *SchedulerService) fireRoutedEventTriggers(triggerType string, seedData map[string]interface{}, label string) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	for _, g := range graphs {
		if !g.Enabled {
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
func (s *SchedulerService) fireTPSTriggers(snap models.StatsSnapshot) {
	s.mu.RLock()
	graphs := make([]models.Graph, len(s.graphs))
	copy(graphs, s.graphs)
	s.mu.RUnlock()

	for _, g := range graphs {
		if !g.Enabled {
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
	target, _ := node.Config["time"].(string) // "HH:MM"
	if target == "" {
		return
	}
	parts := strings.SplitN(target, ":", 2)
	if len(parts) != 2 {
		return
	}
	h, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	if now.Hour() != h || now.Minute() != m {
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
