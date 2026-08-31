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
	// A 10s ticker carries no server id, so this reports on the current server —
	// the one a successful start last claimed. Deliberately not the sidebar
	// selection: useServerConfigStore falls back to configs[0].id without
	// persisting it, so active_server.json is empty for a user who never opens
	// the selector, and the push would describe "" forever.
	id := s.server.CurrentServerID()

	// Status goes out every tick whether the server is up or not: this is what
	// replaces the stats tile's frontend poll, and a stop has to reach the UI
	// too. One read shared with GetServerStatus, so the pushed payload and the
	// fetched one cannot drift apart — which this comment used to assert by hand.
	st := s.server.Status(id)
	s.bus.Emit(EventServerStatus, st)

	// History recording stays gated — an idle server has no meaningful TPS or
	// RAM to chart, and stats:snapshot has in-process subscribers
	// (scheduler_triggers.go) that should not fire against a stopped server.
	if !st.Running {
		return
	}
	// Derived from the same status read, so the two events cannot disagree about
	// TPS or RAM within one tick.
	snap := models.StatsSnapshot{
		Timestamp:  time.Now().UnixMilli(),
		TPS:        st.TPS,
		RAMUsedMB:  st.RAMUsed,
		RAMTotalMB: st.RAMTotal,
		CPUPercent: s.server.CPUPercent(id),
		Players:    st.Players,
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
