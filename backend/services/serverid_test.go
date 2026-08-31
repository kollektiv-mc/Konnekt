package services

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// The defect #239 fixes, from the outside: with one server running and another
// named, every one of these used to answer about the running one.
//
// "srv2" is never started in these tests, so it is the stopped server the UI
// would be showing while srv1 runs.
const otherServerID = "srv2"

func TestStatusAnswersForTheServerItNames(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)
	t.Cleanup(release)

	if got := s.Status(fixtureServerID); !got.Running {
		t.Error("the running server reports not running")
	}
	other := s.Status(otherServerID)
	if other.Running {
		t.Error("a stopped server reports running — status is answering for whichever server is up")
	}
	if other.Uptime != "0s" || other.State != "offline" {
		t.Errorf("stopped server status = %+v, want offline with 0s uptime", other)
	}
}

// An unknown id and a known-but-never-started one must answer identically, so
// there is no second definition of "offline" to drift from the first.
func TestStatusOfAnUnknownServerMatchesANeverStartedOne(t *testing.T) {
	s, _ := newServerFixture()
	known := s.Status(otherServerID)
	unknown := s.Status("never-heard-of-it")
	if known != unknown {
		t.Errorf("unknown %+v != never-started %+v", unknown, known)
	}
	if known.Running {
		t.Error("a server that has never started reports running")
	}
}

func TestStopTargetsTheServerItNames(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)
	// A short grace and a kill stand-in so a regression fails on the assertion
	// below rather than hanging: if this stop reaches the running server, it waits
	// on an exit the fixture's child will not produce on its own.
	recordKillTree(t, s, release)

	// Stopping a different server must not touch the running one.
	if err := s.Stop(otherServerID, 50*time.Millisecond); !errors.Is(err, errServerNotRunning) {
		t.Fatalf("Stop(other) = %v, want errServerNotRunning", err)
	}
	if !s.IsRunning(fixtureServerID) {
		t.Error("stopping a different server stopped the running one")
	}
}

// Restarting B while A runs used to stop A and boot B, because the stop leg went
// through the ambient current instance. It is a refusal now, the same one Start
// gives.
func TestRestartRefusesWhileAnotherServerRuns(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)
	// Same reason as TestStopTargetsTheServerItNames: without the kill stand-in a
	// regression waits out the grace instead of reaching the assertion.
	recordKillTree(t, s, release)

	err := s.Restart(otherServerID, "", nil, t.TempDir(), 50*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "server already running") {
		t.Fatalf("Restart(other) = %v, want 'server already running'", err)
	}
	if !s.IsRunning(fixtureServerID) {
		t.Error("restarting a different server stopped the running one")
	}
}

// Quitting has no server id to give, so it must stop whatever is up even when
// that is not the server the UI had selected. Getting this wrong skips the
// graceful stop and loses the world save.
func TestStopRunningStopsAServerThatIsNotCurrent(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)
	// The fixture's child ignores the stdin stop and its process group is not the
	// real one, so the genuine killTree would no-op and the stop would wait out
	// its grace forever. Stand in for the SIGKILL, as the other stop tests do.
	recordKillTree(t, s, release)

	// Point current somewhere else, as selecting another server in the sidebar
	// would.
	s.setCurrent(s.instanceFor(otherServerID))

	if err := s.StopRunning(50 * time.Millisecond); err != nil {
		t.Fatalf("StopRunning = %v", err)
	}
	if s.IsRunning(fixtureServerID) {
		t.Error("the running server survived a quit-time stop because it was not the selected one")
	}
}

func TestRosterIsEmptyForAServerThatIsNotRunning(t *testing.T) {
	s, _ := newServerFixture()
	fakeLaunch(t, s)
	release, _ := fakeRunningServer(t, s)
	t.Cleanup(release)

	in := s.instanceFor(fixtureServerID)
	in.playersMu.Lock()
	in.players["Alex"] = playerSession{}
	in.playersMu.Unlock()

	if got := s.PlayerCount(fixtureServerID); got != 1 {
		t.Fatalf("running server player count = %d, want 1", got)
	}
	if got := s.PlayerCount(otherServerID); got != 0 {
		t.Errorf("stopped server player count = %d, want 0 — the roster is reading the running server", got)
	}
	if got := s.GetActivePlayers(otherServerID); len(got) != 0 {
		t.Errorf("stopped server roster lists %d players from another server", len(got))
	}
}

// A backup of B narrated into whichever console was current, so A's console
// reported work on a server it had nothing to do with.
func TestNarrationLandsInTheNamedServersConsole(t *testing.T) {
	s, _ := newServerFixture()
	s.Narrate(otherServerID, "backing up the other server")

	if hasLine(s.GetConsoleHistory(fixtureServerID), "backing up the other server") {
		t.Error("narration for one server reached another server's console")
	}
	if !hasLine(s.GetConsoleHistory(otherServerID), "backing up the other server") {
		t.Error("narration did not reach the console of the server it named")
	}
}

func TestStatsHistoryIsPerServer(t *testing.T) {
	stats, server, _ := newStatsFixture()
	in := curInst(server)
	in.mu.Lock()
	in.running = true
	in.startTime = time.Now()
	in.mu.Unlock()

	stats.tick()

	id := server.CurrentServerID()
	if got := stats.GetStatsHistory(id); len(got) != 1 {
		t.Fatalf("history for the sampled server = %d entries, want 1", len(got))
	}
	if got := stats.GetStatsHistory(otherServerID); len(got) != 0 {
		t.Errorf("history for another server = %d entries, want 0 — the ring is shared", len(got))
	}
	if stats.GetStatsHistory(otherServerID) == nil {
		t.Error("empty history is nil, which marshals to null rather than [] across Wails")
	}
}
