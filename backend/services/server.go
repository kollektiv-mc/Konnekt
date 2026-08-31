package services

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
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

// The outcome of a narrated line: work started, work finished, work failed.
// Carried alongside sourceManager as ConsoleLine.Outcome and the log:line
// payload's outcome key, and painted by the UI as a green/yellow/red status
// dot. This is what the "[Konnekt] " text prefix became: a plugin could print
// the prefix but cannot print a marker, and a dot costs no line width in a
// stream where every other line is server output.
const (
	outcomeProgress = "progress"
	outcomeOK       = "ok"
	outcomeFailed   = "failed"
)

// ErrPowerActionInProgress is returned when a power action (start, stop,
// restart) arrives while another one is still in progress. The message is
// shown verbatim in the UI, so keep it a readable sentence.
var ErrPowerActionInProgress = errors.New("another power action is in progress")

// errServerNotRunning backs Stop's long-standing "server not running" message
// so Restart can tell "nothing to stop, skip the leg" from a real stop
// failure. The exact string is a contract: frontend callers catch and ignore
// it (the backups tile's stop-and-back-up, beforeClose's benign race).
var errServerNotRunning = errors.New("server not running")

// rePlayerName is the name capture every player matcher shares, so the
// reasoning below lives in one place instead of being re-derived at each
// regex.
//
// \w is exactly the Java username charset ([0-9A-Za-z_]), which is why it was
// enough on its own until Bedrock crossplay (#228): Floodgate prefixes a
// Bedrock player's Java-side name, "." by default, and replaces spaces in the
// gamertag with underscores, so "Steve" arrives as ".Steve" and matched
// nothing.
//
// The dot is added and nothing else, deliberately. What keeps a chat message
// from spoofing a server line is that the name sits directly against the
// "]: " anchor, so every character this class gains is one some plugin's
// broadcast format can exploit. Four in particular stay out: "<" and ">",
// or "]: <Alex> Bob joined the game" registers Alex; "[" and "]", or a
// "[Lobby] Bob joined" broadcast registers the rank tag. So does ":", which
// is subtler — chat plugins that format messages as "Name: message" would
// otherwise let a player type "joined the game" and register themselves.
//
// The cost is that a Floodgate prefix other than the default is still not
// matched. The config takes any string and "*" and "~" do get used. That is a
// deliberate limit, not an oversight: the anchor is worth more than the
// coverage.
const rePlayerName = `([\w.]+)`

