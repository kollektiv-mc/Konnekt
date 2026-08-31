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

// fixtureServerID is the server the fixtures below boot and claim. Named rather
// than repeated as a literal because every id-taking call in these tests has to
// name the same one the fixture claimed, and a typo would silently address an
// inert instance instead of failing.
const fixtureServerID = "srv1"

// curInst is the instance a fixture's manager currently answers from: the
// per-server runtime these tests used to read straight off ServerService before
// it moved to serverInstance (#232).
//
// Deliberately resolved at each use rather than hoisted into a local. A
// successful Start swaps the manager's current instance from the bootstrap one
// to the one keyed by the server id, so a handle captured before a Start would
// go on inspecting the wrong instance — silently, since both are valid objects.
// TestTPSPollRearmsAcrossBoots is where that would bite first.
func curInst(s *ServerService) *serverInstance { return s.cur() }

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
	curInst(s).streamOutput(strings.NewReader(giant + "\n[12:00:00] [Server thread/INFO]: Done (1.2s)!\n"))

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

	curInst(s).streamOutput(strings.NewReader("Preparing spawn area: 10%\rPreparing spawn area: 20%\rPreparing spawn area: 30%\n"))

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

	curInst(s).streamOutput(strings.NewReader(input))

	events := waitForCount(t, joined, 1)
	m, ok := events[0].(map[string]string)
	if !ok {
		t.Fatalf("player:joined payload is %T, want map[string]string", events[0])
	}
	if m["name"] != "Alex" || m["ip"] != "127.0.0.1" {
		t.Errorf("player:joined payload = %v, want name Alex ip 127.0.0.1", m)
	}
	waitForCount(t, eula, 1)

	curInst(s).playersMu.RLock()
	sess, online := curInst(s).players["Alex"]
	curInst(s).playersMu.RUnlock()
	if !online {
		t.Error("Alex missing from the players map")
	} else if sess.uuid != "069a79f4-44e9-4726-a5be-fca90e38aaf5" {
		t.Errorf("Alex's uuid = %q", sess.uuid)
	}

	curInst(s).mu.Lock()
	expected := curInst(s).expectedStop
	state := curInst(s).state
	curInst(s).mu.Unlock()
	if !expected {
		t.Error("'Stopping the server' did not set expectedStop")
	}
	// The intent flag is unconditional, the state transition is not: this
	// fixture never started, so the stopping line must not move it off offline
	// (a late buffered line cannot drag a torn-down machine back to stopping).
	if state != stateOffline {
		t.Errorf("state = %v after a stopping line on a never-started fixture, want offline", state)
	}
}

