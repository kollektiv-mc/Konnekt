package services

import (
	"strings"
	"testing"
	"time"

	"konnekt/backend/models"
)

func statePayload(t *testing.T, ev any) models.ServerStateChange {
	t.Helper()
	p, ok := ev.(models.ServerStateChange)
	if !ok {
		t.Fatalf("server:state payload is %T, want models.ServerStateChange", ev)
	}
	return p
}

// stateNames flattens collected server:state events to their State strings,
// order-free: the bus delivers each emit in its own goroutine, so tests match
// content, never order.
func stateNames(t *testing.T, events []any) map[string]int {
	t.Helper()
	seen := make(map[string]int, len(events))
	for _, ev := range events {
		seen[statePayload(t, ev).State]++
	}
	return seen
}

// A deliberate stop before any ready line passes through stopping (the Wings
// "shield": crash detection keys on offline arriving WITHOUT stopping first),
// and never claims running. Also the whole-boot event trace for the
// pre-ready-detection machine: starting, stopping, offline, once each.
func TestStopFromStartingPassesThroughStopping(t *testing.T) {
	s, bus := newServerFixture()
	fakeLaunch(t, s)
	states := collect(bus, EventServerState)

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start = %v, want nil", err)
	}
	if got := s.State(); got != "starting" {
		t.Fatalf("State() after Start = %q, want starting", got)
	}

	if err := s.Stop(); err != nil {
		t.Fatalf("Stop = %v, want nil", err)
	}
	if got := s.State(); got != "offline" {
		t.Fatalf("State() after Stop = %q, want offline", got)
	}

	events := waitForCount(t, states, 3)
	seen := stateNames(t, events)
	for _, want := range []string{"starting", "stopping", "offline"} {
		if seen[want] != 1 {
			t.Errorf("saw %q %d times, want exactly once (all: %v)", want, seen[want], seen)
		}
	}
	if seen["running"] != 0 {
		t.Errorf("a stop before ready claimed running: %v", seen)
	}
	for _, ev := range events {
		if p := statePayload(t, ev); p.TimedOut {
			t.Errorf("TimedOut set on a %s transition with no timeout involved", p.State)
		}
	}
	if got := s.GetLastStop(); !got.Expected {
		t.Errorf("GetLastStop() = %+v, want Expected:true — the stop marked intent", got)
	}
}

// The server's own "Stopping the server" line (a /stop typed in-game, a
// plugin-initiated shutdown) enters stopping just like Stop() does.
func TestStoppingLineEntersStopping(t *testing.T) {
	s, bus := newServerFixture()
	states := collect(bus, EventServerState)
	release, _ := fakeRunningServer(t, s)

	s.streamOutput(strings.NewReader("[12:00:00] [Server thread/INFO]: Stopping the server\n"))

	events := waitForCount(t, states, 1)
	if p := statePayload(t, events[0]); p.State != "stopping" || p.TimedOut {
		t.Errorf("payload = %+v, want {State:stopping TimedOut:false}", p)
	}
	if got := s.State(); got != "stopping" {
		t.Errorf("State() = %q, want stopping", got)
	}

	// Tear the fixture's child down and wait for its exit so the goroutines
	// finish inside the test.
	s.mu.Lock()
	exited := s.exited
	s.mu.Unlock()
	release()
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("process never exited")
	}
}

// Setting the state to what it already is produces no event: subscribers never
// see duplicate transitions, however many paths converge on one state (Stop()
// after the server already logged its own stopping line, for instance).
func TestStateEmitsOnlyOnActualChange(t *testing.T) {
	s, bus := newServerFixture()
	states := collect(bus, EventServerState)

	s.mu.Lock()
	s.setStateLocked(stateStopping, false)
	s.setStateLocked(stateStopping, false)
	s.mu.Unlock()

	events := waitForCount(t, states, 1)
	// Give a would-be duplicate a moment to arrive before counting.
	time.Sleep(50 * time.Millisecond)
	if events = states(); len(events) != 1 {
		t.Fatalf("saw %d server:state events, want exactly 1", len(events))
	}
	if p := statePayload(t, events[0]); p.State != "stopping" {
		t.Errorf("payload = %+v, want State:stopping", p)
	}
}
