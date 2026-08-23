package services

import (
	"errors"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"konnekt/backend/models"
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

// exitingCommand returns a real short-lived process that exits with code,
// because faking os.ProcessState is not possible and a real Wait is the thing
// under test.
func exitingCommand(t *testing.T, code int) *exec.Cmd {
	t.Helper()
	if runtime.GOOS == "windows" {
		return exec.Command("cmd", "/c", fmt.Sprintf("exit %d", code))
	}
	return exec.Command("sh", "-c", fmt.Sprintf("exit %d", code))
}

// startForExit wires the minimum waitForExit needs around a started cmd:
// the cmd itself, the exited channel it closes, and the expectedStop intent.
func startForExit(t *testing.T, s *ServerService, cmd *exec.Cmd, expected bool) {
	t.Helper()
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	s.mu.Lock()
	s.cmd = cmd
	s.exited = make(chan struct{})
	s.expectedStop = expected
	s.mu.Unlock()
}

// The bug behind issue #111: waitForExit discarded cmd.Wait's status, so the
// single most useful JVM crash diagnostic never reached the user. An
// unexpected exit must carry the code on the server:stopped payload, keep it
// readable via GetLastStop, and drop a banner line into the console history.
func TestWaitForExitReportsTheExitCodeOnUnexpectedStop(t *testing.T) {
	s, bus := newServerFixture()

	var mu sync.Mutex
	var stops []any
	bus.Subscribe(EventServerStopped, func(data any) {
		mu.Lock()
		stops = append(stops, data)
		mu.Unlock()
	})

	startForExit(t, s, exitingCommand(t, 3), false)
	s.waitForExit()

	if got := s.GetLastStop(); got.Expected || got.ExitCode != 3 {
		t.Errorf("GetLastStop() = %+v, want {Expected:false ExitCode:3}", got)
	}

	events := waitForCount(t, func() []any {
		mu.Lock()
		defer mu.Unlock()
		return append([]any{}, stops...)
	}, 1)
	payload, ok := events[0].(models.ServerStopped)
	if !ok {
		t.Fatalf("server:stopped payload is %T, want models.ServerStopped", events[0])
	}
	if payload.Expected || payload.ExitCode != 3 {
		t.Errorf("payload = %+v, want {Expected:false ExitCode:3}", payload)
	}

	history := s.GetConsoleHistory()
	if len(history) == 0 || !strings.Contains(history[len(history)-1].Line, "exit code 3") {
		t.Errorf("console history = %v, want a final banner naming exit code 3", history)
	}
}

// A deliberate stop must show neither a banner nor a crash-shaped payload:
// the acceptance case's other half.
func TestWaitForExitNormalStopWritesNoBanner(t *testing.T) {
	s, _ := newServerFixture()

	startForExit(t, s, exitingCommand(t, 0), true)
	s.waitForExit()

	if got := s.GetLastStop(); !got.Expected || got.ExitCode != 0 {
		t.Errorf("GetLastStop() = %+v, want {Expected:true ExitCode:0}", got)
	}
	for _, line := range s.GetConsoleHistory() {
		if strings.Contains(line.Line, "[Konnekt]") {
			t.Errorf("console history holds a banner on a deliberate stop: %q", line.Line)
		}
	}
}

// consumeStdinCommand returns a process that exits when its stdin closes —
// stop()'s graceful path, with no 8-second killTree wait.
func consumeStdinCommand(t *testing.T) *exec.Cmd {
	t.Helper()
	if runtime.GOOS == "windows" {
		return exec.Command("cmd", "/c", "more")
	}
	return exec.Command("sh", "-c", "cat >/dev/null")
}

// fakeLaunch installs the launchCmd seam so every start() spawns a process
// that exits when its stdin closes, letting the power-action tests run
// without java on PATH.
func fakeLaunch(t *testing.T, s *ServerService) {
	t.Helper()
	s.launchCmd = func(jarPath, workingDir string, jvmArgs []string) (*exec.Cmd, error) {
		return consumeStdinCommand(t), nil
	}
}

// fakeRunningServer wires a live child whose exit the TEST controls,
// decoupled from the stdin stop() closes: the process's real stdin stays in
// the test's hand (release closes it), while s.stdin is one end of an
// in-memory pipe whose drain goroutine closes stopSeen at EOF. stopSeen
// closing therefore proves a stop() has written its command and closed the
// handle — the action is verifiably inside the gate, waiting on the exit —
// which is what makes the contention tests deterministic rather than timed.
func fakeRunningServer(t *testing.T, s *ServerService) (release func(), stopSeen chan struct{}) {
	t.Helper()
	cmd := consumeStdinCommand(t)
	procStdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}

	pr, pw := io.Pipe()
	stopSeen = make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, pr) //nolint:errcheck // drain until EOF; EOF is the signal
		close(stopSeen)
	}()

	s.mu.Lock()
	s.cmd = cmd
	s.stdin = pw
	s.running = true
	s.serverID = "srv1"
	s.exited = make(chan struct{})
	s.expectedStop = false
	s.mu.Unlock()
	go s.waitForExit()

	var once sync.Once
	release = func() { once.Do(func() { procStdin.Close() }) }
	t.Cleanup(release)
	return release, stopSeen
}

