package services

import (
	"io"
	"os/exec"
	"sync"
	"time"

	"konnekt/backend/models"

	"github.com/shirou/gopsutil/v4/process"
)

// instanceDeps is the wiring a serverInstance shares with its manager: the two
// collaborators and the four test seams. Held by pointer and embedded in both
// ServerService and serverInstance.
//
// Shared rather than copied into each instance, because the seams' documented
// contract is "never reassigned outside NewServerService and tests" and the
// tests reassign them *after* an instance exists — server_stop_test.go's
// recordKillTree runs after fakeRunningServer, and
// TestPrepareForBackupNarratesTheQuiesce sets quiesceWait after it. A value
// copied at construction would miss every one of those writes, and the failure
// would be a test that silently exercises the production seam instead of its
// double.
//
// It also keeps the extraction a receiver rename: every moved method body still
// spells these s.bus, s.rcon, s.launchCmd, s.startingTimeout, s.killTree and
// s.quiesceWait, so the moved code diffs as unchanged.
//
// Unguarded, exactly as these fields were on the singleton: written by
// NewServerService, by the SetBus/SetRcon wiring at startup, and by tests before
// the action under test. Never mid-flight.
type instanceDeps struct {
	bus  *EventBus
	rcon *RconService

	// launchCmd builds the child process for start(). A test seam in the #115
	// spirit: NewServerService wires defaultLaunchCmd (java PATH check +
	// resolveLaunch + exec.Command), tests substitute a short-lived shell
	// process so power-action tests run without java.
	launchCmd func(jarPath, workingDir string, jvmArgs []string) (*exec.Cmd, error)

	// startingTimeout is how long a boot may sit in starting before
	// watchStarting promotes it (startingDeadline in production).
	startingTimeout time.Duration

	// killTree is the platform process-tree kill (server_windows.go /
	// server_other.go), behind a seam like launchCmd: the test fixtures'
	// children lack the Setpgid/Job setup a real boot gets, so the genuine
	// group kill would no-op there.
	killTree func(pid int)

	// quiesceWait is how long PrepareForBackup gives a stdin save-all to flush
	// when RCON is unavailable and there is nothing to block on.
	quiesceWait time.Duration
}

// serverInstance is one configured server's runtime: its process, the console
// and roster around it, and the lifecycle machine over it. ServerService is the
// manager that owns a map of these, keyed by server id (#232, the first step of
// #57).
//
// An instance deliberately **outlives its process**. Before this split there was
// one console ring for the whole app and start() cleared it on every boot, so
// starting server B destroyed server A's output. A retained instance is what
// lets each server keep its own console to replay. start() still clears *this*
// instance's ring on each boot, so re-booting one server reads exactly as it
// always did — and until #233 gives the getters a server id, the other rings are
// simply unreachable rather than visibly different. #232 builds the storage,
// #233 exposes it.
//
// It holds no reference to its manager, and that is what makes the lock order
// unbreakable rather than merely documented: instance code cannot name
// ServerService.mu, so it cannot take it.
type serverInstance struct {
	*instanceDeps

	// id is the configured server this instance belongs to and the manager's
	// map key. Kept so the instance can describe itself, and so ActiveServerID
	// has something to return.
	id string

	// --- mu: the process, the lifecycle machine, and what start() reads off
	// disk. The outermost of this instance's four locks.
	mu           sync.Mutex
	cmd          *exec.Cmd
	stdin        io.WriteCloser
	running      bool
	startTime    time.Time
	exited       chan struct{} // closed by waitForExit when the child process exits
	state        serverState
	expectedStop bool
	lastStop     models.ServerStopped

	// stats fields — set on Start, read by accessors
	maxRAMMB   int
	maxPlayers int

	// RCON config — read from server.properties on Start
	rconEnabled  bool
	rconAddr     string
	rconPassword string

	// cached gopsutil process handle — set on Start, cleared on exit
	cachedProc *process.Process

	// TPS poll goroutine lifecycle. stopTPS is written under mu by
	// startTPSPollLocked; stopTPSPoll reads it inside tpsOnce.Do, which is what
	// orders the close rather than mu — waitForExit calls it without mu held.
	// Left exactly as it was: the Once is the guarantee, and tightening it here
	// would be a behaviour change smuggled into a move.
	stopTPS chan struct{}
	tpsOnce sync.Once

	// Windows Job Object handle (uintptr so this compiles cross-platform).
	// When non-zero, the OS kills the entire Java process tree automatically if
	// Konnekt exits for any reason (crash, SIGKILL, etc.). Written by createJob
	// under mu and by closeJob without it; the two are ordered by the process
	// lifetime rather than by a lock, exactly as before.
	job uintptr

	// --- playersMu
	playersMu  sync.RWMutex
	players    map[string]playerSession // online players
	presession map[string]playerSession // pre-join accumulator (UUID/IP before "joined the game")

	// --- tpsMu: live TPS. -1 means unknown / RCON unavailable; tpsLastUpdate
	// tracks freshness. rconFlavor sat under the poll-lifecycle comment on the
	// singleton but has always been guarded by tpsMu (queryTPSViaRcon,
	// stopTPSPoll); it is filed correctly here, with no code change.
	tpsMu         sync.RWMutex
	currentTPS    float64
	tpsLastUpdate time.Time
	rconFlavor    string // "paper", "forge", "vanilla", or "" (unknown — re-detect next poll)

	// --- logTPSMu: log-derived TPS fallback (always active while running)
	logTPSMu       sync.RWMutex
	logTPS         float64
	logLastWarning time.Time

	// --- logBufMu: console ring for remote-client backfill on connect
	// (GetConsoleHistory). Cap is fixed (consoleCap), independent of the
	// frontend's consoleBufferLines setting; loadHistory re-clamps on display.
	// Cleared on each Start, never on stop.
	logBuf   []models.ConsoleLine
	logBufMu sync.RWMutex
}

// newServerInstance builds an inert instance: no goroutine, no channel, no
// handle until boot. It carries exactly the initialisations NewServerService
// used to do inline, so CurrentTPS still reports -1 before any boot.
func newServerInstance(id string, deps *instanceDeps) *serverInstance {
	return &serverInstance{
		instanceDeps: deps,
		id:           id,
		players:      make(map[string]playerSession),
		presession:   make(map[string]playerSession),
		currentTPS:   -1,
		logTPS:       -1,
	}
}
