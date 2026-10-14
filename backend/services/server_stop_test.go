package services

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// recordKillTree replaces the killTree seam with a recorder. The fixture
// children lack the Setpgid/Job setup a real boot gets (the genuine group
// kill would be an ESRCH no-op against them), so the seam records the pid and
// runs each onKill hook instead — typically the fixture's release(), standing
// in for the SIGKILL actually ending the process.
func recordKillTree(t *testing.T, s *ServerService, onKill ...func()) func() []int {
	t.Helper()
	var mu sync.Mutex
	var pids []int
	s.killTree = func(pid int) {
		mu.Lock()
		pids = append(pids, pid)
		mu.Unlock()
		for _, f := range onKill {
			f()
		}
	}
	return func() []int {
		mu.Lock()
		defer mu.Unlock()
		return append([]int{}, pids...)
	}
}

func consoleLines(s *ServerService) []string {
	history := s.GetConsoleHistory(fixtureServerID)
	lines := make([]string, len(history))
	for i, l := range history {
		lines[i] = l.Line
	}
	return lines
}

// The bug behind issue #110: a fixed 8-second grace could SIGKILL a large
// world mid-save. A stop that outlives the grace must narrate both stages in
// the console and only then kill, still marked expected all the way.
func TestStopEscalatesThroughBannersToKill(t *testing.T) {
	s, _ := newServerFixture()
	release, _ := fakeRunningServer(t, s)
	kills := recordKillTree(t, s, release)

	wantPid := curInst(s).cmd.Process.Pid
	if err := s.Stop(fixtureServerID, 80*time.Millisecond); err != nil {
		t.Fatalf("Stop = %v, want nil", err)
	}

	lines := consoleLines(s)
	warnAt, killAt := -1, -1
	for i, line := range lines {
		if strings.Contains(line, "Still waiting for the server to stop") {
			warnAt = i
		}
		if strings.Contains(line, "Server did not stop within") {
			killAt = i
		}
		if strings.Contains(line, "exited unexpectedly") {
			t.Errorf("crash banner on a deliberate escalated stop: %q", line)
		}
	}
	if warnAt == -1 || killAt == -1 || warnAt >= killAt {
		t.Fatalf("escalation banners missing or out of order (warn %d, kill %d): %v", warnAt, killAt, lines)
	}

	if got := kills(); len(got) != 1 || got[0] != wantPid {
		t.Errorf("killTree calls = %v, want exactly [%d]", got, wantPid)
	}
	if got := s.GetLastStop(fixtureServerID); !got.Expected {
		t.Errorf("GetLastStop() = %+v, want Expected:true", got)
	}
	if got := s.State(fixtureServerID); got != "offline" {
		t.Errorf("State() = %q, want offline", got)
	}
}

// The acceptance case's other half: a stop that finishes inside the grace
// stays silent — no warning, no kill, no killTree call.
func TestStopWithinGraceWritesNoBanners(t *testing.T) {
	s, _ := newServerFixture()
	release, stopSeen := fakeRunningServer(t, s)
	kills := recordKillTree(t, s)

	errCh := make(chan error, 1)
	go func() { errCh <- s.Stop(fixtureServerID, time.Hour) }()

	select {
	case <-stopSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop never reached its stdin close")
	}
	release()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Stop = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Stop never returned")
	}

	for _, line := range s.GetConsoleHistory(fixtureServerID) {
		if line.Source == sourceManager {
			t.Errorf("banner on a stop that finished inside the grace: %q", line.Line)
		}
	}
	if got := kills(); len(got) != 0 {
		t.Errorf("killTree called %v times on a graceful stop, want none", got)
	}
}