// A real Paper server with a chat plugin, which is where this broke: the join
// and leave broadcasts arrive wrapped in ANSI colour, Paper's console prefix
// is "[HH:MM:SS INFO]:" rather than log4j's "[HH:MM:SS] [thread/INFO]:", and
// the login line comes *after* the join broadcast instead of before it. The
// lines are verbatim from the report, escapes included.
func TestStreamOutputTracksPaperColouredSession(t *testing.T) {
	s, bus := newServerFixture()
	joined := collect(bus, EventPlayerJoined)
	left := collect(bus, EventPlayerLeft)

	input := strings.Join([]string{
		"[17:22:56 INFO]: UUID of player Snadrochka is 5d818448-9c12-4adb-b41b-bda6a2d5938d",
		"[17:22:59 INFO]: \x1b[38;2;255;255;85mSnadrochka joined the game\x1b[0m",
		"[17:22:59 INFO]: Snadrochka[/127.0.0.1:62436] logged in with entity id 86 at ([world]-18.44, 79.74, 41.76)",
		"[17:23:35 INFO]: <\x1b[38;2;170;0;0mSnadrochka\x1b[0m> test",
	}, "\n")

	curInst(s).streamOutput(strings.NewReader(input))

	events := waitForCount(t, joined, 1)
	// Exactly one: the join broadcast and the login line both signal a join,
	// and only the first of them may emit.
	if len(events) != 1 {
		t.Fatalf("player:joined fired %d times for one connection, want 1", len(events))
	}
	m, ok := events[0].(map[string]string)
	if !ok {
		t.Fatalf("player:joined payload is %T, want map[string]string", events[0])
	}
	if m["name"] != "Snadrochka" {
		t.Errorf("player:joined name = %q, want Snadrochka", m["name"])
	}

	if got := s.PlayerCount(); got != 1 {
		t.Errorf("PlayerCount() = %d, want 1 — this is the count the overview, performance and stats history all read", got)
	}
	roster := s.GetActivePlayers()
	if len(roster) != 1 {
		t.Fatalf("GetActivePlayers() returned %d players, want 1", len(roster))
	}
	if roster[0].UUID != "5d818448-9c12-4adb-b41b-bda6a2d5938d" {
		t.Errorf("roster uuid = %q", roster[0].UUID)
	}
	// The IP arrives on a line Paper prints after the join, so it has to land
	// on the live session rather than on the pre-join entry the join consumed.
	if roster[0].IP != "127.0.0.1" {
		t.Errorf("roster ip = %q, want 127.0.0.1", roster[0].IP)
	}
	curInst(s).playersMu.RLock()
	stale := len(curInst(s).presession)
	curInst(s).playersMu.RUnlock()
	if stale != 0 {
		t.Errorf("presession holds %d stale entries after a completed join, want 0", stale)
	}

	// Paper prints the core disconnect line first, then the coloured
	// broadcast. Both are leave signals; only the first may emit.
	curInst(s).streamOutput(strings.NewReader(strings.Join([]string{
		"[17:40:00 INFO]: Snadrochka lost connection: Disconnected",
		"[17:40:00 INFO]: \x1b[38;2;255;255;85mSnadrochka left the game\x1b[0m",
	}, "\n")))

	events = waitForCount(t, left, 1)
	if len(events) != 1 {
		t.Fatalf("player:left fired %d times for one disconnect, want 1", len(events))
	}
	if got := s.PlayerCount(); got != 0 {
		t.Errorf("PlayerCount() = %d after the disconnect, want 0", got)
	}
}

// The coloured broadcast on its own, with no login line to fall back on: this
// is the isolated stripANSI path, and without the strip nothing here matches
// and the player is never recorded at all.
func TestStreamOutputMatchesColouredBroadcastWithoutLoginLine(t *testing.T) {
	s, bus := newServerFixture()
	joined := collect(bus, EventPlayerJoined)
	left := collect(bus, EventPlayerLeft)

	curInst(s).streamOutput(strings.NewReader(
		"[17:22:59 INFO]: \x1b[38;2;255;255;85mSnadrochka joined the game\x1b[0m\n"))

	waitForCount(t, joined, 1)
	if got := s.PlayerCount(); got != 1 {
		t.Fatalf("PlayerCount() = %d after a coloured join broadcast, want 1", got)
	}

	curInst(s).streamOutput(strings.NewReader(
		"[17:40:00 INFO]: \x1b[38;2;255;255;85mSnadrochka left the game\x1b[0m\n"))

	waitForCount(t, left, 1)
	if got := s.PlayerCount(); got != 0 {
		t.Errorf("PlayerCount() = %d after a coloured leave broadcast, want 0", got)
	}
}

// The console tile renders what log:line carries, so the escapes have to be
// gone by the time the line is emitted, not merely ignored by the matchers.
func TestStreamOutputEmitsConsoleLinesWithoutEscapes(t *testing.T) {
	s, bus := newServerFixture()
	lines := collect(bus, EventLogLine)

	curInst(s).streamOutput(strings.NewReader(
		"[17:10:36 INFO]: [Essentials] \x1b[38;2;255;170;0mFetching version information...\x1b[0m\n"))

	events := waitForCount(t, lines, 1)
	got := logPayload(t, events[0])
	want := "[17:10:36 INFO]: [Essentials] Fetching version information..."
	if got != want {
		t.Errorf("log:line = %q, want %q", got, want)
	}
}

