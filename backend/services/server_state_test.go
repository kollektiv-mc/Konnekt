package services

import (
	"os"
	"path/filepath"
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
	if got := s.State(fixtureServerID); got != "starting" {
		t.Fatalf("State() after Start = %q, want starting", got)
	}

	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Fatalf("Stop = %v, want nil", err)
	}
	if got := s.State(fixtureServerID); got != "offline" {
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
	if got := s.GetLastStop(fixtureServerID); !got.Expected {
		t.Errorf("GetLastStop() = %+v, want Expected:true — the stop marked intent", got)
	}
}

// The server's own "Stopping the server" line (a /stop typed in-game, a
// plugin-initiated shutdown) enters stopping just like Stop() does.
func TestStoppingLineEntersStopping(t *testing.T) {
	s, bus := newServerFixture()
	states := collect(bus, EventServerState)
	release, _ := fakeRunningServer(t, s)

	curInst(s).streamOutput(strings.NewReader("[12:00:00] [Server thread/INFO]: Stopping the server\n"))

	events := waitForCount(t, states, 1)
	if p := statePayload(t, events[0]); p.State != "stopping" || p.TimedOut {
		t.Errorf("payload = %+v, want {State:stopping TimedOut:false}", p)
	}
	if got := s.State(fixtureServerID); got != "stopping" {
		t.Errorf("State() = %q, want stopping", got)
	}

	// Tear the fixture's child down and wait for its exit so the goroutines
	// finish inside the test.
	curInst(s).mu.Lock()
	exited := curInst(s).exited
	curInst(s).mu.Unlock()
	release()
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("process never exited")
	}
}

// The acceptance case: a boot is starting until its Done line, running after
// it, and a stop then walks stopping into offline. Four transitions, one event
// each.
func TestBootReachesRunningOnDoneLine(t *testing.T) {
	s, bus := newServerFixture()
	fakeLaunch(t, s)
	states := collect(bus, EventServerState)

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start = %v, want nil", err)
	}
	curInst(s).streamOutput(strings.NewReader("[12:00:00] [Server thread/INFO]: Done (3.541s)! For help, type \"help\"\n"))
	if got := s.State(fixtureServerID); got != "running" {
		t.Fatalf("State() after the Done line = %q, want running", got)
	}

	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Fatalf("Stop = %v, want nil", err)
	}

	events := waitForCount(t, states, 4)
	seen := stateNames(t, events)
	for _, want := range []string{"starting", "running", "stopping", "offline"} {
		if seen[want] != 1 {
			t.Errorf("saw %q %d times, want exactly once (all: %v)", want, seen[want], seen)
		}
	}
	for _, ev := range events {
		if p := statePayload(t, ev); p.TimedOut {
			t.Errorf("TimedOut set on a %s transition that came from a real ready line", p.State)
		}
	}
}

// A Done line is a ready signal only while starting: a late buffered line
// flushed after teardown must not resurrect an offline machine.
func TestReadyLineIgnoredOutsideStarting(t *testing.T) {
	s, bus := newServerFixture()
	states := collect(bus, EventServerState)

	curInst(s).streamOutput(strings.NewReader("[12:00:00] [Server thread/INFO]: Done (1.2s)!\n"))

	if got := s.State(fixtureServerID); got != "offline" {
		t.Fatalf("State() = %q after a Done line on a never-started fixture, want offline", got)
	}
	if events := states(); len(events) != 0 {
		t.Errorf("saw %d server:state events, want none", len(events))
	}
}

// The one built-in ready pattern has to cover the family every supported
// flavor prints, and refuse the spoofable spellings.
func TestReadyRegexFlavors(t *testing.T) {
	cases := []struct {
		name  string
		line  string
		match bool
	}{
		{"vanilla", `[12:00:00] [Server thread/INFO]: Done (3.541s)! For help, type "help"`, true},
		{"paper", `[12:00:00 INFO]: Done (5.398s)! For help, type "help"`, true},
		{"forge", `[12Aug2025 12:00:00.000] [Server thread/minecraft/DedicatedServer]: Done (12.283s)! For help, type "help"`, true},
		{"comma decimal", `[12:00:00] [Server thread/INFO]: Done (4,2s)!`, true},
		{"bare done", `[12:00:00] [Server thread/INFO]: Done (0.9s)!`, true},
		{"chat spoof", `[12:00:00] [Server thread/INFO]: <Alex> Done (1.2s)!`, false},
		{"no log prefix", `Done (0.9s)!`, false},
		{"lowercase", `[12:00:00] [Server thread/INFO]: done (1.2s)!`, false},
		{"no duration", `[12:00:00] [Server thread/INFO]: Done!`, false},
	}
	for _, tc := range cases {
		if got := reServerReady.MatchString(tc.line); got != tc.match {
			t.Errorf("%s: match = %v, want %v for %q", tc.name, got, tc.match, tc.line)
		}
	}
}