// The acceptance case: Force stop works while a graceful stop is wedged
// inside the power gate. It bypasses the gate, kills the tree, and both
// calls come home — with the stopping transition deduplicated and the stop
// still expected.
func TestForceStopWhileGracefulStopWedged(t *testing.T) {
	s, bus := newServerFixture()
	states := collect(bus, EventServerState)
	release, stopSeen := fakeRunningServer(t, s)
	kills := recordKillTree(t, s, release)

	errCh := make(chan error, 1)
	go func() { errCh <- s.Stop(fixtureServerID, time.Hour) }()

	select {
	case <-stopSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("graceful Stop never reached its stdin close")
	}

	if err := s.ForceStop(fixtureServerID); err != nil {
		t.Fatalf("ForceStop while a stop holds the gate = %v, want nil", err)
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("graceful Stop = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("graceful Stop never returned after the force kill")
	}

	if got := kills(); len(got) != 1 {
		t.Errorf("killTree calls = %v, want exactly one (the force kill)", got)
	}
	seen := stateNames(t, waitForCount(t, states, 2))
	if seen["stopping"] != 1 || seen["offline"] != 1 {
		t.Errorf("state events = %v, want stopping and offline exactly once each", seen)
	}
	if got := s.GetLastStop(fixtureServerID); !got.Expected {
		t.Errorf("GetLastStop() = %+v, want Expected:true — a force stop is deliberate", got)
	}

	var banner bool
	for _, line := range consoleLines(s) {
		if strings.Contains(line, "Force stopping") {
			banner = true
		}
	}
	if !banner {
		t.Error("no force-stop banner in the console history")
	}
}

// A missing process is a successful force stop (Wings §5): its purpose is
// "make it dead", and dead already is success, not an error toast.
func TestForceStopWhenOfflineIsIdempotent(t *testing.T) {
	s, bus := newServerFixture()
	states := collect(bus, EventServerState)

	if err := s.ForceStop(fixtureServerID); err != nil {
		t.Fatalf("ForceStop on an offline server = %v, want nil", err)
	}
	if events := states(); len(events) != 0 {
		t.Errorf("saw %d server:state events, want none", len(events))
	}
	if lines := consoleLines(s); len(lines) != 0 {
		t.Errorf("console history = %v, want empty", lines)
	}
}

// Force stop from a boot that never reached ready still passes through
// stopping (the crash-detection shield) and never claims running.
func TestForceStopFromStartingPassesThroughStopping(t *testing.T) {
	s, bus := newServerFixture()
	fakeLaunch(t, s)
	states := collect(bus, EventServerState)

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start = %v, want nil", err)
	}
	// ForceStop closes the launch's real stdin pipe, which ends the
	// stdin-consuming fixture process; the seam only records.
	kills := recordKillTree(t, s)

	if err := s.ForceStop(fixtureServerID); err != nil {
		t.Fatalf("ForceStop = %v, want nil", err)
	}

	seen := stateNames(t, waitForCount(t, states, 3))
	for _, want := range []string{"starting", "stopping", "offline"} {
		if seen[want] != 1 {
			t.Errorf("saw %q %d times, want exactly once (all: %v)", want, seen[want], seen)
		}
	}
	if seen["running"] != 0 {
		t.Errorf("a force stop from starting claimed running: %v", seen)
	}
	if got := kills(); len(got) != 1 {
		t.Errorf("killTree calls = %v, want exactly one", got)
	}
	if got := s.GetLastStop(fixtureServerID); !got.Expected {
		t.Errorf("GetLastStop() = %+v, want Expected:true", got)
	}
}

// With a free gate, ForceStop's TryLock succeeds and holds it for the whole
// kill: a concurrent power action fails fast instead of interleaving.
func TestForceStopWithFreeGateExcludesOtherActions(t *testing.T) {
	s, _ := newServerFixture()
	release, _ := fakeRunningServer(t, s)

	var raced error
	recordKillTree(t, s, func() {
		// Runs while ForceStop holds powerMu (its TryLock succeeded on the
		// free gate), so this deterministically observes the exclusion.
		raced = s.Stop(fixtureServerID, 0)
	}, release)

	if err := s.ForceStop(fixtureServerID); err != nil {
		t.Fatalf("ForceStop = %v, want nil", err)
	}
	if !errors.Is(raced, ErrPowerActionInProgress) {
		t.Errorf("Stop during a force stop = %v, want ErrPowerActionInProgress", raced)
	}
}

