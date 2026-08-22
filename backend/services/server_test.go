package services

import (
	"strings"
	"testing"
	"time"
)

// Use NewServerService, not a struct literal: streamOutput writes the player
// maps, and a nil map write panics.
func newServerFixture() (*ServerService, *EventBus) {
	s := NewServerService()
	bus := NewEventBus() // no ctx: Emit skips the Wails runtime and only fans out in-process
	s.SetBus(bus)
	return s, bus
}

// waitForCount polls a collect getter until it has seen n events, because the
// bus delivers in subscriber goroutines.
func waitForCount(t *testing.T, got func() []any, n int) []any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if events := got(); len(events) >= n {
			return events
		}
		time.Sleep(5 * time.Millisecond)
	}
	events := got()
	t.Fatalf("saw %d events before timeout, want %d", len(events), n)
	return events
}

func logPayload(t *testing.T, ev any) string {
	t.Helper()
	m, ok := ev.(map[string]string)
	if !ok {
		t.Fatalf("log:line payload is %T, want map[string]string", ev)
	}
	return m["line"]
}

// The bug behind issue #112: one overlong line used to make Scan return false
// and the goroutine exit, killing the console for the rest of the session.
//
// Content and order are asserted against the ring buffer, which streamOutput
// writes synchronously. The bus delivers each emit in its own goroutine, so
// cross-event order is not guaranteed there — events are awaited and matched
// by content only. (The Wails runtime path in Emit is synchronous; only
// in-process subscribers see unordered delivery.)
func TestStreamOutputSurvivesOverlongLine(t *testing.T) {
	s, bus := newServerFixture()
	lines := collect(bus, EventLogLine)

	giant := strings.Repeat("x", maxConsoleLine+1024)
	s.streamOutput(strings.NewReader(giant + "\n[12:00:00] [Server thread/INFO]: Done (1.2s)!\n"))

	history := s.GetConsoleHistory()
	if len(history) != 2 {
		t.Fatalf("ring buffer holds %d lines, want 2", len(history))
	}
	if history[0].Line != giant[:maxConsoleLine] {
		t.Errorf("first line is not truncated at the cap (len %d, want %d)", len(history[0].Line), maxConsoleLine)
	}
	if !strings.Contains(history[1].Line, "Done (1.2s)!") {
		t.Errorf("streaming did not continue past the overlong line: got %q", history[1].Line)
	}

	events := waitForCount(t, lines, 2)
	var sawTruncated, sawDone bool
	for _, ev := range events {
		switch got := logPayload(t, ev); {
		case got == giant[:maxConsoleLine]:
			sawTruncated = true
		case strings.Contains(got, "Done (1.2s)!"):
			sawDone = true
		}
	}
	if !sawTruncated || !sawDone {
		t.Errorf("bus delivery incomplete: truncated=%v done=%v", sawTruncated, sawDone)
	}
}

func TestStreamOutputNormalizesCarriageReturns(t *testing.T) {
	s, bus := newServerFixture()
	lines := collect(bus, EventLogLine)

	s.streamOutput(strings.NewReader("Preparing spawn area: 10%\rPreparing spawn area: 20%\rPreparing spawn area: 30%\n"))

	want := []string{
		"Preparing spawn area: 10%",
		"Preparing spawn area: 20%",
		"Preparing spawn area: 30%",
	}
	history := s.GetConsoleHistory()
	if len(history) != len(want) {
		t.Fatalf("ring buffer holds %d lines %v, want %d", len(history), history, len(want))
	}
	for i, w := range want {
		if history[i].Line != w {
			t.Errorf("line %d: got %q, want %q", i, history[i].Line, w)
		}
	}

	// Unordered on the bus: one goroutine per emit (see note above).
	events := waitForCount(t, lines, 3)
	seen := make(map[string]bool, len(events))
	for _, ev := range events {
		seen[logPayload(t, ev)] = true
	}
	for _, w := range want {
		if !seen[w] {
			t.Errorf("bus never delivered %q", w)
		}
	}
}

// The line matchers (players, EULA, expected stop) must keep working on the
// normalized lines, including lines separated only by carriage returns.
func TestStreamOutputMatchersFireOnNormalizedLines(t *testing.T) {
	s, bus := newServerFixture()
	joined := collect(bus, EventPlayerJoined)
	eula := collect(bus, EventEulaRequired)

	input := strings.Join([]string{
		"[12:00:00] [User Authenticator #1/INFO]: UUID of player Alex is 069a79f4-44e9-4726-a5be-fca90e38aaf5",
		"[12:00:00] [Server thread/INFO]: Alex[/127.0.0.1:54321] logged in with entity id 261",
		"[12:00:00] [Server thread/INFO]: Alex joined the game",
		"[12:00:00] [Server thread/INFO]: Go to eula.txt for more info.",
		"[12:00:00] [Server thread/INFO]: Stopping the server",
	}, "\r") // \r separators: matchers see lines only if normalization splits them

	s.streamOutput(strings.NewReader(input))

	events := waitForCount(t, joined, 1)
	m, ok := events[0].(map[string]string)
	if !ok {
		t.Fatalf("player:joined payload is %T, want map[string]string", events[0])
	}
	if m["name"] != "Alex" || m["ip"] != "127.0.0.1" {
		t.Errorf("player:joined payload = %v, want name Alex ip 127.0.0.1", m)
	}
	waitForCount(t, eula, 1)

	s.playersMu.RLock()
	sess, online := s.players["Alex"]
	s.playersMu.RUnlock()
	if !online {
		t.Error("Alex missing from the players map")
	} else if sess.uuid != "069a79f4-44e9-4726-a5be-fca90e38aaf5" {
		t.Errorf("Alex's uuid = %q", sess.uuid)
	}

	s.mu.Lock()
	expected := s.expectedStop
	s.mu.Unlock()
	if !expected {
		t.Error("'Stopping the server' did not set expectedStop")
	}
}
