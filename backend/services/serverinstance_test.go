package services

import (
	"errors"
	"os/exec"
	"strings"
	"testing"
	"time"

	"konnekt/backend/models"
)

// The point of #232: an instance outlives its process, so one server's console
// is no longer destroyed by the next server's boot.
//
// Before the split there was a single ring and start() cleared it, so the line
// asserted below was simply gone once srv2 started. The public getter still
// answers for the current server — #232 builds the storage, #233 is what gives
// the getters a server id to reach the rest of it.
func TestStoppedInstanceKeepsItsConsole(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	release, _ := fakeRunningServer(t, s)
	srv1 := s.instanceFor(fixtureServerID)
	srv1.emitConsoleLine("srv1 said something")

	release()
	waitStopped(t, srv1)

	if err := s.Start("srv2", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start srv2: %v", err)
	}
	t.Cleanup(func() { _ = s.StopRunning(0) }) //nolint:errcheck // teardown

	// Re-resolved through the map rather than reusing the pointer above, so this
	// pins that the manager *retained* the instance, not merely that the object
	// still exists because the test is holding it.
	if !hasLine(s.instanceFor(fixtureServerID).GetConsoleHistory(), "srv1 said something") {
		t.Error("srv1's console was cleared by srv2's boot — the whole point of the split")
	}
	// And the getter now names its server, so srv2's console is srv2's alone.
	// Before #239 this asked whichever instance was current and could not have
	// told the two apart.
	if hasLine(s.GetConsoleHistory("srv2"), "srv1 said something") {
		t.Error("srv2's console carries srv1's output; the getter answers for the server it names")
	}
}

// Booting the *same* server again still clears its ring, exactly as the single
// ring always did. Retention is across servers, not across boots.
func TestRebootingTheSameServerClearsItsConsole(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	release, _ := fakeRunningServer(t, s)
	srv1 := s.instanceFor(fixtureServerID)
	srv1.emitConsoleLine("first boot")
	release()
	waitStopped(t, srv1)

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start srv1 again: %v", err)
	}
	t.Cleanup(func() { _ = s.StopRunning(0) }) //nolint:errcheck // teardown

	if hasLine(s.GetConsoleHistory(fixtureServerID), "first boot") {
		t.Error("re-booting a server kept its previous session's console; start() must still clear the ring")
	}
}

// The crash-detection guard for a reused instance. expectedStop is now a field
// that survives from the previous stop, so start()'s reset of it is load-bearing
// in a way it was not when every boot met a freshly-cleared singleton: without
// it, a server that crashes after a clean stop would be reported as an expected
// shutdown and the user would never be told.
func TestReusedInstanceResetsExpectedStop(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	// First boot, stopped deliberately: marks expectedStop true.
	release, _ := fakeRunningServer(t, s)
	srv1 := s.instanceFor(fixtureServerID)
	srv1.mu.Lock()
	srv1.expectedStop = true
	srv1.mu.Unlock()
	release()
	waitStopped(t, srv1)

	if !s.GetLastStop(fixtureServerID).Expected {
		t.Fatal("fixture did not record the deliberate stop")
	}

	// Second boot of the same instance, killed without marking intent.
	release2, _ := fakeRunningServer(t, s)
	srv1.mu.Lock()
	srv1.expectedStop = false // what start() does; asserted separately below
	srv1.mu.Unlock()
	release2()
	waitStopped(t, srv1)

	if s.GetLastStop(fixtureServerID).Expected {
		t.Error("a crash on a reused instance reported as expected — stale expectedStop")
	}
}

// start() must clear expectedStop on a reused instance. Asserted directly
// rather than through a crash, so a regression names the field.
func TestStartClearsExpectedStopOnAReusedInstance(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	in := s.instanceFor(fixtureServerID)
	in.mu.Lock()
	in.expectedStop = true
	in.mu.Unlock()

	if err := s.Start("srv1", "", nil, t.TempDir()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = s.StopRunning(0) }) //nolint:errcheck // teardown

	in.mu.Lock()
	stale := in.expectedStop
	in.mu.Unlock()
	if stale {
		t.Error("expectedStop survived a boot; a later crash would report as expected")
	}
}

// A refused start must not change what the id-less getters answer with. The
// pre-split code cleared the console only after cmd.Start() succeeded, so a
// failed boot left the console, the RCON config and max-players alone; the
// manager reproduces that by putting current back.
func TestFailedStartLeavesTheReadableStateAlone(t *testing.T) {
	s, _ := newServerFixture()
	s.Narrate(fixtureServerID, "something worth keeping")

	s.launchCmd = func(string, string, []string) (*exec.Cmd, error) {
		return nil, errors.New("no java here")
	}

	if err := s.Start("srv1", "", nil, t.TempDir()); err == nil {
		t.Fatal("Start = nil error, want the launch failure")
	}
	if !hasLine(s.GetConsoleHistory(fixtureServerID), "something worth keeping") {
		t.Error("a failed start moved the console off the instance the UI was reading")
	}
}

// A retained instance must be inert: every goroutine a boot spawns is scoped to
// that boot, so keeping the instance around cannot accumulate them.
func TestRetainedInstanceLeavesNoGoroutineRunning(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)

	release, _ := fakeRunningServer(t, s)
	in := s.instanceFor(fixtureServerID)
	release()
	waitStopped(t, in)

	in.mu.Lock()
	stop := in.stopTPS
	in.mu.Unlock()
	if stop != nil {
		select {
		case <-stop:
		default:
			t.Error("the TPS poller's stop channel is still open on a retained instance")
		}
	}
	in.mu.Lock()
	proc := in.cachedProc
	in.mu.Unlock()
	if proc != nil {
		t.Error("cachedProc survived the exit on a retained instance")
	}
}

// Two servers, two instances, one map.
func TestInstanceForIsKeyedAndStable(t *testing.T) {
	s, _ := newServerFixture()
	a, b := s.instanceFor(fixtureServerID), s.instanceFor("srv2")
	if a == b {
		t.Fatal("two ids returned the same instance")
	}
	if again := s.instanceFor(fixtureServerID); again != a {
		t.Error("instanceFor is not stable for one id")
	}
	if a.id != "srv1" || b.id != "srv2" {
		t.Errorf("ids = %q/%q, want srv1/srv2", a.id, b.id)
	}
}

func hasLine(history []models.ConsoleLine, want string) bool {
	for _, l := range history {
		if strings.Contains(l.Line, want) {
			return true
		}
	}
	return false
}

// waitStopped blocks until this boot's teardown has fully finished.
//
// It waits on the exited channel rather than polling IsRunning, and the
// difference is load-bearing: waitForExit clears running partway through, then
// goes on to narrate, emit server:stopped and only close exited last — the
// ordering #109's restart race turned on. Polling the flag therefore returns
// while waitForExit is still reading the instance's cmd, and a test that starts
// the next boot at that moment races the teardown of the previous one. stop()
// synchronises on exactly this channel for the same reason.
func waitStopped(t *testing.T, in *serverInstance) {
	t.Helper()
	in.mu.Lock()
	exited := in.exited
	in.mu.Unlock()
	if exited == nil {
		t.Fatal("instance was never booted, so it has no exit to wait for")
	}
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		t.Fatal("instance never stopped")
	}
}