const crashLine = "[12:22:45] [Server thread/ERROR]: Encountered an unexpected exception\n"

// A server that has written a crash report is not saving a world any more, and
// the JVM left behind can hang in its shutdown for good. A stop after the crash
// line waits crashedStopGrace rather than the configured grace, says why, and
// kills as usual.
func TestStopAfterCrashLineUsesShortGrace(t *testing.T) {
	s, _ := newServerFixture()
	release, _ := fakeRunningServer(t, s)
	kills := recordKillTree(t, s, release)
	s.crashedStopGrace = 60 * time.Millisecond

	curInst(s).streamOutput(strings.NewReader(crashLine + crashLine))

	start := time.Now()
	if err := s.Stop(fixtureServerID, 10*time.Minute); err != nil {
		t.Fatalf("Stop = %v, want nil", err)
	}
	if waited := time.Since(start); waited > 2*time.Second {
		t.Fatalf("stop after a crash waited %s, want about the short grace", waited)
	}

	crashBanners, graceBanner := 0, false
	for _, line := range consoleLines(s) {
		if strings.Contains(line, "Server crashed; a stop now force kills") {
			crashBanners++
		}
		if strings.Contains(line, "Server already crashed, force killing the process tree in 60ms") {
			graceBanner = true
		}
	}
	if crashBanners != 1 {
		t.Errorf("crash banner narrated %d times, want once for two crash lines", crashBanners)
	}
	if !graceBanner {
		t.Errorf("short-grace banner missing from %v", consoleLines(s))
	}
	if got := kills(); len(got) != 1 {
		t.Errorf("killTree calls = %v, want exactly one", got)
	}
	if got := s.State(fixtureServerID); got != "offline" {
		t.Errorf("State() = %q, want offline", got)
	}
}

// The short grace only ever shortens: a quit's own 8 s stays what it was, so a
// crashed server never makes the app wait longer to close.
func TestStopAfterCrashLineKeepsAShorterGrace(t *testing.T) {
	s, _ := newServerFixture()
	release, _ := fakeRunningServer(t, s)
	recordKillTree(t, s, release)
	s.crashedStopGrace = 10 * time.Second

	curInst(s).streamOutput(strings.NewReader(crashLine))

	start := time.Now()
	if err := s.Stop(fixtureServerID, 80*time.Millisecond); err != nil {
		t.Fatalf("Stop = %v, want nil", err)
	}
	if waited := time.Since(start); waited > 2*time.Second {
		t.Fatalf("stop waited %s, want the caller's 80ms grace", waited)
	}
	for _, line := range consoleLines(s) {
		if strings.Contains(line, "Server already crashed") {
			t.Errorf("short-grace banner on a grace that was already shorter: %q", line)
		}
	}
}

// start() clears the flag, so a crash on one boot does not shorten the next
// boot's stop: the fixture crashes and stops, then a real Start through the
// launch seam boots again.
func TestCrashFlagClearsOnNextBoot(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)
	recordKillTree(t, s, release)

	curInst(s).streamOutput(strings.NewReader(crashLine))
	if err := s.Stop(fixtureServerID, 50*time.Millisecond); err != nil {
		t.Fatalf("Stop = %v", err)
	}
	if !curInst(s).crashed {
		t.Fatal("flag cleared by the stop; it should survive until the next start")
	}

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start = %v", err)
	}
	curInst(s).mu.Lock()
	crashed := curInst(s).crashed
	curInst(s).mu.Unlock()
	if crashed {
		t.Error("crash flag survived into the next boot")
	}
	if err := s.Stop(fixtureServerID, 0); err != nil {
		t.Errorf("cleanup Stop = %v, want nil", err)
	}
}