// The timeout Wings lacks: a boot whose ready line never matches resolves to
// running after the bound, flagged TimedOut and with a console banner, rather
// than sitting in starting forever.
func TestStartingTimeoutPromotesToRunning(t *testing.T) {
	s, bus := newServerFixture()
	fakeLaunch(t, s)
	s.startingTimeout = 30 * time.Millisecond
	states := collect(bus, EventServerState)

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start = %v, want nil", err)
	}

	events := waitForCount(t, states, 2)
	var running *models.ServerStateChange
	for _, ev := range events {
		if p := statePayload(t, ev); p.State == "running" {
			running = &p
		}
	}
	if running == nil {
		t.Fatalf("no running transition after the timeout: %v", events)
	}
	if !running.TimedOut {
		t.Error("TimedOut = false on a timeout-promoted running state")
	}

	var banner bool
	for _, line := range s.GetConsoleHistory(fixtureServerID) {
		if strings.Contains(line.Line, "No ready line seen") {
			banner = true
		}
	}
	if !banner {
		t.Errorf("console history holds no timeout banner: %v", s.GetConsoleHistory(fixtureServerID))
	}

	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Errorf("cleanup Stop = %v, want nil", err)
	}
}

// A ready line beats the timer: exactly one running transition, not flagged,
// and no banner once the deadline passes.
func TestReadySuppressesTheTimeout(t *testing.T) {
	s, bus := newServerFixture()
	fakeLaunch(t, s)
	// Long enough that the synchronous Done feed below always wins the race,
	// short enough that the test can outwait the timer firing its no-op.
	s.startingTimeout = 250 * time.Millisecond
	states := collect(bus, EventServerState)

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start = %v, want nil", err)
	}
	curInst(s).streamOutput(strings.NewReader("[12:00:00] [Server thread/INFO]: Done (0.4s)!\n"))

	time.Sleep(400 * time.Millisecond) // let the armed timer fire and no-op

	events := states()
	seen := stateNames(t, events)
	if seen["running"] != 1 {
		t.Errorf("saw running %d times, want exactly once (all: %v)", seen["running"], seen)
	}
	for _, ev := range events {
		if p := statePayload(t, ev); p.State == "running" && p.TimedOut {
			t.Error("TimedOut set although the ready line matched first")
		}
	}
	for _, line := range s.GetConsoleHistory(fixtureServerID) {
		if strings.Contains(line.Line, "No ready line seen") {
			t.Errorf("timeout banner written although ready matched first: %q", line.Line)
		}
	}

	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Errorf("cleanup Stop = %v, want nil", err)
	}
}

// The regression the TPS re-key is most likely to cause: the stopTPS/tpsOnce
// re-arm moved from start() to the running transition, and split from the
// spawn it would leave stopTPSPoll consuming a stale Once — dead polling from
// the second boot on. Two full boots must each arm a fresh gate.
func TestTPSPollRearmsAcrossBoots(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	s.SetRcon(NewRconService())

	dir := t.TempDir()
	props := "enable-rcon=true\nrcon.port=25599\nrcon.password=x\n"
	if err := os.WriteFile(filepath.Join(dir, "server.properties"), []byte(props), 0o644); err != nil {
		t.Fatalf("write server.properties: %v", err)
	}

	tpsGate := func() (ch chan struct{}, closed bool) {
		curInst(s).mu.Lock()
		ch = curInst(s).stopTPS
		curInst(s).mu.Unlock()
		if ch == nil {
			return nil, false
		}
		select {
		case <-ch:
			return ch, true
		default:
			return ch, false
		}
	}

	boot := func(n int) chan struct{} {
		t.Helper()
		if err := s.Start("srv1", "", nil, dir); err != nil {
			t.Fatalf("boot %d: Start = %v, want nil", n, err)
		}
		curInst(s).streamOutput(strings.NewReader("[12:00:00] [Server thread/INFO]: Done (1.0s)!\n"))
		ch, closed := tpsGate()
		if ch == nil || closed {
			t.Fatalf("boot %d: TPS gate after ready = (%v, closed=%v), want a fresh open channel", n, ch, closed)
		}
		return ch
	}

	first := boot(1)
	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Fatalf("Stop after boot 1 = %v, want nil", err)
	}
	select {
	case <-first:
	default:
		t.Fatal("boot 1's TPS gate not closed by Stop")
	}

	second := boot(2)
	if second == first {
		t.Fatal("boot 2 reused boot 1's TPS gate instead of re-arming")
	}
	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Fatalf("Stop after boot 2 = %v, want nil", err)
	}
}

// Setting the state to what it already is produces no event: subscribers never
// see duplicate transitions, however many paths converge on one state (Stop()
// after the server already logged its own stopping line, for instance).
func TestStateEmitsOnlyOnActualChange(t *testing.T) {
	s, bus := newServerFixture()
	states := collect(bus, EventServerState)

	curInst(s).mu.Lock()
	curInst(s).setStateLocked(stateStopping, false)
	curInst(s).setStateLocked(stateStopping, false)
	curInst(s).mu.Unlock()

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