// A connection that drops before joining logs the same "lost connection" line
// as a real disconnect. Nobody was online, so nothing may be announced.
func TestStreamOutputIgnoresLostConnectionForPlayerWhoNeverJoined(t *testing.T) {
	s, bus := newServerFixture()
	left := collect(bus, EventPlayerLeft)

	curInst(s).streamOutput(strings.NewReader(strings.Join([]string{
		"[17:22:56 INFO]: UUID of player Alex is 069a79f4-44e9-4726-a5be-fca90e38aaf5",
		"[17:22:57 INFO]: Alex lost connection: Internal Exception",
	}, "\n")))

	if events := left(); len(events) != 0 {
		t.Errorf("player:left fired %d times for a login that never completed, want 0", len(events))
	}
	curInst(s).playersMu.RLock()
	online, stale := len(curInst(s).players), len(curInst(s).presession)
	curInst(s).playersMu.RUnlock()
	if online != 0 {
		t.Errorf("players holds %d entries, want 0", online)
	}
	if stale != 0 {
		t.Errorf("presession holds %d entries after a failed login, want 0", stale)
	}
}

// Manager narration is marked structurally, never by its wording: the console
// tile boxes it, dots it and excludes it from server-output pattern matching
// off the source marker, so a plugin printing "[Konnekt]" cannot pass for
// Konnekt (#113). The narration itself carries no tag at all any more — the
// marker is the whole identification, and the outcome is what the dot reads.
// The counter-half pins the zero value: server output carries neither key, so
// every path that predates the markers still reads as server output.
func TestNarrateMarksManagerLines(t *testing.T) {
	s, bus := newServerFixture()
	lines := collect(bus, EventLogLine)

	s.Narrate("something happened")
	curInst(s).emitConsoleLine("[12:00:00] [Server thread/INFO]: raw output")

	events := waitForCount(t, lines, 2)
	var sawManager, sawServer bool
	for _, ev := range events {
		m, ok := ev.(map[string]string)
		if !ok {
			t.Fatalf("log:line payload is %T, want map[string]string", ev)
		}
		switch m["source"] {
		case sourceManager:
			sawManager = true
			if m["line"] != "something happened" {
				t.Errorf("manager line = %q, want it carried verbatim with no tag", m["line"])
			}
			if m["outcome"] != outcomeProgress {
				t.Errorf("manager outcome = %q, want %q", m["outcome"], outcomeProgress)
			}
		case "":
			sawServer = true
			if _, present := m["source"]; present {
				t.Error("server output carries a source key, want it omitted entirely")
			}
			if _, present := m["outcome"]; present {
				t.Error("server output carries an outcome key, want it omitted entirely")
			}
		default:
			t.Errorf("unexpected source %q", m["source"])
		}
	}
	if !sawManager || !sawServer {
		t.Errorf("bus delivery incomplete: manager=%v server=%v", sawManager, sawServer)
	}

	history := s.GetConsoleHistory()
	if len(history) != 2 {
		t.Fatalf("ring buffer holds %d lines, want 2", len(history))
	}
	if history[0].Source != sourceManager {
		t.Errorf("buffered manager line Source = %q, want %q", history[0].Source, sourceManager)
	}
	if history[0].Outcome != outcomeProgress {
		t.Errorf("buffered manager line Outcome = %q, want %q", history[0].Outcome, outcomeProgress)
	}
	if history[1].Source != "" {
		t.Errorf("buffered server line Source = %q, want empty", history[1].Source)
	}
	if history[1].Outcome != "" {
		t.Errorf("buffered server line Outcome = %q, want empty", history[1].Outcome)
	}
}

