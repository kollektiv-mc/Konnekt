package services

import (
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
)

// Every server-scoped event has to name the server it describes (#233). Until
// it did, #234 could not filter a push by server and #236 could not pin a
// schedule graph to one, so this is the check those two rest on.
//
// Driven through the real emit paths rather than by calling bus.Emit directly:
// what is being pinned is that each call site passes its id along, and a test
// that emits its own payload would pass with every call site still dropping it.

// eventServerID pulls the id off a payload whatever shape it arrives in. The
// two shapes are deliberate, not an inconsistency: a payload that was already a
// map gains a key, while a payload that was a generated model gains an
// embedding, because a field on the model itself would be a required field in
// the TypeScript class Wails generates from it. See models/server.go.
func eventServerID(t *testing.T, event string, payload any) string {
	t.Helper()
	switch p := payload.(type) {
	case map[string]string:
		return p["serverID"]
	case models.ServerLifecycleEvent:
		return p.ServerID
	case models.ServerStatusEvent:
		return p.ServerID
	case models.ServerStateEvent:
		return p.ServerID
	case models.ServerStoppedEvent:
		return p.ServerID
	case models.StatsSnapshotEvent:
		return p.ServerID
	default:
		t.Fatalf("%s payload is %T, which carries no server id", event, payload)
		return ""
	}
}

// recorder keeps every payload an event delivered, unlike collect, which stops
// waiting at the first one. The table below asserts on all of them.
func recorder(bus *EventBus, event string) func() []any {
	var mu sync.Mutex
	var got []any
	bus.Subscribe(event, func(data any) {
		mu.Lock()
		got = append(got, data)
		mu.Unlock()
	})
	return func() []any {
		mu.Lock()
		defer mu.Unlock()
		return append([]any{}, got...)
	}
}

func TestEveryServerScopedEventCarriesItsServerID(t *testing.T) {
	// The nine events that used to travel anonymously. Backup, mod and loader
	// events already carried an id and are covered where they are emitted.
	events := []string{
		EventServerStarted,
		EventEulaRequired,
		EventPlayerJoined,
		EventPlayerLeft,
		EventLogLine,
		EventServerStopped,
		EventServerState,
		EventServerStatus,
		EventStatsSnapshot,
	}

	s, bus := newServerFixture()
	fakeLaunch(t, s)
	stats := NewStatsService(s)
	stats.SetBus(bus)

	seen := make(map[string]func() []any, len(events))
	for _, e := range events {
		seen[e] = recorder(bus, e)
	}

	// Boot: server:started and the offline to starting server:state transition.
	if err := s.Start(fixtureServerID, "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start = %v, want nil", err)
	}

	// Console: log:line for each line, plus the player and EULA matchers. The
	// login line has to precede the join or promotePlayer reports no join.
	curInst(s).streamOutput(strings.NewReader(strings.Join([]string{
		"[12:00:00] [Server thread/INFO]: Alex[/127.0.0.1:54321] logged in with entity id 261",
		"[12:00:00] [Server thread/INFO]: Alex joined the game",
		"[12:00:00] [Server thread/INFO]: Alex left the game",
		"[12:00:00] [Server thread/INFO]: Go to eula.txt for more info.",
		"",
	}, "\n")))

	// Stats: server:status every tick, stats:snapshot only while running.
	stats.tick()

	// Shutdown: server:stopped and the transition back to offline.
	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Fatalf("Stop = %v, want nil", err)
	}

	for _, event := range events {
		t.Run(event, func(t *testing.T) {
			var payloads []any
			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				if payloads = seen[event](); len(payloads) > 0 {
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
			if len(payloads) == 0 {
				t.Fatalf("%s never fired, so nothing was checked", event)
			}
			for i, payload := range payloads {
				if got := eventServerID(t, event, payload); got != fixtureServerID {
					t.Errorf("%s[%d] serverID = %q, want %q", event, i, got, fixtureServerID)
				}
			}
		})
	}
}

// The status push and the stats snapshot report on whichever server is current,
// which is a different id from the one the console events carry when the two
// disagree. Pinned separately so the table above cannot pass by accident on a
// fixture where every id happens to be the same string.
func TestStatsEventsNameTheServerTheyReportOn(t *testing.T) {
	s, bus := newServerFixture()
	stats := NewStatsService(s)
	stats.SetBus(bus)

	statuses := collect(bus, EventServerStatus)
	stats.tick()

	got := statuses()
	if len(got) != 1 {
		t.Fatalf("want 1 server:status, got %d", len(got))
	}
	ev, ok := got[0].(models.ServerStatusEvent)
	if !ok {
		t.Fatalf("server:status payload is %T, want models.ServerStatusEvent", got[0])
	}
	if ev.ServerID != s.CurrentServerID() {
		t.Errorf("serverID = %q, want CurrentServerID() %q", ev.ServerID, s.CurrentServerID())
	}
}

// Wire shape: adding the id must not rename or drop anything a subscriber
// already reads. The frontend is untouched by this change and would fail
// silently rather than loudly if a key moved, since every handler reads
// optional properties off an untyped payload.
func TestEventPayloadsKeepTheirExistingFields(t *testing.T) {
	s, bus := newServerFixture()

	lines := collect(bus, EventLogLine)
	joins := collect(bus, EventPlayerJoined)

	curInst(s).streamOutput(strings.NewReader(
		"[12:00:00] [Server thread/INFO]: Alex[/127.0.0.1:54321] logged in with entity id 261\n" +
			"[12:00:00] [Server thread/INFO]: Alex joined the game\n"))

	line, ok := waitForCount(t, lines, 1)[0].(map[string]string)
	if !ok {
		t.Fatalf("log:line payload is no longer map[string]string")
	}
	for _, key := range []string{"serverID", "timestamp", "line"} {
		if line[key] == "" {
			t.Errorf("log:line payload has no %q: %v", key, line)
		}
	}

	join, ok := waitForCount(t, joins, 1)[0].(map[string]string)
	if !ok {
		t.Fatalf("player:joined payload is no longer map[string]string")
	}
	if join["name"] != "Alex" {
		t.Errorf("player:joined name = %q, want %q", join["name"], "Alex")
	}
	if join["ip"] != "127.0.0.1" {
		t.Errorf("player:joined ip = %q, want %q", join["ip"], "127.0.0.1")
	}
}