// The gate half of issue #109: with a stop mid-flight, a second Stop must
// fail fast with the sentinel instead of writing into a closed stdin and
// scheduling a second killTree.
func TestConcurrentStopsSecondFailsFast(t *testing.T) {
	s, _ := newServerFixture()
	release, stopSeen := fakeRunningServer(t, s)

	errCh := make(chan error, 1)
	go func() { errCh <- s.Stop() }()

	select {
	case <-stopSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("first Stop never reached its stdin close")
	}

	if err := s.Stop(); !errors.Is(err, ErrPowerActionInProgress) {
		t.Fatalf("second Stop = %v, want ErrPowerActionInProgress", err)
	}

	release()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("first Stop = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first Stop never returned")
	}

	if s.IsRunning() {
		t.Error("IsRunning() = true after Stop completed")
	}
	// The gate must be released again: a third Stop reports the ordinary
	// not-running error, not contention.
	if err := s.Stop(); !errors.Is(err, errServerNotRunning) {
		t.Errorf("third Stop = %v, want errServerNotRunning", err)
	}
}

// Restart holds the gate across both legs, so a second Restart (the double
// click) fails fast — and its stop leg must be marked expected, or every
// restart would raise a crash notification.
func TestRestartBackToBackSecondFailsFast(t *testing.T) {
	s, bus := newServerFixture()
	fakeLaunch(t, s)
	stops := collect(bus, EventServerStopped)
	release, stopSeen := fakeRunningServer(t, s)

	dir := t.TempDir()
	errCh := make(chan error, 1)
	go func() { errCh <- s.Restart("srv1", "", nil, dir) }()

	select {
	case <-stopSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("restart's stop leg never reached its stdin close")
	}

	if err := s.Restart("srv1", "", nil, dir); !errors.Is(err, ErrPowerActionInProgress) {
		t.Fatalf("second Restart = %v, want ErrPowerActionInProgress", err)
	}

	release()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Restart = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Restart never returned")
	}

	if !s.IsRunning() {
		t.Fatal("IsRunning() = false after Restart")
	}

	events := waitForCount(t, stops, 1)
	payload, ok := events[0].(models.ServerStopped)
	if !ok {
		t.Fatalf("server:stopped payload is %T, want models.ServerStopped", events[0])
	}
	if !payload.Expected {
		t.Error("restart's stop leg emitted Expected=false — a crash notification for a deliberate restart")
	}

	if err := s.Stop(); err != nil {
		t.Errorf("cleanup Stop = %v, want nil", err)
	}
}

// The decided half of #109: Restart on a stopped server is a plain start,
// not the old "server not running" dead end.
func TestRestartFromStoppedIsAPlainStart(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	if err := s.Restart("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Restart from stopped = %v, want nil", err)
	}
	if !s.IsRunning() {
		t.Fatal("IsRunning() = false after Restart from stopped")
	}
	if got := s.ActiveServerID(); got != "srv1" {
		t.Errorf("ActiveServerID() = %q, want srv1", got)
	}
	if err := s.Stop(); err != nil {
		t.Errorf("cleanup Stop = %v, want nil", err)
	}
}

// The ordering half of #109: exited must close only after the stopped state
// is visible, or Restart's start leg races a stale running flag and fails
// with "server already running".
func TestExitedObservesStoppedState(t *testing.T) {
	s, _ := newServerFixture()
	startForExit(t, s, exitingCommand(t, 0), true)
	s.mu.Lock()
	s.running = true
	exited := s.exited
	s.mu.Unlock()

	go s.waitForExit()

	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("exited never closed")
	}
	if s.IsRunning() {
		t.Error("IsRunning() = true after exited closed — the pre-#109 restart race")
	}
	if got := s.GetLastStop(); !got.Expected {
		t.Errorf("GetLastStop() = %+v, want Expected:true", got)
	}
}

// Start on a running server is still refused by the inner check when the gate
// is free (defense in depth — it also guards #110's future gate-bypassing
// kill path), and the refusal releases the gate.
func TestStartWhileRunningRefused(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)

	err := s.Start("srv2", "", nil, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "server already running") {
		t.Fatalf("Start while running = %v, want 'server already running'", err)
	}

	s.mu.Lock()
	exited := s.exited
	s.mu.Unlock()
	release()
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("process never exited")
	}
	// The refusal released the gate: the next action reports ordinary state,
	// not contention.
	if err := s.Stop(); !errors.Is(err, errServerNotRunning) {
		t.Errorf("Stop after teardown = %v, want errServerNotRunning", err)
	}
}

// Pins the exact string: callers catch and ignore it by content today (the
// backups tile's stop-and-back-up, beforeClose's benign race).
func TestStopWhenNotRunningKeepsItsError(t *testing.T) {
	s, _ := newServerFixture()
	err := s.Stop()
	if err == nil || err.Error() != "server not running" {
		t.Fatalf("Stop on stopped = %v, want exactly 'server not running'", err)
	}
}