// Each narration verb picks the outcome the console paints as its dot, so
// "finished" is green and "failed" is red without the UI reading the wording.
func TestNarrateVerbsCarryTheirOutcome(t *testing.T) {
	s, _ := newServerFixture()

	s.Narrate("working")
	s.NarrateDone("done")
	s.NarrateFailed("broke")

	want := []string{outcomeProgress, outcomeOK, outcomeFailed}
	history := s.GetConsoleHistory()
	if len(history) != len(want) {
		t.Fatalf("ring buffer holds %d lines, want %d", len(history), len(want))
	}
	for i, w := range want {
		if history[i].Outcome != w {
			t.Errorf("line %d (%q) Outcome = %q, want %q", i, history[i].Line, history[i].Outcome, w)
		}
	}
}

// The quiesce is narrated inside PrepareForBackup/ResumeSaves rather than at
// their three call sites, so a backup and a world duplication both explain
// the pause. Without RCON the flush wait is pure sleep, which is the case
// that most needs saying out loud.
func TestPrepareForBackupNarratesTheQuiesce(t *testing.T) {
	s, _ := newServerFixture()
	release, _ := fakeRunningServer(t, s)
	s.quiesceWait = time.Millisecond

	if !s.PrepareForBackup(fixtureServerID) {
		t.Fatal("PrepareForBackup on a running server = false, want true")
	}
	s.ResumeSaves(fixtureServerID)

	want := []string{
		"Pausing world saves and flushing to disk",
		"RCON unavailable, giving the save 1ms to flush",
		"Resuming world saves",
	}
	got := consoleLines(s)
	if len(got) != len(want) {
		t.Fatalf("console history = %v, want exactly %v", got, want)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("line %d = %q, want %q", i, got[i], w)
		}
	}

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

