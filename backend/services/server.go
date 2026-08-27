package services

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"konnekt/backend/models"

	"github.com/shirou/gopsutil/v4/process"
)

const consoleCap = 2000

// sourceManager marks a console line Konnekt itself narrated, as opposed to
// server process output (#113). It is the ConsoleLine.Source value and the
// log:line payload's source key.
const sourceManager = "manager"

// ErrPowerActionInProgress is returned when a power action (start, stop,
// restart) arrives while another one is still in progress. The message is
// shown verbatim in the UI, so keep it a readable sentence.
var ErrPowerActionInProgress = errors.New("another power action is in progress")

// errServerNotRunning backs Stop's long-standing "server not running" message
// so Restart can tell "nothing to stop, skip the leg" from a real stop
// failure. The exact string is a contract: frontend callers catch and ignore
// it (the backups tile's stop-and-back-up, beforeClose's benign race).
var errServerNotRunning = errors.New("server not running")

var (
	rePlayerJoin  = regexp.MustCompile(`]: (\w+) joined the game`)
	rePlayerLeave = regexp.MustCompile(`]: (\w+) left the game`)
	rePlayerUUID  = regexp.MustCompile(`]: UUID of player (\w+) is ([0-9a-f-]{36})`)
	rePlayerLogin = regexp.MustCompile(`]: (\w+)\[/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+\] logged in`)
	reTPSPaper    = regexp.MustCompile(`TPS from.*?:\s*[*‡]*\s*(\d+(?:\.\d+)?)`)
	reTPSForge    = regexp.MustCompile(`(?i)Mean TPS:\s*(\d+(?:\.\d+)?)`)
	reTickQuery   = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*ms\s*per tick`)
	reServerStop  = regexp.MustCompile(`(?i)Stopping the server`)
	// reServerReady is the Minecraft "Done (3.541s)!" ready line, shared by
	// vanilla, Fabric, Quilt, Paper/Purpur and Forge/NeoForge (their log
	// prefixes differ, the Done line does not). Anchored on "]: " like the
	// player matchers so a chat message ("]: <Alex> Done (1s)!") cannot spoof
	// readiness; [0-9.,] tolerates locale comma decimals. Case-sensitive on
	// purpose — every flavor capitalizes Done.
	reServerReady = regexp.MustCompile(`]: Done \([0-9.,]+s\)!`)
)

// startingDeadline bounds the starting state — the timeout Wings lacks: a
// ready line that never matches (an exotic flavor, an old log format) must
// resolve, not sit in starting forever. Generous on purpose: first-boot
// worldgen on slow hardware legitimately takes minutes. Too long only means a
// pill that says Starting longer; too short means falsely claiming ready.
const startingDeadline = 10 * time.Minute

// stopGraceDefault bounds a graceful stop when no configured grace reaches
// stop() (a zero from an unreadable settings file, tests passing 0). 60s
// replaces the old fixed 8s, which a large world save could legitimately
// exceed — getting killed mid-save for it (#110). maxStopGrace caps a wild
// settings value at Wings' own user-stop deadline.
const (
	stopGraceDefault = 60 * time.Second
	maxStopGrace     = 10 * time.Minute
)

// playerSession holds per-session data captured from log lines.
type playerSession struct {
	uuid string
	ip   string
}

// serverState is the lifecycle vocabulary (#108), closed at four states.
// The zero value is offline on purpose: tests construct bare &ServerService{}
// values, and a service that has never started a server is offline.
type serverState int

const (
	stateOffline serverState = iota
	stateStarting
	stateRunning
	stateStopping
)

func (st serverState) String() string {
	switch st {
	case stateStarting:
		return "starting"
	case stateRunning:
		return "running"
	case stateStopping:
		return "stopping"
	default:
		return "offline"
	}
}

type ServerService struct {
	ctx       context.Context
	mu        sync.Mutex
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	running   bool
	startTime time.Time
	serverID  string
	exited    chan struct{} // closed by waitForExit when the child process exits

	playersMu  sync.RWMutex
	players    map[string]playerSession // online players
	presession map[string]playerSession // pre-join accumulator (UUID/IP before "joined the game")

	// stats fields — set on Start, read by accessors
	maxRAMMB   int
	maxPlayers int

	// RCON config — read from server.properties on Start
	rconEnabled  bool
	rconAddr     string
	rconPassword string

	// live TPS — -1 means unknown / RCON unavailable; tpsLastUpdate tracks freshness
	tpsMu         sync.RWMutex
	currentTPS    float64
	tpsLastUpdate time.Time

	// TPS poll goroutine lifecycle
	stopTPS    chan struct{}
	tpsOnce    sync.Once
	rcon       *RconService
	rconFlavor string // "paper", "forge", "vanilla", or "" (unknown — re-detect next poll)

	// log-derived TPS fallback (always active while server is running)
	logTPSMu       sync.RWMutex
	logTPS         float64
	logLastWarning time.Time

	// cached gopsutil process handle — set on Start, cleared on exit
	cachedProc *process.Process

	// console ring buffer for remote-client backfill on connect (GetConsoleHistory).
	// Cap is fixed (consoleCap), independent of the frontend's consoleBufferLines
	// setting; loadHistory re-clamps on display. Cleared on each Start.
	logBuf   []models.ConsoleLine
	logBufMu sync.RWMutex

	bus *EventBus

	// Windows Job Object handle (uintptr so server.go compiles cross-platform).
	// When non-zero, the OS kills the entire Java process tree automatically
	// if Konnekt exits for any reason (crash, SIGKILL, etc.).
	job uintptr

	// expectedStop is set to true when the server is being stopped intentionally
	// (via Stop(), app quit, or the server's own "Stopping the server" log line).
	// waitForExit reads it to emit {expected} in the server:stopped payload.
	expectedStop bool

	// lastStop is the most recent server:stopped payload, kept so GetLastStop
	// can serve it as that event's readable getter twin.
	lastStop models.ServerStopped

	// Power-action gate (#109), launch seam and lifecycle state (#108).
	// Per-instance state: all of it moves wholesale into #57's serverInstance
	// when that extraction lands.
	//
	// powerMu serializes Start, Stop and Restart end-to-end; Restart holds it
	// across both legs. Acquired fail-fast only (TryLock): a second power
	// action gets ErrPowerActionInProgress instead of queueing. waitForExit,
	// the crash path, never touches it, so a dying process tears down freely
	// even mid-action. ForceStop (#110) deliberately bypasses it: TryLock,
	// proceed regardless, unlock only if that TryLock succeeded — its reason
	// to exist is a graceful stop wedged inside the gate.
	powerMu sync.Mutex

	// launchCmd builds the child process for start(). A test seam in the #115
	// spirit: NewServerService wires defaultLaunchCmd (java PATH check +
	// resolveLaunch + exec.Command), tests substitute a short-lived shell
	// process so power-action tests run without java. Never reassigned outside
	// NewServerService and tests.
	launchCmd func(jarPath, workingDir string, jvmArgs []string) (*exec.Cmd, error)

	// state is the lifecycle machine's current value, guarded by mu and moved
	// only through setStateLocked so every actual change emits server:state
	// exactly once. Running stays the "process alive" flag; state refines it
	// with the starting and stopping phases.
	state serverState

	// startingTimeout is how long a boot may sit in starting before
	// watchStarting promotes it (startingDeadline in production). A test seam
	// in the launchCmd spirit: never reassigned outside NewServerService and
	// tests.
	startingTimeout time.Duration

	// killTree is the platform process-tree kill (server_windows.go /
	// server_other.go), behind a seam like launchCmd: the test fixtures'
	// children lack the Setpgid/Job setup a real boot gets, so the genuine
	// group kill would no-op there. Never reassigned outside NewServerService
	// and tests.
	killTree func(pid int)
}

func NewServerService() *ServerService {
	return &ServerService{
		players:         make(map[string]playerSession),
		presession:      make(map[string]playerSession),
		currentTPS:      -1,
		logTPS:          -1,
		launchCmd:       defaultLaunchCmd,
		startingTimeout: startingDeadline,
		killTree:        killTree,
	}
}

// defaultLaunchCmd is the production launchCmd: require java on PATH, resolve
// the launch arguments, and build the java process rooted in workingDir.
func defaultLaunchCmd(jarPath, workingDir string, jvmArgs []string) (*exec.Cmd, error) {
	if _, err := exec.LookPath("java"); err != nil {
		return nil, fmt.Errorf("java not found in PATH — install Java and ensure it is accessible")
	}
	args, err := resolveLaunch(jarPath, workingDir, jvmArgs)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command("java", args...)
	if workingDir != "" {
		cmd.Dir = workingDir
	}
	return cmd, nil
}

func (s *ServerService) SetContext(ctx context.Context) {
	s.ctx = ctx
}

func (s *ServerService) SetRcon(r *RconService) {
	s.rcon = r
}

func (s *ServerService) SetBus(b *EventBus) {
	s.bus = b
}

func (s *ServerService) Start(serverID string, jarPath string, jvmArgs []string, workingDir string) error {
	if !s.powerMu.TryLock() {
		return ErrPowerActionInProgress
	}
	defer s.powerMu.Unlock()
	return s.start(serverID, jarPath, jvmArgs, workingDir)
}

// Restart stops then starts under one continuous gate hold, so no other power
// action can slip between the legs. On a stopped server the stop leg is
// skipped: restart-from-stopped is a plain start (#109 owner decision), which
// also covers a server that crashed between the gate and the stop leg.
// grace bounds the stop leg exactly as it does Stop's.
func (s *ServerService) Restart(serverID string, jarPath string, jvmArgs []string, workingDir string, grace time.Duration) error {
	if !s.powerMu.TryLock() {
		return ErrPowerActionInProgress
	}
	defer s.powerMu.Unlock()
	if err := s.stop(grace); err != nil && !errors.Is(err, errServerNotRunning) {
		return err
	}
	return s.start(serverID, jarPath, jvmArgs, workingDir)
}

// start is Start without the power gate. Callers hold powerMu.
func (s *ServerService) start(serverID string, jarPath string, jvmArgs []string, workingDir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Defense in depth behind the gate: also guards ForceStop's path, which
	// deliberately bypasses powerMu (#110).
	if s.running {
		return fmt.Errorf("server already running")
	}

	cmd, err := s.launchCmd(jarPath, workingDir, jvmArgs)
	if err != nil {
		return err
	}
	s.cmd = cmd
	s.exited = make(chan struct{})

	stdin, err := s.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	s.stdin = stdin

	stdout, err := s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	stderr, err := s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	configureProcAttr(s.cmd) // platform process-group/job setup, must precede Start

	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start server: %w", err)
	}
	s.createJob() // tie Java process tree to this process lifetime via OS job object

	s.running = true
	s.startTime = time.Now()
	s.serverID = serverID
	s.expectedStop = false
	s.setStateLocked(stateStarting, false)

	s.logBufMu.Lock()
	s.logBuf = s.logBuf[:0]
	s.logBufMu.Unlock()

	// Parse RAM total from JVM args. A NeoForge/Forge install keeps its -Xmx in
	// user_jvm_args.txt, so fall back to that rather than parseXmx's 2048 default.
	// Konnekt's own args go first — parseXmx takes the first -Xmx it can read, and
	// the UI setting is the one that wins at the JVM too (see spliceJVMArgs).
	effectiveArgs := make([]string, 0, len(jvmArgs)+4)
	effectiveArgs = append(effectiveArgs, jvmArgs...)
	effectiveArgs = append(effectiveArgs, userJVMArgs(workingDir)...)
	s.maxRAMMB = parseXmx(effectiveArgs)

	// Read server.properties for max-players and RCON config
	props, _ := readProperties(filepath.Join(workingDir, "server.properties"))
	s.maxPlayers = propInt(props, "max-players", 20)

	rconPort := propInt(props, "rcon.port", 25575)
	s.rconEnabled = props["enable-rcon"] == "true"
	s.rconAddr = fmt.Sprintf("localhost:%d", rconPort)
	s.rconPassword = props["rcon.password"]

	// Cache gopsutil process handle for CPU% sampling
	if p, err := process.NewProcess(int32(s.cmd.Process.Pid)); err == nil {
		s.cachedProc = p
		// Prime the first measurement so subsequent Percent(0) calls return a delta
		_, _ = p.Percent(0) //nolint:errcheck // priming call; return value intentionally unused
	}

	// Reset TPS state
	s.tpsMu.Lock()
	s.currentTPS = -1
	s.tpsLastUpdate = time.Time{}
	s.tpsMu.Unlock()
	s.logTPSMu.Lock()
	s.logTPS = 20.0
	s.logLastWarning = time.Time{}
	s.logTPSMu.Unlock()

	// TPS polling starts at the running transition (enterRunningLocked), not
	// here: the Done line is the real signal that RCON is up, where the old
	// fixed 15s post-spawn delay was a guess.

	go s.streamOutput(stdout)
	go s.streamOutput(stderr)
	go s.waitForExit()
	go s.watchStarting(s.exited)

	s.bus.Emit(EventServerStarted, nil)
	return nil
}

func (s *ServerService) streamOutput(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, maxConsoleLine), maxConsoleLine)
	scanner.Split(newConsoleSplitFunc(maxConsoleLine))
	for scanner.Scan() {
		line := scanner.Text()

		s.emitConsoleLine(line)

		if strings.Contains(strings.ToLower(line), "eula.txt") {
			s.bus.Emit(EventEulaRequired, nil)
		}

		if reServerStop.MatchString(line) {
			s.mu.Lock()
			// The flag write is unconditional (any spelling of a deliberate
			// shutdown marks intent); the state transition is gated so a late
			// buffered line cannot drag an already-offline machine back to
			// stopping.
			s.expectedStop = true
			if s.state == stateStarting || s.state == stateRunning {
				s.setStateLocked(stateStopping, false)
			}
			s.mu.Unlock()
		}

		if reServerReady.MatchString(line) {
			s.mu.Lock()
			// Gated on starting: output from a stopping or offline process is
			// never a ready signal, so a late buffered Done line cannot
			// resurrect a stopped server.
			if s.state == stateStarting {
				s.enterRunningLocked(false)
			}
			s.mu.Unlock()
		}

		if m := rePlayerUUID.FindStringSubmatch(line); m != nil {
			name, uuid := m[1], m[2]
			s.playersMu.Lock()
			sess := s.presession[name]
			sess.uuid = uuid
			s.presession[name] = sess
			s.playersMu.Unlock()
		} else if m := rePlayerLogin.FindStringSubmatch(line); m != nil {
			name, ip := m[1], m[2]
			s.playersMu.Lock()
			sess := s.presession[name]
			sess.ip = ip
			s.presession[name] = sess
			s.playersMu.Unlock()
		} else if m := rePlayerJoin.FindStringSubmatch(line); m != nil {
			name := m[1]
			s.playersMu.Lock()
			s.players[name] = s.presession[name]
			ip := s.presession[name].ip
			delete(s.presession, name)
			s.playersMu.Unlock()
			s.bus.Emit(EventPlayerJoined, map[string]string{"name": name, "ip": ip})
		} else if m := rePlayerLeave.FindStringSubmatch(line); m != nil {
			name := m[1]
			s.playersMu.Lock()
			delete(s.players, name)
			delete(s.presession, name)
			s.playersMu.Unlock()
			s.bus.Emit(EventPlayerLeft, map[string]string{"name": name})
		}
		if strings.Contains(line, "Can't keep up") {
			s.logTPSMu.Lock()
			s.logTPS = 10.0
			s.logLastWarning = time.Now()
			s.logTPSMu.Unlock()
		}
	}
	// waitForExit's cmd.Wait() can close the pipes before these readers drain,
	// so ErrClosed is ordinary teardown on every stop, not a defect.
	if err := scanner.Err(); err != nil && !errors.Is(err, os.ErrClosed) {
		slog.Error("console: stream scan", "error", err)
	}
}

// Narrate speaks as Konnekt in the console (#113): the daemon tag plus the
// source marker the UI styles apart from server output, so a manager line is
// never mistaken for something the server printed. Exported because app.go
// narrates the EULA write; Wails binds App methods only, so this adds no IPC
// surface. Reserve it for lifecycle moments — the notification feed keeps its
// own role, and chatter here costs the console its usefulness.
func (s *ServerService) Narrate(line string) {
	s.emitConsoleLineTagged("[Konnekt] "+line, sourceManager)
}

// emitConsoleLine sends one line of server output down the console channel.
func (s *ServerService) emitConsoleLine(line string) {
	s.emitConsoleLineTagged(line, "")
}

// emitConsoleLineTagged sends one line down the console channel: the log:line
// event plus the ring buffer GetConsoleHistory replays to late subscribers.
// The source key is omitted entirely when empty, so server output travels
// exactly the payload it always has.
// NB: emit precedes buffer append. A remote client that snapshots
// GetConsoleHistory then subscribes must dedup/order the seam line.
func (s *ServerService) emitConsoleLineTagged(line, source string) {
	ts := time.Now().Format("15:04:05")
	payload := map[string]string{"timestamp": ts, "line": line}
	if source != "" {
		payload["source"] = source
	}
	s.bus.Emit(EventLogLine, payload)
	s.logBufMu.Lock()
	if len(s.logBuf) >= consoleCap {
		s.logBuf = s.logBuf[1:]
	}
	s.logBuf = append(s.logBuf, models.ConsoleLine{Timestamp: ts, Line: line, Source: source})
	s.logBufMu.Unlock()
}

// exitLabel renders an exit code for the console banner. -1 is os/exec's
// marker for a signal kill, so name that rather than showing the number.
func exitLabel(code int) string {
	if code == -1 {
		return "killed by a signal"
	}
	return fmt.Sprintf("exit code %d", code)
}

func (s *ServerService) waitForExit() {
	// Reap the process and keep its exit status: it is the single most useful
	// JVM crash diagnostic. -1 means killed by a signal (or unobtainable),
	// matching os.ProcessState.ExitCode.
	exitCode := 0
	if s.cmd != nil {
		err := s.cmd.Wait()
		if ps := s.cmd.ProcessState; ps != nil {
			exitCode = ps.ExitCode()
		} else if err != nil {
			exitCode = -1
		}
	}
	s.closeJob()

	s.playersMu.Lock()
	s.players = make(map[string]playerSession)
	s.presession = make(map[string]playerSession)
	s.playersMu.Unlock()

	s.stopTPSPoll()

	s.mu.Lock()
	expected := s.expectedStop
	s.running = false
	s.cachedProc = nil
	s.setStateLocked(stateOffline, false)
	stop := models.ServerStopped{Expected: expected, ExitCode: exitCode}
	s.lastStop = stop
	s.mu.Unlock()
	if !expected {
		s.Narrate("Server process exited unexpectedly (" + exitLabel(exitCode) + ")")
	}
	s.bus.Emit(EventServerStopped, stop)

	// Closed dead last: anyone unblocked by <-exited (Stop's wait, Restart's
	// stop leg) observes fully-torn-down state — running already false, the
	// stopped event already handed to the bus. Closing it earlier is the race
	// Restart used to lose, failing its own start leg with "server already
	// running" against a stale flag.
	close(s.exited)
}

// GetLastStop reports the most recent stop's detail, the readable getter twin
// of the server:stopped event payload. Zero value until a stop has happened.
func (s *ServerService) GetLastStop() models.ServerStopped {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastStop
}

// Stop shuts the server down gracefully, waiting up to grace for it to save
// and exit before force killing the process tree. grace <= 0 means the
// default; callers with a configured value (ConfigService.StopGrace) pass it
// through.
func (s *ServerService) Stop(grace time.Duration) error {
	if !s.powerMu.TryLock() {
		return ErrPowerActionInProgress
	}
	defer s.powerMu.Unlock()
	return s.stop(grace)
}

// stop is Stop without the power gate. Callers hold powerMu.
func (s *ServerService) stop(grace time.Duration) error {
	if grace <= 0 {
		grace = stopGraceDefault
	}
	if grace > maxStopGrace {
		grace = maxStopGrace
	}

	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return errServerNotRunning
	}

	s.expectedStop = true
	s.setStateLocked(stateStopping, false)

	if s.stdin != nil {
		_, _ = fmt.Fprintln(s.stdin, "stop") //nolint:errcheck // best-effort; the timeout + killTree fallback below is the real safety net
		s.stdin.Close()
		// Nil the handle so a SendCommand racing this shutdown gets a clean
		// "server not running" instead of a write on a closed pipe.
		s.stdin = nil
	}

	s.stopTPSPoll()

	pid := s.cmd.Process.Pid
	exited := s.exited
	s.mu.Unlock()

	// Two-stage wait so a slow world save is narrated instead of looking like
	// a hang: a warning at half the grace, the kill at its end (#110). The
	// state stays stopping throughout; waitForExit flips it offline.
	half := grace / 2
	select {
	case <-exited:
		return nil
	case <-time.After(half):
	}
	s.Narrate(fmt.Sprintf("Still waiting for the server to stop (%s before force kill)", grace-half))

	select {
	case <-exited:
		return nil
	case <-time.After(grace - half):
	}
	s.Narrate(fmt.Sprintf("Server did not stop within %s, force killing the process tree", grace))
	s.killTree(pid)
	<-exited
	return nil
}

// ForceStop kills the server process tree immediately, the escape hatch for
// a graceful stop that is wedged. It bypasses the power gate on purpose:
// TryLock so a free gate is still claimed (keeping Start/Restart out for the
// duration), proceed regardless when a stop already holds it, unlock only if
// this call's own TryLock succeeded.
//
// A missing process is a successful force stop — deliberately unlike Stop's
// pinned "server not running" error — because this call's contract is "make
// it dead", and dead already is success. No stopTPSPoll here: waitForExit
// runs it during the teardown this kill triggers, and it stays the single
// writer of the offline transition, the stopped payload and the exited close.
func (s *ServerService) ForceStop() error {
	if s.powerMu.TryLock() {
		defer s.powerMu.Unlock()
	}

	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	s.expectedStop = true
	s.setStateLocked(stateStopping, false) // no-op if a graceful stop got here first
	if s.stdin != nil {
		s.stdin.Close()
		s.stdin = nil
	}
	pid := s.cmd.Process.Pid
	exited := s.exited
	s.mu.Unlock()

	s.Narrate("Force stopping: killing the server process tree")
	s.killTree(pid)
	<-exited
	return nil
}

func (s *ServerService) stopTPSPoll() {
	s.tpsOnce.Do(func() {
		if s.stopTPS != nil {
			close(s.stopTPS)
		}
	})
	s.tpsMu.Lock()
	s.currentTPS = -1
	s.tpsLastUpdate = time.Time{}
	s.rconFlavor = "" // reset so next server start re-detects flavor
	s.tpsMu.Unlock()
	s.logTPSMu.Lock()
	s.logTPS = -1
	s.logLastWarning = time.Time{}
	s.logTPSMu.Unlock()
}

// pollTPS samples TPS over RCON every 15s, starting immediately: it is spawned
// at the running transition (startTPSPollLocked), so the first query lands at
// readiness rather than after the old arbitrary post-spawn delay. stop is this
// boot's own channel, passed in rather than re-read from the struct so a later
// boot's re-arm never races this goroutine's select.
func (s *ServerService) pollTPS(stop chan struct{}) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		if tps, ok := s.queryTPSViaRcon(); ok {
			s.tpsMu.Lock()
			s.currentTPS = tps
			s.tpsLastUpdate = time.Now()
			s.tpsMu.Unlock()
		} else {
			s.tpsMu.Lock()
			s.tpsLastUpdate = time.Time{}
			s.tpsMu.Unlock()
		}

		select {
		case <-stop:
			return
		case <-ticker.C:
		}
	}
}

func (s *ServerService) queryTPSViaRcon() (float64, bool) {
	s.tpsMu.RLock()
	flavor := s.rconFlavor
	s.tpsMu.RUnlock()

	// Snapshot the RCON coordinates once: start() rewrites them under s.mu on
	// every boot, and this runs on the poller goroutine.
	s.mu.Lock()
	addr, pw := s.rconAddr, s.rconPassword
	s.mu.Unlock()

	// Fast path: server flavor already known — one RCON call only.
	switch flavor {
	case "paper":
		resp, err := s.rcon.Execute(addr, pw, "tps")
		if err == nil {
			if m := reTPSPaper.FindStringSubmatch(resp); m != nil {
				if tps, e := strconv.ParseFloat(m[1], 64); e == nil {
					return math.Min(tps, 20.0), true
				}
			}
		}
		return 0, false
	case "forge":
		resp, err := s.rcon.Execute(addr, pw, "forge tps")
		if err == nil {
			if m := reTPSForge.FindStringSubmatch(resp); m != nil {
				if tps, e := strconv.ParseFloat(m[1], 64); e == nil {
					return math.Min(tps, 20.0), true
				}
			}
		}
		return 0, false
	case "vanilla":
		resp, err := s.rcon.Execute(addr, pw, "tick query")
		if err == nil {
			if m := reTickQuery.FindStringSubmatch(resp); m != nil {
				if mspt, e := strconv.ParseFloat(m[1], 64); e == nil && mspt > 0 {
					return math.Min(1000.0/mspt, 20.0), true
				}
			}
		}
		return 0, false
	}

	// Detection path: try each flavor in turn, cache the first that succeeds.
	// Paper/Spigot/Purpur: /tps → "TPS from last 1m, 5m, 15m: *20.0, 20.0, 20.0"
	resp, err := s.rcon.Execute(addr, pw, "tps")
	if err == nil {
		if m := reTPSPaper.FindStringSubmatch(resp); m != nil {
			if tps, e := strconv.ParseFloat(m[1], 64); e == nil {
				s.tpsMu.Lock()
				s.rconFlavor = "paper"
				s.tpsMu.Unlock()
				return math.Min(tps, 20.0), true
			}
		}
	}
	// NeoForge/Forge: /forge tps → "Mean TPS: 20.0 ..."
	resp, err = s.rcon.Execute(addr, pw, "forge tps")
	if err == nil {
		if m := reTPSForge.FindStringSubmatch(resp); m != nil {
			if tps, e := strconv.ParseFloat(m[1], 64); e == nil {
				s.tpsMu.Lock()
				s.rconFlavor = "forge"
				s.tpsMu.Unlock()
				return math.Min(tps, 20.0), true
			}
		}
	}
	// Vanilla 1.21+: /tick query → "Xms per tick"
	resp, err = s.rcon.Execute(addr, pw, "tick query")
	if err != nil {
		return 0, false
	}
	if m := reTickQuery.FindStringSubmatch(resp); m != nil {
		if mspt, e := strconv.ParseFloat(m[1], 64); e == nil && mspt > 0 {
			s.tpsMu.Lock()
			s.rconFlavor = "vanilla"
			s.tpsMu.Unlock()
			return math.Min(1000.0/mspt, 20.0), true
		}
	}
	return 0, false
}

func (s *ServerService) SendCommand(command string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running || s.stdin == nil {
		return errServerNotRunning
	}

	_, err := fmt.Fprintln(s.stdin, command)
	return err
}

func (s *ServerService) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// setStateLocked moves the lifecycle state machine (#108). Callers hold s.mu.
// Emits server:state only on an actual change, so subscribers never see a
// duplicate transition; emitting under the lock follows start()'s existing
// server:started emit (EventBus fans out in-process handlers in goroutines).
func (s *ServerService) setStateLocked(next serverState, timedOut bool) {
	if s.state == next {
		return
	}
	s.state = next
	s.bus.Emit(EventServerState, models.ServerStateChange{State: next.String(), TimedOut: timedOut})
}

// State reports the lifecycle phase as its wire spelling, the readable getter
// twin of the server:state event (via GetServerStatus().State).
func (s *ServerService) State() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.String()
}

// enterRunningLocked is the starting→running transition: the state change plus
// the TPS poller that readiness keys (#108). Callers hold s.mu and have
// checked state == stateStarting.
func (s *ServerService) enterRunningLocked(timedOut bool) {
	s.setStateLocked(stateRunning, timedOut)
	s.startTPSPollLocked()
}

// startTPSPollLocked arms and spawns the RCON TPS poller, replacing the old
// fixed 15s post-spawn delay: by the Done line RCON is already listening
// ("RCON running" precedes it). The tpsOnce/stopTPS re-arm lives here WITH the
// spawn — split apart, stopTPSPoll would consume a stale Once and no-op on the
// next boot. Callers hold s.mu. No-op without RCON config; the log-derived
// TPS fallback covers that case, as before.
func (s *ServerService) startTPSPollLocked() {
	if !s.rconEnabled || s.rconPassword == "" || s.rcon == nil {
		return
	}
	s.stopTPS = make(chan struct{})
	s.tpsOnce = sync.Once{}
	go s.pollTPS(s.stopTPS)
}

// watchStarting resolves a starting state whose ready line never matches — the
// timeout Wings lacks: promote to running with the TimedOut flag and a console
// banner rather than sticking in starting forever. exited is this boot's own
// channel, captured under s.mu in start(), so a stop or crash of this boot
// cancels the watcher without ever racing a later boot's channel.
func (s *ServerService) watchStarting(exited chan struct{}) {
	timer := time.NewTimer(s.startingTimeout)
	defer timer.Stop()
	select {
	case <-exited:
		return
	case <-timer.C:
	}

	s.mu.Lock()
	promote := s.state == stateStarting
	if promote {
		s.enterRunningLocked(true)
	}
	s.mu.Unlock()
	if promote {
		s.Narrate(fmt.Sprintf("No ready line seen after %s, treating the server as running", s.startingTimeout))
	}
}

// Summary describes a configured server for display: what it is, where it
// lives, what it launches from, and whether it is the one currently running.
// Loader/version fall back to detection so a server that has never been
// started still describes itself.
func (s *ServerService) Summary(cfg models.ServerConfig) models.ServerSummary {
	sum := models.ServerSummary{
		MCVersion:  cfg.MCVersion,
		Loader:     cfg.Loader,
		WorkingDir: cfg.WorkingDir,
		LaunchFile: describeLaunch(cfg.JarPath, cfg.WorkingDir),
		Running:    cfg.ID != "" && s.ActiveServerID() == cfg.ID,
	}

	if sum.MCVersion == "" || sum.Loader == "" {
		mv, ld := detectServerLoader(struct{ JarPath, WorkingDir string }{
			JarPath:    cfg.JarPath,
			WorkingDir: cfg.WorkingDir,
		})
		if sum.MCVersion == "" {
			sum.MCVersion = mv
		}
		if sum.Loader == "" {
			sum.Loader = ld
		}
	}
	return sum
}

// ActiveServerID returns the ID of the server currently running, or "" when
// none is. Callers that show per-server state need this: IsRunning alone says
// only that *a* server is up, not which one.
func (s *ServerService) ActiveServerID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		return ""
	}
	return s.serverID
}

// PrepareForBackup flushes pending chunk writes to disk and disables auto-save
// so a file-level world copy captures a consistent snapshot. Prefers RCON
// (save-all flush blocks until the save completes); falls back to stdin with a
// fixed grace period when RCON is unavailable. Returns true if saving was paused
// — the caller must then call ResumeSaves once the copy is done. No-op (returns
// false) when the server is not running.
func (s *ServerService) PrepareForBackup() bool {
	s.mu.Lock()
	running := s.running
	rconOK := s.rconEnabled && s.rconPassword != "" && s.rcon != nil
	addr, pw := s.rconAddr, s.rconPassword
	s.mu.Unlock()

	if !running {
		return false
	}

	if rconOK {
		_, _ = s.rcon.Execute(addr, pw, "save-off")       //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
		_, _ = s.rcon.Execute(addr, pw, "save-all flush") //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
		return true
	}

	_ = s.SendCommand("save-off")       //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
	_ = s.SendCommand("save-all flush") //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
	time.Sleep(3 * time.Second)
	return true
}

// ResumeSaves re-enables auto-save after a backup. Safe to call when the server
// is no longer running (no-op).
func (s *ServerService) ResumeSaves() {
	s.mu.Lock()
	running := s.running
	rconOK := s.rconEnabled && s.rconPassword != "" && s.rcon != nil
	addr, pw := s.rconAddr, s.rconPassword
	s.mu.Unlock()

	if !running {
		return
	}
	if rconOK {
		_, _ = s.rcon.Execute(addr, pw, "save-on") //nolint:errcheck // best-effort resume after backup
		return
	}
	_ = s.SendCommand("save-on") //nolint:errcheck // best-effort resume after backup
}

func (s *ServerService) Uptime() string {
	s.mu.Lock()
	running, started := s.running, s.startTime
	s.mu.Unlock()
	if !running {
		return "0s"
	}
	d := time.Since(started).Round(time.Second)
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	sec := int(d.Seconds()) % 60
	if h > 0 {
		return fmt.Sprintf("%dh %dm %ds", h, m, sec)
	}
	if m > 0 {
		return fmt.Sprintf("%dm %ds", m, sec)
	}
	return fmt.Sprintf("%ds", sec)
}

func (s *ServerService) GetActivePlayers() []models.Player {
	s.playersMu.RLock()
	defer s.playersMu.RUnlock()
	list := make([]models.Player, 0, len(s.players))
	for name, sess := range s.players {
		list = append(list, models.Player{
			Name:   name,
			UUID:   sess.uuid,
			IP:     sess.ip,
			Online: true,
		})
	}
	return list
}

func (s *ServerService) PlayerCount() int {
	s.playersMu.RLock()
	defer s.playersMu.RUnlock()
	return len(s.players)
}

func (s *ServerService) MaxPlayers() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.maxPlayers == 0 {
		return 20
	}
	return s.maxPlayers
}

func (s *ServerService) CurrentTPS() float64 {
	s.tpsMu.RLock()
	rconTPS := s.currentTPS
	lastUpdate := s.tpsLastUpdate
	s.tpsMu.RUnlock()

	if rconTPS >= 0 && !lastUpdate.IsZero() && time.Since(lastUpdate) < 15*time.Second {
		return rconTPS
	}
	return s.currentLogTPS()
}

func (s *ServerService) currentLogTPS() float64 {
	s.logTPSMu.RLock()
	logTPS := s.logTPS
	lastWarning := s.logLastWarning
	s.logTPSMu.RUnlock()

	if logTPS < 0 {
		return -1
	}
	if lastWarning.IsZero() {
		return logTPS
	}
	elapsed := time.Since(lastWarning).Seconds()
	if elapsed >= 60 {
		return 20.0
	}
	return logTPS + (20.0-logTPS)*(elapsed/60.0)
}

func (s *ServerService) RAMUsedMB() float64 {
	s.mu.Lock()
	proc := s.cachedProc
	s.mu.Unlock()

	if proc == nil {
		return 0
	}
	mem, err := proc.MemoryInfo()
	if err != nil || mem == nil {
		return 0
	}
	return float64(mem.RSS) / 1024 / 1024
}

func (s *ServerService) RAMTotalMB() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return float64(s.maxRAMMB)
}

func (s *ServerService) CPUPercent() float64 {
	s.mu.Lock()
	proc := s.cachedProc
	s.mu.Unlock()

	if proc == nil {
		return 0
	}
	pct, err := proc.Percent(0)
	if err != nil {
		return 0
	}
	return pct
}

// RconConfig returns the RCON address and password parsed from server.properties
// when the server last started. ok is false when RCON is not enabled or the
// server has never been started. Used by the scheduler's rcon primitive.
func (s *ServerService) RconConfig() (addr, password string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.rconEnabled || s.rconPassword == "" {
		return "", "", false
	}
	return s.rconAddr, s.rconPassword, true
}

func (s *ServerService) GetConsoleHistory() []models.ConsoleLine {
	s.logBufMu.RLock()
	defer s.logBufMu.RUnlock()
	out := make([]models.ConsoleLine, len(s.logBuf))
	copy(out, s.logBuf)
	return out
}

// parseXmx extracts the -Xmx value from JVM args and returns megabytes.
// Returns 2048 as a sensible default if the flag is absent or unparseable.
func parseXmx(args []string) int {
	for _, a := range args {
		lower := strings.ToLower(a)
		if !strings.HasPrefix(lower, "-xmx") {
			continue
		}
		raw := lower[4:]
		if len(raw) == 0 {
			continue
		}
		suffix := raw[len(raw)-1]
		numStr := raw
		multiplier := 1
		switch suffix {
		case 'g':
			numStr = raw[:len(raw)-1]
			multiplier = 1024
		case 'm':
			numStr = raw[:len(raw)-1]
		case 'k':
			numStr = raw[:len(raw)-1]
			multiplier = 0 // sub-MB, treat as ~0
		}
		n, err := strconv.Atoi(numStr)
		if err != nil {
			continue
		}
		return n * multiplier
	}
	return 2048
}

// propInt reads an integer property with a default fallback.
func propInt(props map[string]string, key string, def int) int {
	v, ok := props[key]
	if !ok {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
