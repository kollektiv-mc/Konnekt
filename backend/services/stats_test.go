package services

import (
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

// collect subscribes to an event and returns a getter for what was received.
// EventBus fans out to subscribers in their own goroutines, so the getter waits
// briefly rather than reading immediately.
func collect(bus *EventBus, event string) func() []any {
	var mu sync.Mutex
	var got []any
	bus.Subscribe(event, func(data any) {
		mu.Lock()
		got = append(got, data)
		mu.Unlock()
	})
	return func() []any {
		deadline := time.Now().Add(500 * time.Millisecond)
		for time.Now().Before(deadline) {
			mu.Lock()
			n := len(got)
			mu.Unlock()
			if n > 0 {
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
		mu.Lock()
		defer mu.Unlock()
		out := make([]any, len(got))
		copy(out, got)
		return out
	}
}

func newStatsFixture() (*StatsService, *ServerService, *EventBus) {
	bus := NewEventBus() // no ctx: Emit skips the Wails runtime and only fans out in-process
	server := &ServerService{}
	stats := NewStatsService(server)
	stats.SetBus(bus)
	return stats, server, bus
}

// The stats tile used to poll GetServerStatus on a 10s interval. It was replaced
// by this push, so the push has to carry every field the tile renders and it has
// to keep arriving while the server is down — that is precisely what
// stats:snapshot could not do, and why it is a separate event.
func TestTickEmitsServerStatusWhileStopped(t *testing.T) {
	stats, server, bus := newStatsFixture()
	statuses := collect(bus, EventServerStatus)
	snapshots := collect(bus, EventStatsSnapshot)

	if server.IsRunning() {
		t.Fatal("fixture server should start stopped")
	}
	stats.tick()

	got := statuses()
	if len(got) != 1 {
		t.Fatalf("want 1 server:status while stopped, got %d", len(got))
	}
	st, ok := got[0].(models.ServerStatus)
	if !ok {
		t.Fatalf("payload should be models.ServerStatus, got %T", got[0])
	}
	if st.Running {
		t.Error("Running should be false while the server is stopped")
	}
	if st.Uptime != "0s" {
		t.Errorf("Uptime = %q, want %q", st.Uptime, "0s")
	}
	// MaxPlayers is the field stats:snapshot has no equivalent for; a zero here
	// would blank the tile's "players / maxPlayers" readout.
	if st.MaxPlayers != 20 {
		t.Errorf("MaxPlayers = %d, want the 20 default", st.MaxPlayers)
	}

	if n := len(snapshots()); n != 0 {
		t.Errorf("stats:snapshot should stay gated while stopped, got %d", n)
	}
	if n := len(stats.GetStatsHistory()); n != 0 {
		t.Errorf("history should stay empty while stopped, got %d entries", n)
	}
}

func TestTickEmitsBothWhileRunning(t *testing.T) {
	stats, server, bus := newStatsFixture()
	statuses := collect(bus, EventServerStatus)
	snapshots := collect(bus, EventStatsSnapshot)

	server.mu.Lock()
	server.running = true
	server.startTime = time.Now()
	server.mu.Unlock()

	stats.tick()

	got := statuses()
	if len(got) != 1 {
		t.Fatalf("want 1 server:status while running, got %d", len(got))
	}
	if st := got[0].(models.ServerStatus); !st.Running {
		t.Error("Running should be true while the server is up")
	}
	if n := len(snapshots()); n != 1 {
		t.Errorf("want 1 stats:snapshot while running, got %d", n)
	}
	if n := len(stats.GetStatsHistory()); n != 1 {
		t.Errorf("want 1 history entry while running, got %d", n)
	}
}

// The tile reads status from a single store the push writes to, so the pushed
// shape has to match what the binding returns field for field. If someone adds a
// field to ServerStatus and only updates GetServerStatus, this catches it.
func TestPushedStatusMatchesGetServerStatusShape(t *testing.T) {
	stats, server, bus := newStatsFixture()
	statuses := collect(bus, EventServerStatus)

	stats.tick()
	got := statuses()
	if len(got) != 1 {
		t.Fatalf("want 1 server:status, got %d", len(got))
	}
	pushed := got[0].(models.ServerStatus)

	fetched := models.ServerStatus{
		Running:    server.IsRunning(),
		Uptime:     server.Uptime(),
		Players:    server.PlayerCount(),
		MaxPlayers: server.MaxPlayers(),
		TPS:        server.CurrentTPS(),
		RAMUsed:    server.RAMUsedMB(),
		RAMTotal:   server.RAMTotalMB(),
	}
	if pushed != fetched {
		t.Errorf("pushed %+v != fetched %+v", pushed, fetched)
	}
}