// Restraint: a stopped server has no saves to pause, so the quiesce no-ops
// and says nothing.
func TestPrepareForBackupWhileStoppedStaysSilent(t *testing.T) {
	s, _ := newServerFixture()

	if s.PrepareForBackup(fixtureServerID) {
		t.Error("PrepareForBackup on a stopped server = true, want false")
	}
	s.ResumeSaves(fixtureServerID)

	if lines := consoleLines(s); len(lines) != 0 {
		t.Errorf("console history = %v, want empty", lines)
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
	curInst(s).mu.Lock()
	curInst(s).cmd = cmd
	curInst(s).exited = make(chan struct{})
	curInst(s).expectedStop = expected
	curInst(s).mu.Unlock()
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
	curInst(s).waitForExit()

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
	curInst(s).waitForExit()

	if got := s.GetLastStop(); !got.Expected || got.ExitCode != 0 {
		t.Errorf("GetLastStop() = %+v, want {Expected:true ExitCode:0}", got)
	}
	for _, line := range s.GetConsoleHistory() {
		if line.Source == sourceManager {
			t.Errorf("console history holds a banner on a deliberate stop: %q", line.Line)
		}
	}
}

// consumeStdinCommand returns a process that exits when its stdin closes —
// stop()'s graceful path, with no killTree wait at the end of the grace.
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
// the test's hand (release closes it), while curInst(s).stdin is one end of an
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

	// Claim the instance for "srv1" and make it current, which is what a real
	// Start does before booting — the id is the map key now, not a field a
	// fixture can write (#232). Hoisted into a local deliberately: this is the
	// one place that wants the instance it just claimed rather than whatever is
	// current later.
	in := s.instanceFor(fixtureServerID)
	s.setCurrent(in)

	in.mu.Lock()
	in.cmd = cmd
	in.stdin = pw
	in.running = true
	in.exited = make(chan struct{})
	in.expectedStop = false
	in.state = stateRunning // direct write, not the setter: a fixture mirrors a ready boot without emitting
	in.mu.Unlock()
	go in.waitForExit()

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
	go func() { errCh <- s.Stop(fixtureServerID, 0) }()

	select {
	case <-stopSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("first Stop never reached its stdin close")
	}

	if err := s.Stop(fixtureServerID, 0); !errors.Is(err, ErrPowerActionInProgress) {
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

	if s.IsRunning(fixtureServerID) {
		t.Error("IsRunning() = true after Stop completed")
	}
	// The gate must be released again: a third Stop reports the ordinary
	// not-running error, not contention.
	if err := s.Stop(fixtureServerID, 0); !errors.Is(err, errServerNotRunning) {
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
	go func() { errCh <- s.Restart("srv1", "", nil, dir, 0) }()

	select {
	case <-stopSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("restart's stop leg never reached its stdin close")
	}

	if err := s.Restart("srv1", "", nil, dir, 0); !errors.Is(err, ErrPowerActionInProgress) {
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

	if !s.IsRunning(fixtureServerID) {
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

	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Errorf("cleanup Stop = %v, want nil", err)
	}
}

// The decided half of #109: Restart on a stopped server is a plain start,
// not the old "server not running" dead end.
func TestRestartFromStoppedIsAPlainStart(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	if err := s.Restart("srv1", "", nil, t.TempDir(), 0); err != nil {
		t.Fatalf("Restart from stopped = %v, want nil", err)
	}
	if !s.IsRunning(fixtureServerID) {
		t.Fatal("IsRunning() = false after Restart from stopped")
	}
	if got := s.ActiveServerID(); got != "srv1" {
		t.Errorf("ActiveServerID() = %q, want srv1", got)
	}
	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Errorf("cleanup Stop = %v, want nil", err)
	}
}

// The ordering half of #109: exited must close only after the stopped state
// is visible, or Restart's start leg races a stale running flag and fails
// with "server already running".
func TestExitedObservesStoppedState(t *testing.T) {
	s, _ := newServerFixture()
	startForExit(t, s, exitingCommand(t, 0), true)
	curInst(s).mu.Lock()
	curInst(s).running = true
	exited := curInst(s).exited
	curInst(s).mu.Unlock()

	go curInst(s).waitForExit()

	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("exited never closed")
	}
	if s.IsRunning(fixtureServerID) {
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

	curInst(s).mu.Lock()
	exited := curInst(s).exited
	curInst(s).mu.Unlock()
	release()
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("process never exited")
	}
	// The refusal released the gate: the next action reports ordinary state,
	// not contention.
	if err := s.Stop(fixtureServerID, 0); !errors.Is(err, errServerNotRunning) {
		t.Errorf("Stop after teardown = %v, want errServerNotRunning", err)
	}
}

// Pins the exact string: callers catch and ignore it by content today (the
// backups tile's stop-and-back-up, beforeClose's benign race).
func TestStopWhenNotRunningKeepsItsError(t *testing.T) {
	s, _ := newServerFixture()
	err := s.Stop(fixtureServerID, 0)
	if err == nil || err.Error() != "server not running" {
		t.Fatalf("Stop on stopped = %v, want exactly 'server not running'", err)
	}
}

// Summary reports the loader build from the install directory when it can, and
// falls back to the stored value only when the directory yields nothing —
// flagged as "config" so the UI can say it is not a live reading.
func TestSummaryLoaderVersion(t *testing.T) {
	installed := t.TempDir()
	neoForgeInstall(t, installed, "21.1.72")

	srv, _ := newServerFixture()

	for _, tc := range []struct {
		name       string
		cfg        models.ServerConfig
		wantVer    string
		wantSource string
	}{
		{
			name:       "detected from the install",
			cfg:        models.ServerConfig{ID: "a", WorkingDir: installed},
			wantVer:    "21.1.72",
			wantSource: "script",
		},
		{
			// The stored value is stale here on purpose: the disk is the truth.
			name:       "detection outranks a stored value",
			cfg:        models.ServerConfig{ID: "a", WorkingDir: installed, LoaderVersion: "21.1.9"},
			wantVer:    "21.1.72",
			wantSource: "script",
		},
		{
			name:       "stored value when the directory is gone",
			cfg:        models.ServerConfig{ID: "a", WorkingDir: t.TempDir(), LoaderVersion: "21.1.9"},
			wantVer:    "21.1.9",
			wantSource: "config",
		},
		{
			name:       "nothing known",
			cfg:        models.ServerConfig{ID: "a", WorkingDir: t.TempDir()},
			wantVer:    "",
			wantSource: "",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sum := srv.Summary(tc.cfg)
			if sum.LoaderVersion != tc.wantVer || sum.LoaderSource != tc.wantSource {
				t.Errorf("Summary loader = (%q, %q), want (%q, %q)",
					sum.LoaderVersion, sum.LoaderSource, tc.wantVer, tc.wantSource)
			}
		})
	}
}