var (
	// Player matchers. All anchored on "]: " followed directly by the name, so
	// a chat message ("]: <Alex> Bob joined the game") cannot spoof one — the
	// same guard reServerReady documents below. Lines reach these already run
	// through stripANSI, without which a chat plugin's colour sequence sits in
	// that gap and none of them match at all.
	//
	// Joins and leaves are each matched on two lines rather than one. The
	// broadcasts ("joined the game", "left the game") are the obvious signal
	// but they belong to a plugin as much as to the server: Essentials can
	// reword or silence either. The server core's own connection lines
	// ("logged in with entity id", "lost connection:") cannot be reworded, so
	// they back the broadcasts up. Both paths are idempotent, and which one
	// lands first is not fixed — vanilla logs the login line before the join
	// broadcast, Paper logs it after.
	rePlayerJoin  = regexp.MustCompile(`]: ` + rePlayerName + ` joined the game`)
	rePlayerLeave = regexp.MustCompile(`]: ` + rePlayerName + ` left the game`)
	rePlayerUUID  = regexp.MustCompile(`]: UUID of player ` + rePlayerName + ` is ([0-9a-f-]{36})`)
	// The address is captured whole and parsed by parseLoginAddress rather
	// than being spelled out here. A dotted quad used to be, which meant an
	// IPv6 player matched nothing at all and so was not merely missing an IP
	// but untracked on a server whose join broadcast a plugin had silenced
	// (#229). The line's worth as a join signal must not hang on the address
	// format.
	rePlayerLogin = regexp.MustCompile(`]: ` + rePlayerName + `\[/(\S+)\] logged in`)
	rePlayerLost  = regexp.MustCompile(`]: ` + rePlayerName + ` lost connection:`)
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

// quiesceFlushWait is the grace a stdin-driven save-all gets to reach disk
// when RCON is unavailable, since that path has nothing to block on.
const quiesceFlushWait = 3 * time.Second

// playerSession holds per-session data captured from log lines.
type playerSession struct {
	uuid string
	ip   string
}

// serverState is the lifecycle vocabulary (#108), closed at four states.
// The zero value is offline on purpose: a serverInstance that has never booted
// is offline, which is what lets newServerInstance leave the field alone.
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

// ServerService manages the app's server runtimes. It owns one serverInstance
// per configured server (keyed by id) and delegates every per-server question to
// one of them; the runtime state itself lives in serverinstance.go (#232).
//
// Still one running server at a time: start() refuses while any instance is
// live, exactly as it did when this struct held the process directly. What the
// map buys now is that a stopped server keeps its own console and stats rather
// than having them cleared by the next server's boot.
type ServerService struct {
	// Shared with every instance. The seams live here so a test that reassigns
	// one after an instance exists still reaches it — see instanceDeps.
	*instanceDeps

	// ctx is set by SetContext for the Wails wiring convention app.go follows,
	// and read by nothing. It was already unused on the singleton; it stays on
	// the manager because it is not per-server state.
	ctx context.Context

	// mu guards instances and current, and nothing else. The lock order is
	// powerMu -> mu -> instance.mu -> the instance's fine-grained mutexes, so mu
	// is only ever held long enough to look up or create a *serverInstance
	// pointer and is released before calling into one.
	mu        sync.Mutex
	instances map[string]*serverInstance

	// current is the instance every serverID-less accessor answers from: the most
	// recently started server, or an empty-id placeholder before the first start.
	// Never nil.
	//
	// "Most recently started" rather than "the running one" is what preserves the
	// pre-split behaviour exactly. Nothing clears the console ring on exit — only
	// start() clears it — so GetConsoleHistory and GetLastStop have always kept
	// answering for a server after it stopped, and answering from the running
	// instance instead would blank the console on every stop. The accessors that
	// *are* gated on running (Uptime, IsRunning, ActiveServerID, SendCommand)
	// still read false off this same instance and return what they always did.
	//
	// The placeholder matters: BackupService, LoaderService and ModService all
	// narrate on paths reachable before any server has been started, and those
	// lines have always landed in the console history.
	current *serverInstance

	// powerMu serializes Start, Stop and Restart end-to-end; Restart holds it
	// across both legs. Acquired fail-fast only (TryLock): a second power action
	// gets ErrPowerActionInProgress instead of queueing. waitForExit, the crash
	// path, never touches it, so a dying process tears down freely even mid-action.
	// ForceStop (#110) deliberately bypasses it: TryLock, proceed regardless,
	// unlock only if that TryLock succeeded — its reason to exist is a graceful
	// stop wedged inside the gate.
	//
	// Deliberately on the manager rather than per-instance, unlike the rest of the
	// state this split moved. Its job is "one power action app-wide", which is the
	// invariant keeping one-server-at-a-time true; per-instance gates would let a
	// Start(B) past the gate while Start(A) was still in flight and change the
	// error the caller sees. It becomes per-instance when concurrent servers land
	// and the manager gains a different guard (#57).
	powerMu sync.Mutex
}

func NewServerService() *ServerService {
	s := &ServerService{
		instanceDeps: &instanceDeps{
			launchCmd:       defaultLaunchCmd,
			startingTimeout: startingDeadline,
			killTree:        killTree,
			quiesceWait:     quiesceFlushWait,
		},
		instances: make(map[string]*serverInstance),
	}
	// The bootstrap current, under the empty id: narration before any server has
	// started has always reached the console (BackupService, LoaderService and
	// app.go's EULA write all narrate on paths reachable before a first boot),
	// and an empty-id instance keeps that true without every accessor growing a
	// nil check.
	//
	// Registered in the map, not just held as current, so instanceFor("") returns
	// this instance rather than minting a second empty one. current is always an
	// instance the map holds; a real server id is never "".
	s.current = newServerInstance("", s.instanceDeps)
	s.instances[""] = s.current
	return s
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

// SetRcon and SetBus write through the shared instanceDeps, so every instance
// (existing and future) sees them. Both are called once during startup, before
// SetContext starts anything.
func (s *ServerService) SetRcon(r *RconService) {
	s.rcon = r
}

func (s *ServerService) SetBus(b *EventBus) {
	s.bus = b
}

// cur is the instance every serverID-less method answers from. See the comment
// on ServerService.current for why it is the last-started instance rather than
// the running one.
func (s *ServerService) cur() *serverInstance {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.current
}

// instanceFor returns the instance for serverID, creating and retaining it on
// first use. Retained for the life of the process: an instance holds a console
// ring and an hour of stats, which is the whole point of keeping it past its
// process, and evicting one would silently lose a console someone is about to
// read.
func (s *ServerService) instanceFor(serverID string) *serverInstance {
	s.mu.Lock()
	defer s.mu.Unlock()
	if inst, ok := s.instances[serverID]; ok {
		return inst
	}
	inst := newServerInstance(serverID, s.instanceDeps)
	s.instances[serverID] = inst
	return inst
}

// anyRunning reports whether any instance has a live process. This is the
// app-wide "one server at a time" refusal that used to be a single bool.
//
// Two beats on purpose: snapshot the pointers under s.mu, release it, then ask
// each instance. Reading an instance's running flag needs its own mu, and the
// lock order (powerMu -> s.mu -> instance.mu) forbids holding s.mu there.
//
// Start and Restart hold powerMu across this, so no other power action can race
// it. The only concurrent writer is waitForExit on the crash path, which by
// design never takes powerMu — and it can only turn a true into a false, so the
// worst case is refusing a start that could have proceeded. The single running
// flag this replaces had the same property.
func (s *ServerService) anyRunning() bool {
	return len(s.runningInstances()) > 0
}

// runningInstances is anyRunning's two-beat scan, shared with StopRunning:
// snapshot the pointers under s.mu, release it, then ask each instance, because
// reading an instance's running flag needs its own lock and the order
// (powerMu -> s.mu -> instance.mu) forbids holding s.mu there.
func (s *ServerService) runningInstances() []*serverInstance {
	s.mu.Lock()
	insts := make([]*serverInstance, 0, len(s.instances))
	for _, inst := range s.instances {
		insts = append(insts, inst)
	}
	s.mu.Unlock()

	var running []*serverInstance
	for _, inst := range insts {
		if inst.IsRunning() {
			running = append(running, inst)
		}
	}
	return running
}

func (s *ServerService) Start(serverID string, jarPath string, jvmArgs []string, workingDir string) error {
	if !s.powerMu.TryLock() {
		return ErrPowerActionInProgress
	}
	defer s.powerMu.Unlock()
	return s.startInstance(serverID, jarPath, jvmArgs, workingDir)
}

// startInstance is Start without the power gate. Callers hold powerMu, which is
// what makes the check-then-claim below safe without a second gate: two starts
// cannot interleave, and the only gate-bypassing path (ForceStop) starts nothing.
//
// current is claimed *before* the boot and put back if it fails. Both halves
// matter. ForceStop deliberately bypasses powerMu so it can rescue a wedged
// boot, and it targets cur() — if current only moved on success, a force-stop
// during a boot would aim at the previous server and silently do nothing, which
// is the exact case ForceStop exists for (#110). And a failed start must leave
// the readable state alone: the pre-split code cleared logBuf only *after*
// cmd.Start() succeeded, so a refused boot never touched the console, the RCON
// config or max-players. Restoring current is what keeps that true.
func (s *ServerService) startInstance(serverID string, jarPath string, jvmArgs []string, workingDir string) error {
	if s.anyRunning() {
		return fmt.Errorf("server already running")
	}
	inst := s.instanceFor(serverID)
	prev := s.setCurrent(inst)
	if err := inst.start(jarPath, jvmArgs, workingDir); err != nil {
		s.restoreCurrent(inst, prev)
		return err
	}
	return nil
}

// setCurrent claims inst as the instance the serverID-less accessors answer
// from, returning the one it replaced.
func (s *ServerService) setCurrent(inst *serverInstance) *serverInstance {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.current
	s.current = inst
	return prev
}

// restoreCurrent undoes a setCurrent whose boot then failed, but only if nothing
// else has claimed current since. Nothing can today, since powerMu is held
// throughout; the guard is there so that stays true if a later change lets a
// second claimant in.
func (s *ServerService) restoreCurrent(claimed, prev *serverInstance) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == claimed && prev != nil {
		s.current = prev
	}
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
	// The stop leg targets the server being restarted, not whichever one is
	// running (#239). Restarting B while A was up used to stop A and boot B,
	// because the leg went through the ambient current instance; a second server
	// being up is a refusal, the same one Start gives.
	if err := s.instanceFor(serverID).stop(grace); err != nil && !errors.Is(err, errServerNotRunning) {
		return err
	}
	return s.startInstance(serverID, jarPath, jvmArgs, workingDir)
}

// start is Start without the power gate. Callers hold powerMu.
func (s *serverInstance) start(jarPath string, jvmArgs []string, workingDir string) error {
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

func (s *serverInstance) streamOutput(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, maxConsoleLine), maxConsoleLine)
	scanner.Split(newConsoleSplitFunc(maxConsoleLine))
	for scanner.Scan() {
		// Stripped once, here, before anything reads the line: the matchers
		// below all need it, and so does the console tile, which rendered the
		// escape bytes as literal text. See stripANSI for why a piped stdout
		// carries ANSI at all.
		line := stripANSI(scanner.Text())

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
			s.recordPlayerField(m[1], func(sess *playerSession) { sess.uuid = m[2] })
		} else if m := rePlayerLogin.FindStringSubmatch(line); m != nil {
			// Carries the IP and, on a server whose join broadcast a plugin
			// silenced, doubles as the join itself. An address that will not
			// parse is left unset rather than dropping the line, so the join
			// still lands.
			name := m[1]
			if ip := parseLoginAddress(m[2]); ip != "" {
				s.recordPlayerField(name, func(sess *playerSession) { sess.ip = ip })
			}
			if sess, joined := s.promotePlayer(name); joined {
				s.bus.Emit(EventPlayerJoined, map[string]string{"name": name, "ip": sess.ip})
			}
		} else if m := rePlayerJoin.FindStringSubmatch(line); m != nil {
			// On Paper this broadcast precedes the login line, so the IP is
			// genuinely not known yet and rides out empty — the same
			// best-effort the player:left payload has always had. The roster
			// gets it a line later, so anything that needs the IP reliably
			// should read GetActivePlayers rather than this payload.
			name := m[1]
			if sess, joined := s.promotePlayer(name); joined {
				s.bus.Emit(EventPlayerJoined, map[string]string{"name": name, "ip": sess.ip})
			}
		} else if m := rePlayerLeave.FindStringSubmatch(line); m != nil {
			if name := m[1]; s.removePlayer(name) {
				s.bus.Emit(EventPlayerLeft, map[string]string{"name": name})
			}
		} else if m := rePlayerLost.FindStringSubmatch(line); m != nil {
			// The core's own disconnect line. Also printed for a connection
			// that failed before joining, which removePlayer reports as the
			// no-op it is, so no player:left goes out for a player who was
			// never online.
			if name := m[1]; s.removePlayer(name) {
				s.bus.Emit(EventPlayerLeft, map[string]string{"name": name})
			}
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

// Narrate speaks as Konnekt in the console (#113) for work that is under way:
// the source marker the UI styles apart from server output, so a manager line
// is never mistaken for something the server printed, plus the progress
// outcome. NarrateDone and NarrateFailed are the same thing for work that
// finished and work that did not; pick the one that matches, because the
// outcome is the whole of what the reader sees at a glance.
//
// Exported because app.go narrates the EULA write; Wails binds App methods
// only, so this adds no IPC surface. Reserve them for lifecycle moments — the
// notification feed keeps its own role, and chatter here costs the console its
// usefulness.
func (s *serverInstance) Narrate(line string) {
	s.narrate(outcomeProgress, line)
}

// NarrateDone narrates work that completed successfully.
func (s *serverInstance) NarrateDone(line string) {
	s.narrate(outcomeOK, line)
}

// NarrateFailed narrates work that failed. The line still names its stage, so
// it says which step broke rather than only that something did.
func (s *serverInstance) NarrateFailed(line string) {
	s.narrate(outcomeFailed, line)
}

func (s *serverInstance) narrate(outcome, line string) {
	s.emitConsoleLineTagged(line, sourceManager, outcome)
}

// emitConsoleLine sends one line of server output down the console channel.
func (s *serverInstance) emitConsoleLine(line string) {
	s.emitConsoleLineTagged(line, "", "")
}

// emitConsoleLineTagged sends one line down the console channel: the log:line
// event plus the ring buffer GetConsoleHistory replays to late subscribers.
// The source and outcome keys are omitted entirely when empty, so server
// output travels exactly the payload it always has.
// NB: emit precedes buffer append. A remote client that snapshots
// GetConsoleHistory then subscribes must dedup/order the seam line.
func (s *serverInstance) emitConsoleLineTagged(line, source, outcome string) {
	ts := time.Now().Format("15:04:05")
	payload := map[string]string{"timestamp": ts, "line": line}
	if source != "" {
		payload["source"] = source
	}
	if outcome != "" {
		payload["outcome"] = outcome
	}
	s.bus.Emit(EventLogLine, payload)
	s.logBufMu.Lock()
	if len(s.logBuf) >= consoleCap {
		s.logBuf = s.logBuf[1:]
	}
	s.logBuf = append(s.logBuf, models.ConsoleLine{Timestamp: ts, Line: line, Source: source, Outcome: outcome})
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

func (s *serverInstance) waitForExit() {
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
	// Captured under the lock, closed below without it. Reading s.exited at the
	// close instead is a data race the -race detector catches: clearing running
	// above is what lets the next Start through, and that Start writes a fresh
	// s.exited under this same lock while the unguarded read is still pending.
	// Losing it would close the *new* boot's channel, so that boot's Stop would
	// return at once and watchStarting would give up immediately. Closing the
	// channel this boot created is what the line always meant.
	exited := s.exited
	s.mu.Unlock()
	if !expected {
		s.NarrateFailed("Server process exited unexpectedly (" + exitLabel(exitCode) + ")")
	}
	s.bus.Emit(EventServerStopped, stop)

	// Closed dead last: anyone unblocked by <-exited (Stop's wait, Restart's
	// stop leg) observes fully-torn-down state — running already false, the
	// stopped event already handed to the bus. Closing it earlier is the race
	// Restart used to lose, failing its own start leg with "server already
	// running" against a stale flag.
	close(exited)
}

// status assembles the whole ServerStatus in one pass.
//
// One mu hold covers every scalar that lock guards, and it is released before
// the gopsutil read and before the players and TPS locks — the ordering each
// accessor here already follows on its own. Assembling it in one place rather
// than calling eight accessors is what stops a payload mixing values from either
// side of a stop, and it is why GetServerStatus and the stats tick can no longer
// drift apart: they are the same read now, not two lists kept in step by hand.
func (s *serverInstance) status() models.ServerStatus {
	s.mu.Lock()
	running, state, started := s.running, s.state, s.startTime
	maxPlayers, maxRAM, proc := s.maxPlayers, s.maxRAMMB, s.cachedProc
	s.mu.Unlock()

	if maxPlayers == 0 {
		maxPlayers = 20
	}
	return models.ServerStatus{
		Running:    running,
		State:      state.String(),
		Uptime:     uptimeSince(running, started),
		Players:    s.PlayerCount(),
		MaxPlayers: maxPlayers,
		TPS:        s.CurrentTPS(),
		RAMUsed:    ramUsedMB(proc),
		RAMTotal:   float64(maxRAM),
	}
}

// GetLastStop reports the most recent stop's detail, the readable getter twin
// of the server:stopped event payload. Zero value until a stop has happened.
func (s *serverInstance) GetLastStop() models.ServerStopped {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastStop
}

// Stop shuts the server down gracefully, waiting up to grace for it to save
// and exit before force killing the process tree. grace <= 0 means the
// default; callers with a configured value (ConfigService.StopGrace) pass it
// through.
func (s *ServerService) Stop(serverID string, grace time.Duration) error {
	if !s.powerMu.TryLock() {
		return ErrPowerActionInProgress
	}
	defer s.powerMu.Unlock()
	return s.instanceFor(serverID).stop(grace)
}

// StopRunning stops whatever is running, for the one caller that legitimately
// has no id: quitting the app. Scoping the close-time stop to the *selected*
// server instead would skip the graceful stop whenever the running server was
// not the selected one, and the Job Object or Pdeathsig would then kill the JVM
// with no expectedStop marked and no world save — a crash notification for a
// deliberate quit, and lost chunks.
//
// Returns nil when nothing is running, following ForceStop's "already dead is
// success". A loop today over at most one instance; correct unchanged when #57
// allows several.
func (s *ServerService) StopRunning(grace time.Duration) error {
	if !s.powerMu.TryLock() {
		return ErrPowerActionInProgress
	}
	defer s.powerMu.Unlock()
	for _, inst := range s.runningInstances() {
		if err := inst.stop(grace); err != nil && !errors.Is(err, errServerNotRunning) {
			return err
		}
	}
	return nil
}

// stop is Stop without the power gate. Callers hold powerMu.
func (s *serverInstance) stop(grace time.Duration) error {
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
func (s *ServerService) ForceStop(serverID string) error {
	if s.powerMu.TryLock() {
		defer s.powerMu.Unlock()
	}
	return s.instanceFor(serverID).forceStop()
}

// forceStop is ForceStop without the gate. The running check is inside the
// instance's own lock, so a graceful stop that lands between the manager picking
// this instance and this call is still resolved atomically: a server already
// gone reports success.
func (s *serverInstance) forceStop() error {
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

func (s *serverInstance) stopTPSPoll() {
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
func (s *serverInstance) pollTPS(stop chan struct{}) {
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

func (s *serverInstance) queryTPSViaRcon() (float64, bool) {
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

func (s *serverInstance) SendCommand(command string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running || s.stdin == nil {
		return errServerNotRunning
	}

	_, err := fmt.Fprintln(s.stdin, command)
	return err
}

func (s *serverInstance) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// setStateLocked moves the lifecycle state machine (#108). Callers hold s.mu.
// Emits server:state only on an actual change, so subscribers never see a
// duplicate transition; emitting under the lock follows start()'s existing
// server:started emit (EventBus fans out in-process handlers in goroutines).
func (s *serverInstance) setStateLocked(next serverState, timedOut bool) {
	if s.state == next {
		return
	}
	s.state = next
	s.bus.Emit(EventServerState, models.ServerStateChange{State: next.String(), TimedOut: timedOut})
}

// State reports the lifecycle phase as its wire spelling, the readable getter
// twin of the server:state event (via GetServerStatus().State).
func (s *serverInstance) State() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.String()
}

// enterRunningLocked is the starting→running transition: the state change plus
// the TPS poller that readiness keys (#108). Callers hold s.mu and have
// checked state == stateStarting.
func (s *serverInstance) enterRunningLocked(timedOut bool) {
	s.setStateLocked(stateRunning, timedOut)
	s.startTPSPollLocked()
}

// startTPSPollLocked arms and spawns the RCON TPS poller, replacing the old
// fixed 15s post-spawn delay: by the Done line RCON is already listening
// ("RCON running" precedes it). The tpsOnce/stopTPS re-arm lives here WITH the
// spawn — split apart, stopTPSPoll would consume a stale Once and no-op on the
// next boot. Callers hold s.mu. No-op without RCON config; the log-derived
// TPS fallback covers that case, as before.
func (s *serverInstance) startTPSPollLocked() {
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
func (s *serverInstance) watchStarting(exited chan struct{}) {
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

	// The install directory is the truth about which build launches, so it wins
	// over the stored value. The stored value is the fallback for a server whose
	// directory is gone or unreadable, where the last thing Konnekt recorded
	// beats showing nothing — flagged as "config" so the UI can say it is not a
	// live reading.
	sum.LoaderVersion, sum.LoaderSource = detectLoaderVersion(cfg.JarPath, cfg.WorkingDir)
	if sum.LoaderVersion == "" && cfg.LoaderVersion != "" {
		sum.LoaderVersion, sum.LoaderSource = cfg.LoaderVersion, "config"
	}
	return sum
}

// ActiveServerID returns the ID of the server currently running, or "" when
// none is. Callers that show per-server state need this: IsRunning alone says
// only that *a* server is up, not which one.
func (s *serverInstance) ActiveServerID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		return ""
	}
	return s.id
}

// PrepareForBackup flushes pending chunk writes to disk and disables auto-save
// so a file-level world copy captures a consistent snapshot. Prefers RCON
// (save-all flush blocks until the save completes); falls back to stdin with a
// fixed grace period when RCON is unavailable. Returns true if saving was paused
// — the caller must then call ResumeSaves once the copy is done. No-op (returns
// false) when the server is not running.
func (s *serverInstance) PrepareForBackup() bool {
	s.mu.Lock()
	running := s.running
	rconOK := s.rconEnabled && s.rconPassword != "" && s.rcon != nil
	addr, pw := s.rconAddr, s.rconPassword
	s.mu.Unlock()

	if !running {
		return false
	}

	// Narrated here rather than at the three call sites (both backup paths and
	// world duplication), so every quiesce says so once and WorldService's
	// narrow serverGuard interface stays as it is.
	s.Narrate("Pausing world saves and flushing to disk")

	if rconOK {
		_, _ = s.rcon.Execute(addr, pw, "save-off")       //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
		_, _ = s.rcon.Execute(addr, pw, "save-all flush") //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
		return true
	}

	_ = s.SendCommand("save-off")       //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
	_ = s.SendCommand("save-all flush") //nolint:errcheck // best-effort save-flush before backup; backup proceeds either way
	// Without RCON there is nothing to block on, so this wait is the whole
	// guarantee — and unexplained it reads as a hang.
	s.Narrate(fmt.Sprintf("RCON unavailable, giving the save %s to flush", s.quiesceWait))
	time.Sleep(s.quiesceWait)
	return true
}

// ResumeSaves re-enables auto-save after a backup. Safe to call when the server
// is no longer running (no-op).
func (s *serverInstance) ResumeSaves() {
	s.mu.Lock()
	running := s.running
	rconOK := s.rconEnabled && s.rconPassword != "" && s.rcon != nil
	addr, pw := s.rconAddr, s.rconPassword
	s.mu.Unlock()

	if !running {
		return
	}
	s.Narrate("Resuming world saves")
	if rconOK {
		_, _ = s.rcon.Execute(addr, pw, "save-on") //nolint:errcheck // best-effort resume after backup
		return
	}
	_ = s.SendCommand("save-on") //nolint:errcheck // best-effort resume after backup
}

func (s *serverInstance) Uptime() string {
	s.mu.Lock()
	running, started := s.running, s.startTime
	s.mu.Unlock()
	return uptimeSince(running, started)
}

// uptimeSince renders a boot's age, or "0s" when nothing is running. Split out
// so Uptime and status() cannot drift; callers snapshot the two fields under mu
// and format outside it.
func uptimeSince(running bool, started time.Time) string {
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

// parseLoginAddress pulls the client IP out of the "host:port" payload of a
// login line, normalised, or "" when it does not hold an address at all.
//
// The format is Java's InetSocketAddress.toString() and it comes in two
// shapes, because JDK 14 changed it (JDK-8225499). Konnekt manages whatever
// server directory it is pointed at, old versions on old JREs included, so
// both are read:
//
//	127.0.0.1:54321              IPv4, either era
//	[0:0:0:0:0:0:0:1]:54321      IPv6, JDK 14 and later
//	0:0:0:0:0:0:0:1:54321        IPv6, before that (Minecraft's own MC-13120)
//
// The last of those has no separator left to distinguish address from port,
// which is what MC-13120 is about. Splitting on the final colon settles it:
// the port is always present, so the last colon is always the one in front of
// it. net.ParseIP then decides whether what remains is really an address,
// which is the check the old dotted-quad pattern was doing implicitly, and
// IP.String turns 0:0:0:0:0:0:0:1 into ::1 for display.
//
// Returning "" rather than an error is the point: the caller still has a join
// to record, and an address it cannot read must not cost it the player.
func parseLoginAddress(addr string) string {
	host := addr
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		host = addr[:i]
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	ip := net.ParseIP(host)
	if ip == nil {
		return ""
	}
	return ip.String()
}

// recordPlayerField applies one piece of a player's connection detail — the
// UUID line, the IP off the login line — to the live session if the player is
// already online, and to the pre-join accumulator otherwise.
//
// Which map holds them is genuinely not knowable from the line: vanilla logs
// "logged in with entity id" before the join broadcast, Paper logs it after.
// Writing unconditionally to presession, as this used to, meant Paper's IP
// landed in an entry the join had already consumed and deleted, so the roster
// showed every player with a blank IP and a stale presession entry leaked
// until they disconnected.
func (s *serverInstance) recordPlayerField(name string, set func(*playerSession)) {
	s.playersMu.Lock()
	defer s.playersMu.Unlock()
	if sess, online := s.players[name]; online {
		set(&sess)
		s.players[name] = sess
		return
	}
	sess := s.presession[name]
	set(&sess)
	s.presession[name] = sess
}

// promotePlayer marks name online, folding in whatever the pre-join lines
// accumulated, and reports whether this call was the transition. Two lines can
// each signal a join, so the bool is what keeps player:joined to one emit per
// connection.
//
// Fields already on the live session win: on a second promotion the pre-join
// entry is stale by definition.
func (s *serverInstance) promotePlayer(name string) (playerSession, bool) {
	s.playersMu.Lock()
	defer s.playersMu.Unlock()
	sess, already := s.players[name]
	pre := s.presession[name]
	if sess.uuid == "" {
		sess.uuid = pre.uuid
	}
	if sess.ip == "" {
		sess.ip = pre.ip
	}
	s.players[name] = sess
	delete(s.presession, name)
	return sess, !already
}

// removePlayer takes name offline and reports whether they were online to
// begin with, so the second of the two disconnect lines emits nothing and a
// connection that failed before joining emits nothing at all. The pre-join
// entry goes either way: a half-finished login that never completes must not
// outlive the attempt.
func (s *serverInstance) removePlayer(name string) bool {
	s.playersMu.Lock()
	defer s.playersMu.Unlock()
	_, online := s.players[name]
	delete(s.players, name)
	delete(s.presession, name)
	return online
}

func (s *serverInstance) GetActivePlayers() []models.Player {
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

func (s *serverInstance) PlayerCount() int {
	s.playersMu.RLock()
	defer s.playersMu.RUnlock()
	return len(s.players)
}

func (s *serverInstance) MaxPlayers() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.maxPlayers == 0 {
		return 20
	}
	return s.maxPlayers
}

func (s *serverInstance) CurrentTPS() float64 {
	s.tpsMu.RLock()
	rconTPS := s.currentTPS
	lastUpdate := s.tpsLastUpdate
	s.tpsMu.RUnlock()

	if rconTPS >= 0 && !lastUpdate.IsZero() && time.Since(lastUpdate) < 15*time.Second {
		return rconTPS
	}
	return s.currentLogTPS()
}

func (s *serverInstance) currentLogTPS() float64 {
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

func (s *serverInstance) RAMUsedMB() float64 {
	s.mu.Lock()
	proc := s.cachedProc
	s.mu.Unlock()
	return ramUsedMB(proc)
}

// ramUsedMB reads resident memory off a gopsutil handle. Split out for the same
// reason as uptimeSince, and it takes the handle rather than the instance so the
// syscall provably happens with no lock held.
func ramUsedMB(proc *process.Process) float64 {
	if proc == nil {
		return 0
	}
	mem, err := proc.MemoryInfo()
	if err != nil || mem == nil {
		return 0
	}
	return float64(mem.RSS) / 1024 / 1024
}

func (s *serverInstance) RAMTotalMB() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return float64(s.maxRAMMB)
}

func (s *serverInstance) CPUPercent() float64 {
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
func (s *serverInstance) RconConfig() (addr, password string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.rconEnabled || s.rconPassword == "" {
		return "", "", false
	}
	return s.rconAddr, s.rconPassword, true
}

func (s *serverInstance) GetConsoleHistory() []models.ConsoleLine {
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

// --- Delegators ---
//
// Every method below kept the exact signature it had when ServerService held one
// server's runtime directly, because eight consumers call them with no server id
// (App, StatsService, BackupService, PlayerService, WorldService, LoaderService,
// ModService and the scheduler's ExecContext). Threading an id through those call
// sites is #233's job, not this split's.
//
// They all answer from cur(). See the comment on ServerService.current for why
// that is the last-started instance rather than the running one, and why it is
// never nil.

// Status reports on the server it names, running or not. An id with no instance
// yet gets an inert one, so an unknown server and a configured-but-never-started
// one answer identically and there is no second definition of "offline" to drift.
//
// Never an error: the frontend's useServerStatusSync reads a rejection as
// "the backend did not answer" and paints the tile unreachable, which is exactly
// the distinction useServerStore's doc comment exists to keep apart from "the
// server answered and is stopped".
func (s *ServerService) Status(serverID string) models.ServerStatus {
	return s.instanceFor(serverID).status()
}

// CurrentServerID is the id the serverID-less callers answer for: the last
// server started, or "" before the first start. The one ambient primitive, named
// so a caller cannot reach for it by accident — StatsService needs it because a
// 10s ticker carries no id, and App.GetLastStop needs it because it is bound
// without a parameter.
func (s *ServerService) CurrentServerID() string {
	return s.cur().id
}

func (s *ServerService) GetLastStop() models.ServerStopped { return s.cur().GetLastStop() }
func (s *ServerService) SendCommand(serverID, command string) error {
	return s.instanceFor(serverID).SendCommand(command)
}
func (s *ServerService) IsRunning() bool                   { return s.cur().IsRunning() }
func (s *ServerService) State() string                     { return s.cur().State() }
func (s *ServerService) ActiveServerID() string            { return s.cur().ActiveServerID() }
func (s *ServerService) PrepareForBackup() bool            { return s.cur().PrepareForBackup() }
func (s *ServerService) ResumeSaves()                      { s.cur().ResumeSaves() }
func (s *ServerService) Uptime() string                    { return s.cur().Uptime() }
func (s *ServerService) GetActivePlayers() []models.Player { return s.cur().GetActivePlayers() }
func (s *ServerService) PlayerCount() int                  { return s.cur().PlayerCount() }
func (s *ServerService) MaxPlayers() int                   { return s.cur().MaxPlayers() }
func (s *ServerService) CurrentTPS() float64               { return s.cur().CurrentTPS() }
func (s *ServerService) RAMUsedMB() float64                { return s.cur().RAMUsedMB() }
func (s *ServerService) RAMTotalMB() float64               { return s.cur().RAMTotalMB() }
func (s *ServerService) CPUPercent() float64               { return s.cur().CPUPercent() }
func (s *ServerService) Narrate(line string)               { s.cur().Narrate(line) }
func (s *ServerService) NarrateDone(line string)           { s.cur().NarrateDone(line) }
func (s *ServerService) NarrateFailed(line string)         { s.cur().NarrateFailed(line) }

func (s *ServerService) RconConfig() (addr, password string, ok bool) {
	return s.cur().RconConfig()
}

func (s *ServerService) GetConsoleHistory() []models.ConsoleLine {
	return s.cur().GetConsoleHistory()
}
