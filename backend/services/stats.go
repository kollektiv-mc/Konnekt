package services

import (
	"context"
	"sync"
	"time"

	"konnekt/backend/models"
)

const snapshotCap = 360 // 1 hour at 10s intervals

type StatsService struct {
	ctx    context.Context
	server *ServerService
	bus    *EventBus

	mu      sync.Mutex
	history []models.StatsSnapshot
}

func NewStatsService(server *ServerService) *StatsService {
	return &StatsService{
		server:  server,
		history: make([]models.StatsSnapshot, 0, snapshotCap),
	}
}

func (s *StatsService) SetBus(b *EventBus) {
	s.bus = b
}

func (s *StatsService) SetContext(ctx context.Context) {
	s.ctx = ctx
	go s.run()
}

func (s *StatsService) run() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.tick()
	}
}

// tick is one pass of the stats loop, split out from run() so the ticker
// interval isn't in the way of testing it.
func (s *StatsService) tick() {
	// Status goes out every tick whether the server is up or not: this is what
	// replaces the stats tile's frontend poll, and a stop has to reach the UI
	// too. Same eight accessors GetServerStatus() reads, so the pushed payload
	// and the fetched one cannot drift apart.
	s.bus.Emit(EventServerStatus, models.ServerStatus{
		Running:    s.server.IsRunning(),
		State:      s.server.State(),
		Uptime:     s.server.Uptime(),
		Players:    s.server.PlayerCount(),
		MaxPlayers: s.server.MaxPlayers(),
		TPS:        s.server.CurrentTPS(),
		RAMUsed:    s.server.RAMUsedMB(),
		RAMTotal:   s.server.RAMTotalMB(),
	})

	// History recording stays gated — an idle server has no meaningful TPS or
	// RAM to chart, and stats:snapshot has in-process subscribers
	// (scheduler_triggers.go) that should not fire against a stopped server.
	if !s.server.IsRunning() {
		return
	}
	snap := models.StatsSnapshot{
		Timestamp:  time.Now().UnixMilli(),
		TPS:        s.server.CurrentTPS(),
		RAMUsedMB:  s.server.RAMUsedMB(),
		RAMTotalMB: s.server.RAMTotalMB(),
		CPUPercent: s.server.CPUPercent(),
		Players:    s.server.PlayerCount(),
	}

	s.mu.Lock()
	if len(s.history) >= snapshotCap {
		s.history = s.history[1:]
	}
	s.history = append(s.history, snap)
	s.mu.Unlock()

	s.bus.Emit(EventStatsSnapshot, snap)
}

func (s *StatsService) GetStatsHistory() []models.StatsSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.StatsSnapshot, len(s.history))
	copy(out, s.history)
	return out
}