func TestParseLoginAddress(t *testing.T) {
	cases := []struct {
		name string
		addr string
		want string
	}{
		{"ipv4", "127.0.0.1:54321", "127.0.0.1"},
		{"ipv4 routable", "203.0.113.9:25565", "203.0.113.9"},
		// JDK 14 and later bracket the literal (JDK-8225499).
		{"ipv6 bracketed loopback", "[0:0:0:0:0:0:0:1]:54321", "::1"},
		{"ipv6 bracketed global", "[2001:db8::1]:25565", "2001:db8::1"},
		// Before that there were no brackets and the port ran straight on, the
		// shape Minecraft's own MC-13120 was filed about.
		{"ipv6 unbracketed loopback", "0:0:0:0:0:0:0:1:54321", "::1"},
		{"ipv6 unbracketed already compressed", "::1:54321", "::1"},
		{"ipv4 mapped normalises to v4", "[::ffff:127.0.0.1]:54321", "127.0.0.1"},
		// Not addresses. The caller keeps the join and drops the IP.
		{"hostname", "example.com:25565", ""},
		{"empty", "", ""},
		{"port only", ":25565", ""},
		{"garbage", "not-an-address", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseLoginAddress(tc.addr); got != tc.want {
				t.Errorf("parseLoginAddress(%q) = %q, want %q", tc.addr, got, tc.want)
			}
		})
	}
}

// A Bedrock player behind Geyser and Floodgate. Their Java-side name carries
// Floodgate's default "." prefix, which the old \w+ name class could not match,
// so every Bedrock player on a crossplay server was invisible (#228).
func TestStreamOutputTracksBedrockPlayer(t *testing.T) {
	s, bus := newServerFixture()
	joined := collect(bus, EventPlayerJoined)
	left := collect(bus, EventPlayerLeft)

	curInst(s).streamOutput(strings.NewReader(strings.Join([]string{
		"[17:22:56 INFO]: UUID of player .Snadrochka is 00000000-0000-0000-0009-01f34a8b2c7d",
		"[17:22:59 INFO]: \x1b[38;2;255;255;85m.Snadrochka joined the game\x1b[0m",
		"[17:22:59 INFO]: .Snadrochka[/127.0.0.1:62436] logged in with entity id 86",
	}, "\n")))

	waitForCount(t, joined, 1)
	roster := s.GetActivePlayers()
	if len(roster) != 1 {
		t.Fatalf("GetActivePlayers() returned %d players, want 1", len(roster))
	}
	if roster[0].Name != ".Snadrochka" {
		t.Errorf("roster name = %q, want .Snadrochka", roster[0].Name)
	}
	if roster[0].UUID != "00000000-0000-0000-0009-01f34a8b2c7d" {
		t.Errorf("roster uuid = %q", roster[0].UUID)
	}
	if roster[0].IP != "127.0.0.1" {
		t.Errorf("roster ip = %q, want 127.0.0.1", roster[0].IP)
	}

	curInst(s).streamOutput(strings.NewReader(
		"[17:40:00 INFO]: \x1b[38;2;255;255;85m.Snadrochka left the game\x1b[0m\n"))

	waitForCount(t, left, 1)
	if got := s.PlayerCount(); got != 0 {
		t.Errorf("PlayerCount() = %d after the Bedrock player left, want 0", got)
	}
}

// The name sits directly against the "]: " anchor precisely so chat and plugin
// broadcasts cannot pass for a server line. Widening the name class for
// Bedrock prefixes must not have opened that up, so each of these has to
// register nobody at all.
func TestPlayerMatchersRejectSpoofedLines(t *testing.T) {
	cases := []struct {
		name string
		line string
	}{
		{"chat message quoting a join", "[12:00:00 INFO]: <Alex> Bob joined the game"},
		{"chat message quoting a leave", "[12:00:00 INFO]: <Alex> Bob left the game"},
		{"name-colon chat format", "[12:00:00 INFO]: Alex: joined the game"},
		{"rank tag before the name", "[12:00:00 INFO]: [Lobby] Bob joined the game"},
		{"chat quoting a disconnect", "[12:00:00 INFO]: <Alex> Bob lost connection: Disconnected"},
		{"chat quoting a login line", "[12:00:00 INFO]: <Alex> Bob[/127.0.0.1:1] logged in with entity id 1"},
		{"chat quoting a uuid line", "[12:00:00 INFO]: <Alex> UUID of player Bob is 069a79f4-44e9-4726-a5be-fca90e38aaf5"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newServerFixture()
			curInst(s).streamOutput(strings.NewReader(tc.line + "\n"))

			// Both maps, not just the count: a spoof that only reached the
			// pre-join accumulator would still be a spoof that landed.
			curInst(s).playersMu.RLock()
			online, pre := len(curInst(s).players), len(curInst(s).presession)
			curInst(s).playersMu.RUnlock()
			if online != 0 {
				t.Errorf("%q put %d players online", tc.line, online)
			}
			if pre != 0 {
				t.Errorf("%q created %d pre-join entries", tc.line, pre)
			}
		})
	}
}

// An IPv6 client, in both the shapes the JDK has printed (#229). The old
// dotted-quad pattern matched neither, so the address was lost and the line
// was no use as a join signal either.
func TestStreamOutputReadsIPv6LoginAddress(t *testing.T) {
	cases := []struct {
		name string
		line string
		want string
	}{
		{
			name: "bracketed, JDK 14 and later",
			line: "[12:00:00 INFO]: Alex[/[0:0:0:0:0:0:0:1]:54321] logged in with entity id 261",
			want: "::1",
		},
		{
			name: "unbracketed, before JDK 14",
			line: "[12:00:00 INFO]: Alex[/0:0:0:0:0:0:0:1:54321] logged in with entity id 261",
			want: "::1",
		},
		{
			name: "global address",
			line: "[12:00:00 INFO]: Alex[/[2001:db8::1]:25565] logged in with entity id 261",
			want: "2001:db8::1",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, bus := newServerFixture()
			joined := collect(bus, EventPlayerJoined)

			curInst(s).streamOutput(strings.NewReader(tc.line + "\n"))

			waitForCount(t, joined, 1)
			roster := s.GetActivePlayers()
			if len(roster) != 1 {
				t.Fatalf("GetActivePlayers() returned %d players, want 1", len(roster))
			}
			if roster[0].IP != tc.want {
				t.Errorf("roster ip = %q, want %q", roster[0].IP, tc.want)
			}
		})
	}
}

// The login line is a join signal first and an address second, so an address
// that will not parse costs the IP and nothing else.
func TestStreamOutputRegistersJoinWhenLoginAddressIsUnreadable(t *testing.T) {
	s, bus := newServerFixture()
	joined := collect(bus, EventPlayerJoined)

	curInst(s).streamOutput(strings.NewReader(
		"[12:00:00 INFO]: Alex[/proxy.example.com:25565] logged in with entity id 261\n"))

	waitForCount(t, joined, 1)
	roster := s.GetActivePlayers()
	if len(roster) != 1 {
		t.Fatalf("GetActivePlayers() returned %d players, want 1", len(roster))
	}
	if roster[0].Name != "Alex" {
		t.Errorf("roster name = %q, want Alex", roster[0].Name)
	}
	if roster[0].IP != "" {
		t.Errorf("roster ip = %q, want empty for an address that does not parse", roster[0].IP)
	}
}
