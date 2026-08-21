# Pterodactyl Wings: behavioral feature survey

**Source:** github.com/pterodactyl/wings (MIT license, Go, ~20.5k LOC), surveyed 2026-08-21.

**What this document is.** A clean-room *behavioral* survey of Wings, the game-server
management daemon of the Pterodactyl hosting panel. It was produced by reading the Wings
source in an isolated environment and describing only externally observable behavior. It
deliberately contains **no** Wings code, no Wings function/struct/method/package/file
names, no directory layouts, no struct fields, no wire formats, no config schemas, and no
step-by-step algorithm descriptions. A reader implementing any feature described here
must make every implementation decision themselves; this document tells them *what* the
feature does, *why* it exists, how it behaves at the edges, and whether it only makes
sense in Wings' deployment model.

**Wings' deployment model, for calibration.** Wings is a privileged daemon running many
game servers on one shared host. The servers belong to mutually untrusted, paying
strangers ("tenants"). Every server runs in its own Docker container. All input reaching
the daemon (paths, archives, config edits, ignore files) is treated as potentially
hostile. A large fraction of Wings' behavior exists only because of that model; each
section below flags what is landlord machinery and what would transfer to a local,
single-user, trusted-operator tool.

**Scope.** Covered: server lifecycle, console streaming, backups; process management and
supervision; filesystem handling; config file parsing and editing. Deliberately skipped:
everything that exists purely to serve Pterodactyl's HTTP API, the node/panel handshake
and remote configuration protocol, panel-driven install scripts, node-to-node server
transfers, and the SFTP subsystem (though filesystem rules that SFTP merely reuses are
covered, because they live in the filesystem layer).

---

## Part I. Server lifecycle and supervision

### 1. The four-state model

**What it does.** Every managed server is, at all times, in exactly one of four states:
offline, starting, running, stopping. This tracked state is the daemon's own opinion,
deliberately kept separate from what the container runtime would say at any instant. All
UI, all gating logic, and all crash detection key off the tracked value, not off a live
process query.

**Why it exists.** "Is the process alive" is a much weaker question than "is the game
server ready to accept players." A Minecraft process is alive for 30+ seconds before it
can serve anyone. The four-state model buys a distinct *starting* phase the UI can render
honestly, and gives internal logic a way to suppress spurious crash handling.

**Observable behavior.**

- A state transition is only announced when the value actually changes; setting the state
  to what it already is produces no event, so subscribers never see duplicate transitions.
- An invalid state value is treated as a programming error and crashes the daemon rather
  than being coerced. The state vocabulary is closed.
- **"Stopping" is used as a shield, not just a description.** Anywhere the system needs a
  process to go away *without* the automatic crash-restart machinery firing, it moves the
  state to stopping first and only then to offline. Every deliberate teardown (user stop,
  kill, delete, a failed start being rolled back, a suspension) passes through stopping.
  Only an offline transition that arrives *without* first passing through stopping is
  treated as a crash. This is a very cheap, very effective way to distinguish "it died"
  from "we ended it," and it works identically for a plain child process.
- Reaching offline resets all live resource counters and emits one final all-zeros usage
  sample, so dashboards drop to zero instead of freezing at the dead server's last
  reading.

**Trust model.** None of this depends on containers or tenancy. Directly portable, and
arguably more valuable in a desktop app where the status pill is the product.

### 2. Ready detection from console output

**What it does.** A started server is marked *starting*, not *running*. It becomes
running only when a line of its own console output matches a configured pattern — for
Minecraft, the "Done" line. The patterns are per-server-type, are a list (any match
wins), and each entry is either a plain substring test or, marked by an explicit prefix
on the pattern string, a regular expression. Optionally, ANSI color escape sequences are
stripped from a line before matching, because a colorized startup banner otherwise
defeats plain substring matching.

**Why it exists.** There is no portable way to learn "ready to accept players" from an
arbitrary game server other than watching what it prints.

**Observable behavior.**

- Matching runs only while the state is starting (plus a narrow running-state case
  described in §10). Output from an offline or stopping process is never scanned, so a
  late buffered line cannot resurrect a stopped server.
- A malformed regular expression in the pattern list is logged and that one pattern is
  disabled; the others keep working and nothing crashes.
- Ready detection is deliberately *not* subject to console flood throttling (§12): a
  server that floods its startup log still gets recognized as started. The trade-off is
  that detection is dispatched concurrently per line, so under a flood the ordering of
  detection versus delivery is not guaranteed.
- **If no pattern ever matches, the server sits in "starting" forever** while running
  perfectly well. There is no timeout that ever promotes or demotes a stuck starting
  state. This is the single most common misconfiguration in the whole system, and the
  absence of a timeout is a known weakness worth fixing rather than copying.

**Trust model.** Fully portable; nothing tenancy-specific.

### 3. Power actions and their serialization

**What it does.** Four user-facing actions: start, stop, restart, kill. All four funnel
through one entry point holding a single-slot exclusive lock per server, so a second
action cannot begin until the first finishes.

**Why it exists.** Double-clicking restart, or a scheduled restart landing on a manual
one, used to produce genuinely broken states: two boots racing, a container recreated
under a live attachment. Serializing everything at one choke point is cheaper than making
each action individually reentrant. The maintainers note this only works because callers
are disciplined about never bypassing the choke point.

**Observable behavior.**

- **Contention is a hard failure by default.** With no wait requested, a second action
  fails immediately with a distinct "already busy" error, surfaced to the user as
  "another power action is currently being processed, please try again later." A caller
  may instead ask to wait up to N seconds for the lock; on expiry it still fails,
  reporting how long it waited.
- **Kill deliberately bypasses the lock.** If a stuck stop is holding the lock, that is
  exactly when the user most needs kill to work. Kill opportunistically takes the lock if
  free (blocking other actions while it runs) but proceeds regardless if it cannot. An
  observed emergent property: forcing the kill through often unsticks the wedged action,
  which then completes naturally.
- **Start is refused unless the server is fully offline**, with a plain "server is
  running" error rather than any clever reconciliation.
- **Restart is stop-then-start under one continuous lock hold** — releasing between the
  legs would let another action slip into the gap. Any error from the stop leg (including
  a timeout when force-kill was not requested) aborts the restart; the daemon refuses to
  boot a server it is not certain is down.
- Actions are refused outright while the server is in a protected state — installing,
  being transferred, or having a backup restored — each with its own distinct error
  message, so the user learns *why*, not just "no."
- Every successful action is recorded in an activity log with the requesting user and
  their IP address.

**Trust model.** The lock, the distinct-error-per-reason pattern, and the kill bypass are
fully portable (desktop users double-click too). The activity log with user identity and
IP is a multi-tenant audit artifact. The protected-state set collapses, for a local tool,
to "a restore is in progress."

### 4. The pre-boot sequence

**What it does.** Before any process is launched, a fixed series of checks and
preparations runs, and its progress is narrated into the server's own console as
daemon-authored lines (§14), so the user sees *why* a start is taking time.

**Why it exists.** Almost every "my server won't start" report is one of: out of disk,
stale settings, config file not updated, broken file permissions. Doing these up front —
and saying so in the console — converts a mystifying silent failure into a legible one.

**Observable behavior, in boot order.**

- **Configuration is re-fetched from its source of truth on every boot**, so settings
  changed while the server was down apply without any explicit "apply" step. A fetch
  failure aborts the boot with a clear message; "this server no longer exists" is a
  distinct, recognizable condition. (In Wings the source of truth is the remote panel; in
  a local tool the equivalent is "re-read live settings rather than trusting anything
  cached from the last launch.")
- **A suspended server is refused a boot**, checked *after* the re-fetch so a suspension
  applied seconds ago is honored.
- **Resource limits are pushed to the runtime before launch**, so a memory or CPU change
  takes effect on this boot.
- **Disk usage is checked and blocks the boot when over quota.** The user first sees
  "checking server disk space usage, this could take a few seconds" — honest, because on
  a huge file tree the walk genuinely is slow. With an unlimited quota, the check runs in
  the background instead and does not gate the boot (still useful: it warms the cached
  display value).
- **Config-file rewriting runs on every boot** (Part VI). A file that fails to parse is
  logged and skipped, never fatal: the stated reasoning is that a server the user can fix
  by hand beats a server that refuses to boot.
- **An optional recursive file-ownership repair pass** runs before boot, narrated with
  its own "this could take a few seconds" warning. Defaulted on; documented as the main
  cause of slow boots on servers with enormous file trees, and safe to disable unless
  external processes touch the files. (Exists purely because the game runs containerized
  under a different uid/gid — see §33.)
- **The container is destroyed and recreated on every single boot.** There is no
  reconciliation of an existing container against new settings — several runtime limits
  cannot be changed in place at all, and recreating designs out the entire class of
  "your change was silently ignored" bugs. The portable idea is not "recreate the
  container" but: *the launch specification is rebuilt from current settings at every
  start, never cached across starts, never partially updated.*
- **Image acquisition tolerates a registry outage** (§29): pull progress streams into the
  console; a failed pull with a matching local image proceeds with a logged warning
  rather than failing the boot.
- **The previous session's console log is truncated at boot**, so a connecting client is
  not shown last session's output as if it were current.
- **Output capture is established *before* the process is started, never after.** The
  maintainers are emphatic, having been burned: start-then-attach loses the first seconds
  of output, and a process that dies instantly (bad flags, corrupt world, port in use)
  produces its most important output and exits before anyone is listening — worse, the
  supervisor can be left attached to nothing while believing otherwise. Attach-first
  means the very first byte and an immediate exit are both observed.
- **Attach plus launch share a hard 30-second budget.** Exceeding it fails the start
  rather than hanging the supervisor forever.
- **Any preflight or boot failure walks the state through stopping and then to offline**
  — never straight to offline. A straight drop from starting would trip crash detection,
  which would immediately retry the exact operation that just failed, producing a tight
  boot loop. Failed starts must not look like crashes.

**Trust model.** Nearly all portable. The ownership repair and container recreation are
container-specific in mechanism, but the recreate rule's *purpose* (current settings are
what actually launched) still needs an answer in a process-based design.

### 5. Stopping: mechanisms, deadlines, escalation

**What it does.** Each server type declares *how* it is stopped: either a console command
written to the process's stdin (the normal case for game servers — Minecraft's `stop`),
or a named signal. The daemon prefers the declared method and escalates to a hard kill on
a deadline.

**Why it exists.** A Minecraft server killed rather than asked to stop can lose world
state. But a hung server that ignores its stop command must still be stoppable, or the
user cannot reclaim their machine.

**Observable behavior.**

- **Three mechanisms, with a fallback ladder.** (1) A console command via stdin — requires
  an active attachment; if not attached, this silently degrades to mechanism 3. (2) A
  signal — a configured name is mapped to a small accepted set (abort, interrupt,
  terminate, kill), and **anything unrecognized silently falls back to an immediate
  SIGKILL** with only a log line noting it. A typo in a signal name produces an unclean
  kill, not an error. (3) A runtime-native stop, used when nothing is configured (with a
  warning) or as the fallback: the platform's default termination signal, waiting
  indefinitely at that layer — the *outer* deadline is what actually bounds it.
- **Issuing a stop and waiting for it are separate operations.** The bare stop returns as
  soon as the request is issued, without waiting for the process to die; the maintainers
  note callers almost always want the waiting variant. The waiting variant takes a
  deadline and an escalation flag: on expiry it either force-kills (logging which stage
  timed out) or returns a deadline error with the process possibly still alive.
- **Deadlines differ sharply by context, and the differences are policy.** A
  user-initiated stop or restart waits **ten minutes** before escalation — a large world
  save is legitimately slow, and killing mid-save is worse than making the user wait.
  Stopping in order to restore a backup waits **two minutes** (and does *not* escalate:
  a refusal aborts the restore rather than killing the server). Enforcement stops — disk
  quota exceeded, suspension — wait **one minute** then force-kill: the process has
  already lost the benefit of the doubt.
- **What the user sees:** the state flips to stopping immediately and stays there for the
  whole wait; kill sends SIGKILL and marks the server offline at once without waiting for
  confirmation.
- **Cancellation is separated from termination.** If the caller abandons the wait (user
  navigated away), escalation still proceeds under its own authority — "the user left"
  must never strand a half-stopped process.
- **A missing process is a successful stop, everywhere.** Stop, kill, and teardown against
  something already gone all return success. A process found not-running but not yet
  marked offline is walked through stopping to offline so the correction never looks like
  a crash. Stopping an already-offline server does not push it back into stopping.

**Trust model.** Entirely portable, and among the most directly reusable designs in this
survey: declared per-server-type stop method, graduated deadlines, kill-bypasses-the-lock
(§3), cancellation-does-not-cancel-the-kill, idempotent no-op stops. Two caveats for a
port: signal semantics differ on Windows, and the silent typo-falls-back-to-kill behavior
is worth replacing with a loud configuration error in a single-user app.

### 6. Crash detection and automatic restart

**What it does.** A server that goes from starting or running to offline without the
daemon having initiated a stop is treated as a crash: the user gets a visible report in
the console, and the server is automatically restarted unless it crashed too recently.

**Why it exists.** Unattended game servers crash — bad plugin, out of memory, corrupt
chunk — and auto-restart keeps them up. But naive auto-restart turns a permanently broken
server into a boot loop that hammers the machine forever, so the restart is rate limited.

**Observable behavior.**

- **The determination is the transition itself** — previously starting or running, now
  offline, with no pass through stopping. That is the entire test; everything else in the
  system is arranged so deliberate stops never produce that transition (§1).
- **What the user sees** is a banner in their console: a delimiter line announcing the
  crashed state, the exit code, and whether the process was killed by the out-of-memory
  killer. The OOM flag is the single most useful diagnostic for a Java game server and is
  surfaced directly rather than buried in a log.
- **A clean exit (code zero) counts as a crash by default.** Configurable, and a genuine
  judgment call: if the user did not press stop and the process ended anyway, the tidy
  exit code does not mean they wanted it. An out-of-memory kill always counts as a crash,
  regardless of exit code and even with clean-exit detection disabled.
- **Loop protection is a single recency cooldown, not a backoff.** If the previous crash
  was within a window (default 60 seconds), the restart is skipped and the user is told:
  "aborting automatic restart, last crash occurred less than N seconds ago." Only the
  most recent crash timestamp is kept — no counter, no escalating delay, no permanent
  give-up. A server crashing every 61 seconds restarts forever. A window of zero means
  always restart, which the maintainers themselves describe as probably a terrible idea
  that some operators want anyway. The timestamp is in-memory only, so restarting the
  daemon resets the cooldown.
- Crash detection can be disabled globally or per server; when disabled, a crash still
  produces an explicit console line saying the automatic restart was skipped — silence
  would look like a bug.
- **The automatic restart goes through the ordinary power path**, acquiring the same lock
  and re-running the entire preflight. A crash caused by a full disk therefore fails
  again at the pre-boot disk check with a clear reason, instead of looping on the launch.
- The handler runs asynchronously so it cannot block state-change processing; it no-ops
  if the server is no longer offline by the time it runs (guarding a race against a fast
  manual restart); and if it cannot even read the exit state, the user gets a generic
  "crash was detected but an error occurred while handling it" line with details in the
  log. If the process record was deleted out from under the daemon, a nonzero exit code
  is synthesized so the situation reports as an unclean exit rather than crashing the
  handler.

**Trust model.** Entirely portable, and probably the highest-value lifecycle feature for
a desktop manager. The weaknesses are worth improving rather than copying: recency-only
cooldown with no counter, no backoff, no terminal give-up state, and no persistence
across daemon restarts. A desktop tool can also do what a headless daemon cannot: show
the user "restarted 3 times in 5 minutes, staying stopped" and ask.

### 7. Supervision inferences and the runtime boundary

**What it does.** Wings supervises processes through a pluggable runtime layer designed
so that non-container backends could satisfy the same behavioral contract: does the
process exist, is it running, create/start/attach/signal/stop/kill/tear down, report exit
state and uptime, expose current state, serve the log tail, and announce happenings. Only
the Docker backend was ever shipped, but the contract's own documentation describes what
a plain-process implementation would do differently (existence checks always succeed,
mount targets reduce to "the server's directory," in-place limit changes become no-ops).

**Why it exists.** All the messy conditional logic ("is the container missing," "did the
runtime daemon go away," "is the image stale") is confined to one layer, so lifecycle
logic above it reads as if a process were a simple thing with a state.

**Observable behavior.**

- **End of output means end of process.** This is the central supervision inference: when
  the output stream ends, the supervisor concludes the process is gone, marks itself
  unattached, and flips the state to offline. There is no liveness polling loop. That
  single edge drives crash detection, stats shutdown, and UI state. (A process-based port
  must deliberately choose its own source of truth — pipe EOF versus process wait — 
  rather than racing the two.)
- **Attachment is idempotent and single.** A second attach while attached is a silent
  no-op. There is exactly one reader of process output, ever; multiplexing to consumers
  happens strictly downstream (§11).
- Attaching starts both the output pump and resource polling, on independent lifetimes:
  polling deliberately does not inherit the caller's short connection budget, or stats
  would die seconds after every successful start.
- **A missing process/container is a normal outcome, not an error, everywhere.**
  Existence checks return false; stop, kill, and teardown return success; exit-state
  queries synthesize an unclean exit. Every call site treats "it is not there" the same
  way, and the discipline is clearly hard-won. (The local analogues are real: the user
  killed the process from Task Manager, the PID got reused, the folder was deleted.)
- Creation of something that already exists is likewise a silent success, not a conflict
  error. Idempotence is chosen at every one of these boundaries.
- **A runtime daemon unreachable at supervisor startup is fatal** — refuse to boot rather
  than run in a degraded state where everything errors confusingly. A runtime daemon that
  dies *while running* is not centrally detected: attached streams end, which the
  supervisor reads as processes exiting, so from the user's perspective every server
  crashes simultaneously and crash detection then tries to restart them all. A cautionary
  tale for any auto-restart feature: an external dependency failing manifests as many
  simultaneous fake crashes, and the restart machinery amplifies it.
- Every operation that touches something that can hang is bounded by a timeout, with the
  recurring justification that a hang in the runtime must never become a hang in the
  supervisor.

**Trust model.** The abstraction shape and every inference above are portable; only the
Docker backend behind them is not.

### 8. Surviving a daemon restart

**What it does.** When the daemon itself restarts (upgrade, crash, machine reboot),
running servers are reconciled rather than orphaned or blindly killed.

**Why it exists.** A supervisor that kills everything it doesn't remember, or forgets
everything it was doing, converts its own restart into an outage.

**Observable behavior.**

- Every server's last known state is written to disk on a one-minute timer, explicitly
  accepting slight staleness — its only job is to make recovery easier.
- On boot, for each server independently: if its process is *actually running right now*,
  the daemon **re-attaches and adopts it, and never stops it.** The stated reasoning: an
  externally running process is the last line of defense when the daemon itself is in a
  corrupted state, so killing it is always the wrong move. If nothing is running but the
  recorded state said running or starting, the server is **booted back up** through the
  normal power path. Everything else is explicitly marked offline so no stale state
  persists.
- An adopted server gets its configuration re-synced immediately afterward, so an adopted
  process is not left running against stale settings.
- Recovery is fanned out a few servers at a time (bounded concurrency), and each server's
  recovery gets a hard 30-second cap on querying the runtime. This exists because a
  single hung runtime query once made the entire daemon un-bootable; the trade is one
  failed server instead of a dead host. A server whose stored configuration fails to
  parse is skipped with a specific log line rather than aborting the whole boot.

**Trust model.** Portable in spirit. A desktop app may prefer stopping servers on quit,
but if servers can outlive the app (or the app crashes), then persisting last-known
state, adopting rather than killing a live process, and bounding per-server recovery so
one bad server cannot brick startup all transfer directly. "Never kill something you
found running" is the instinct to keep.

---

## Part II. Console

### 9. Output capture and line assembly

**What it does.** Everything the game process writes is captured from a single attached
stream and delivered to consumers as discrete line-terminated chunks.

**Why it exists.** Game servers are line-oriented chatterboxes; consumers (UI, pattern
matching, history) all want lines, not byte soup.

**Observable behavior.**

- The process runs under a pseudo-terminal. Consequences: servers that check for a TTY
  behave as they would interactively, and stdout and stderr arrive interleaved on one
  stream — no consumer can ever tell which a given line came from.
- **A single delivered chunk is capped at 64 KiB.** A longer line is truncated at the cap
  and delivered; the remainder of that line is discarded, not buffered. Stated reason: an
  unbounded line lets the process make the supervisor allocate arbitrary memory by simply
  never printing a newline.
- **Stray carriage returns are normalized into real line breaks.** Minecraft is called
  out by name in the source: it emits mid-line carriage returns based on what it believes
  the terminal width is, which otherwise wrecks all downstream line handling. The
  consequence is a contract consumers must honor: **a delivered chunk may contain
  multiple embedded newlines** and must be split by the consumer; only the *end* of a
  chunk is guaranteed to be a line boundary.

**Trust model.** All portable, and the carriage-return quirk is the very same quirk a
local Minecraft manager will hit.

### 10. Interpretation of output

Two interpretive rules run over the output stream beyond ready detection (§2):

- **Typing the stop command marks the shutdown intentional.** When the line being *sent*
  to stdin equals the server's configured stop command, the state is flipped to stopping
  before the write (§15). Without this, every graceful in-console stop looks like a crash
  and triggers an auto-restart — the bug users find most maddening.
- **An output line exactly equal to the stop command flips the server to offline.** This
  catches a user typing the stop command through some path the daemon cannot see. It is
  acknowledged as fragile: a server that echoes commands back, or a chat message that is
  exactly the stop command's text, convinces the daemon the server stopped when it did
  not.

Any other spelling of the same intent (a plugin's alias, different casing) gets no such
treatment and will read as a crash when the server exits.

### 11. Fan-out to multiple listeners

**What it does.** The single output reader hands each chunk to a fan-out point that
copies it to every currently registered subscriber. Subscribers come and go dynamically.
A server keeps **two independent fan-out channels** — normal console output, and
installation/maintenance-job output — so a noisy install cannot evict console data and a
client can subscribe to either alone.

**Why it exists.** Multiple viewers (panel tabs, admin views) must be able to watch one
process without ever stalling it or each other.

**Observable behavior — the delivery semantics a subscriber can rely on, and the ones it
cannot.**

- **Bounded per subscriber.** Every subscriber has its own small fixed-size queue, sized
  by the subscriber. Real sizes in use are tiny (single digits): these are backpressure
  absorbers, not buffers.
- **Newest wins; oldest is dropped.** A full queue gets a very short grace period
  (~10 ms), after which that subscriber's *oldest* pending chunk is discarded to make
  room for the newest. Under sustained pressure a slow subscriber holds the most recent N
  chunks, not the first N — for a live console, exactly right.
- **A subscriber that is not reading at all silently misses everything** while stalled —
  it is not disconnected, not marked slow, not warned, and resumes cleanly whenever it
  starts reading again.
- **Ordering holds; continuity does not, and there is no gap marker of any kind.** Chunks
  arrive in production order with silent holes where drops occurred. A subscriber cannot
  detect that it missed anything.
- **Subscribers are isolated.** Deliveries are attempted concurrently, so one stalled
  subscriber neither blocks nor loses data for the others; it does add its grace period
  to the producer's per-chunk cost, which under a flood is a real throughput ceiling.
- **No replay, no history, no persistence.** The fan-out stores nothing; a subscriber
  attaching at time T sees only what is produced after T. With zero subscribers,
  publishing is a cheap no-op — output produced while no UI is open exists only in the
  on-disk log (§13).
- Unsubscribing closes that subscriber's queue; tearing the whole thing down closes all
  of them, and publishing after teardown is a hard programming-error crash — lifecycle
  ordering during server deletion is genuinely load-bearing.

**Trust model.** Entirely portable. One deliberate divergence recommended for a desktop
app: the "silent gap" choice is defensible for a remote panel, but a local console can
afford to tell the user "N lines dropped" — and probably should.

### 12. Console flood throttling

**What it does.** A server that dumps output too fast gets one daemon line in its console
("server is outputting console data too quickly — throttling…"), after which excess lines
are dropped from delivery until the flood subsides.

**Why it exists.** Not abuse (any more — see below): a UI receiving tens of thousands of
lines per second locks up, and unbounded delivery is unbounded memory.

**Observable behavior.**

- Volume is measured per fixed window — by default 2,000 lines per 100 ms, which is very
  permissive. This is a runaway detector, not a rate shaper.
- Lines over the ceiling in a window are **discarded, never queued**.
- The warning fires **once per flood episode**, latched when throttling begins and
  released only when a line is allowed through again — the difference between one useful
  warning and ten thousand useless ones.
- The counter resets every time the server enters starting, so a heavy shutdown does not
  penalize the next boot, and a heavy startup log does not count against a
  subsequently-quiet server.
- Ready detection still sees throttled lines (§2); only delivery is throttled, never
  interpretation.
- **Historically, exceeding output limits killed the server. That was removed
  deliberately**, with the reasoning preserved: clunky, hard to reason about, "a
  consistent pain point for users," with genuinely abusive workloads better policed by
  the host. The maintainers tried the aggressive version and walked it back — punish spam
  by dropping output, not by killing the user's server.

**Trust model.** Portable at different thresholds; the latch and reset-on-start behaviors
are worth copying verbatim.

### 13. Console history and replay

**What it does.** A client connecting to a *running* server's console is first sent the
last N lines of output (default 150), then live streaming begins, so the console is not
blank on open.

**Observable behavior and limits.**

- **There is no in-daemon history buffer.** Replay is served by reading back the
  container runtime's own log file for the process, which is configured small (5 MB, one
  file, no rotation, non-blocking writes). The maintainers state they only care about the
  last few hundred lines and refuse to spend host disk on more.
- **Replay only works while the server is running.** Connecting to a stopped server's
  console yields nothing — you cannot review why it died from the console view.
- **History never survives a boot**: the log is truncated at every start, deliberately,
  so a connecting client is not shown a screenful of the previous session.
- Replayed lines are indistinguishable from live ones to the consumer.
- A separate on-demand path serves the last N lines without a live connection.

**Trust model.** The design is a direct consequence of delegating logging to Docker and
is the weakest part of the console story. A desktop manager writing its own bounded
per-session log files (with a retention count) beats it outright: "show me the console
from the crash that happened while I was asleep" is an obvious desktop feature Wings
structurally cannot serve.

### 14. Daemon narration in the user's console

**What it does.** The daemon injects its own messages into the console view, visually
distinguished by a bold, colored, bracketed daemon-name prefix, so the user can tell "the
manager is telling me something" from "the game printed something."

**Why it matters more than it looks.** These messages travel by a different route from
process output (they are events, §26) but land in the same console view, making the
console a unified narrative of the process *and* its supervisor: image pulls, disk
checks, config rewrites, permission repairs, why a start was refused, the crash banner
with exit code and OOM flag, "aborting automatic restart…," "exceeding disk limit,
stopping process now." A user whose server refused to start sees why in the place they
were already looking. Installation output stays on its own channel (§11) so an install
log does not pollute the console.

**Trust model.** Fully portable, cheap, and probably the single highest value-per-effort
idea in this survey for a desktop manager: it is most of what makes the product feel
debuggable.

### 15. Console input

**What it does.** A single line of text is written to the running process's stdin with a
newline appended. That is the entire feature.

**Observable behavior.**

- **Fire-and-forget.** Success means "the bytes were handed off," nothing more. No
  acknowledgment, no correlation between a command and whatever output it later produces.
- Refused as a silent no-op when the server is offline; refused while starting until the
  input channel is actually attached (writing earlier would just error); a distinct
  "not attached" error otherwise, so callers can tell "no process" from "write failed."
- **The stop-command guard:** sending the configured stop command flips the state to
  stopping before the write (§10), so the resulting exit is not misread as a crash.
- Commands are recorded in the activity log with their text, the user, and their IP.

**Trust model.** Portable minus the activity log. A desktop app could improve on the
missing command/response correlation.

---

## Part III. Resource monitoring and disk accounting

### 16. Per-server resource usage reporting

**What it does.** While a server runs, usage samples stream continuously to anyone
watching: memory used, memory ceiling, CPU percentage, cumulative network bytes in/out,
uptime, and disk used. The samples are pushed by the runtime rather than polled on the
supervisor's own timer.

**Observable behavior, including the edges.**

- **Memory is deliberately adjusted to match what the `docker stats` CLI reports**
  (discounting inactive file cache) rather than the raw figure. The maintainers are
  candid: this exists to stop users reporting the dashboard/terminal mismatch as a bug.
  The transferable lesson: for any number a user can cross-check against an OS tool,
  matching that tool beats being technically purer. (A process-based port faces the same
  choice: raw RSS needs care to be comparable to what Task Manager or `top` shows.)
- **The reported memory ceiling is higher than what the user configured** — see the
  overhead policy in §28. A perennial source of "why doesn't this match what I set"
  confusion; if ported, label it.
- **CPU is absolute, not relative to the server's limit**: 100 means one full core
  saturated, so an 8-core host tops out at 800, and a server capped at half a core shows
  50 when saturated, not 100. Rounded to three decimals; computed as a delta between
  consecutive samples, so the first sample after attach has no meaningful CPU value.
- **Network counters are cumulative totals since process start**, summed across
  interfaces — not rates. Rate display is the consumer's job.
- **Uptime is reported in milliseconds**, anchored to the process start time and advanced
  by the sampling interval rather than re-read from the clock; it reads zero when the
  process is not running.
- **Disk is not part of this stream.** It comes from the separately maintained cached
  walk (§17) and is stapled onto samples whenever a snapshot is assembled — so it is
  present even for a stopped server (files exist whether the process does or not), and it
  is explicitly not guaranteed current. The right separation: disk is expensive and
  meaningful when stopped; the rest is cheap and meaningless when stopped.
- **On stop, every live counter is zeroed and one final zero sample is emitted** (§1), so
  charts drop to zero rather than freezing.
- **A client connecting to a stopped server is sent a one-off snapshot** so it has
  something to render immediately rather than waiting on a stream that will never start.
- Polling refuses to start against a stopped server and stops itself the moment the state
  goes offline. **Stats gaps are silent**: if the stream errors for any reason other than
  the process stopping, sampling just ends — no retry, no error to the user, and
  consumers keep showing their last value indefinitely with no way to know it is stale.
  A genuine weakness worth fixing in a port.

**Trust model.** The quantities and their semantics are portable; the mechanism (runtime
stats stream) is container-specific. Deliberately copy: the headroom-above-configured
ceiling, the zero-on-stop rule, the match-the-OS-tool principle — and fix the silent
staleness.

### 17. Disk usage accounting

**What it does.** Each server's disk usage is computed by recursively walking its data
directory, cached, maintained incrementally between walks, and (in Wings) enforced
against a per-server quota.

**Why it exists.** The walk is genuinely slow on a real game directory, and one tenant
must not fill a shared disk.

**How usage is defined (and is not).**

- Usage is the sum of apparent sizes of regular files. Directories, symlinks, sockets,
  FIFOs, and device nodes contribute nothing. Hard-linked files are counted once. Sparse
  files count their apparent size, and there is no block rounding, so the figure can be
  dramatically larger *or* smaller than what the OS reports for the same tree.

**Caching, staleness, and races a user can observe.**

- The cached result has a staleness interval (about two and a half minutes by default; a
  configurable recompute cadence carrying an explicit warning that lowering it too far
  causes serious I/O and CPU trouble). Setting the interval to zero disables the whole
  feature: usage reads zero forever and no walk ever happens.
- **Two query flavors:** a blocking one that walks fresh if stale (used where the answer
  gates a decision, e.g. the pre-boot check), and a non-blocking one that returns the
  cached value and kicks a refresh in the background (used for display). Only one walk
  runs per server at a time; concurrent requests coalesce behind it.
- Between walks the total is maintained incrementally — writes add their delta, deletes
  subtract, copies add. A completed walk overwrites the running total, silently
  discarding accumulated drift.
- Consequences: immediately after startup, before the first walk, usage reads **zero**
  (a server far over budget accepts writes during the window); a failed walk still
  populates the cache, specifically to avoid an infinite retry loop hammering the disk;
  files removed by anything other than the daemon (the game itself, an external editor)
  are invisible until the next walk, so usage drifts upward and can lock a tenant out
  until the cache self-refreshes; a partially failed write leaves a small over-count
  until the next walk.
- The quota value itself has three meanings: positive is a limit, zero is unlimited, and
  negative freezes the filesystem — every write refused regardless of usage.

**Quota enforcement points** (multi-tenant machinery; listed for completeness):

- Whole-file writes are checked on the **net** change, not the new size — overwriting a
  100 MB file with a 1 MB one succeeds even at quota. Copies are refused if the copy
  would not fit. Directory creation never counts.
- Compressing files into an archive writes the archive *first*, then checks, and deletes
  the work if over — transiently exceeding the budget. Archive extraction pre-checks the
  sum of declared uncompressed sizes (§22). Single-file decompression re-checks every few
  kilobytes as it streams and stops mid-file, leaving a truncated output.
- Boot is refused when over quota (§4). While running, each usage sample re-checks; the
  first time a running server is found over, it is told so in its console and gracefully
  stopped with a one-minute deadline, then force-killed. **This fires at most once per
  boot** — a latch re-armed when the server next enters starting — so a server hovering
  at the limit is not stopped repeatedly.
- Incremental streaming writes (arbitrary offsets, as an upload protocol produces) are
  enforced per write: the write that would cross the line is refused with everything
  before it already durable; closing the handle reconciles accounting against the real
  final size; a write at an absurd offset is refused without corrupting the running
  total.

**What is absent:** any check of *actual free space on the host disk*, anywhere. Wings
enforces a configured allowance, not physical availability; a genuinely full disk
surfaces as write errors from whatever operation was running.

**Trust model.** Enforcement is landlord machinery — refusing a local user's writes on
their own disk is hostile. Two pieces transfer directly: the caching pattern
(stale-value-plus-background-refresh; never compute a directory size synchronously on a
UI path — a Minecraft world is exactly the tree that stalls a UI), and the once-per-boot
enforcement latch as a general pattern for any "stop the server because of a condition"
rule. The gap worth closing in a port is the one Wings leaves open: warn on actual free
space before a backup, a restore, or a world save fails.

---

## Part IV. Filesystem

### 18. The sandbox: path confinement

**What it does.** Every file operation a user can trigger is interpreted relative to a
single directory that is that server's entire world. There is no way to name a location
outside it and no way to trick the system into following a link out of it. Absolute
paths, `../` segments, doubled slashes, and redundant repetitions of the root prefix all
normalize to the same place inside the sandbox; anything that normalizes outside is
refused before any I/O is attempted.

**Why it exists.** The daemon runs many servers belonging to mutually hostile strangers
through one privileged process; a path-handling bug is a full host compromise. This is
the primary security boundary of the whole file subsystem.

**Observable behavior.**

- A refused path produces a distinct "resolves outside the root" condition internally,
  but is deliberately reported to the user as **not found**, never as forbidden — the
  system will not confirm whether anything exists outside the sandbox.
- **Creating** a symlink is allowed, with any target at all — outside the sandbox,
  nonexistent, anything. **Following** one out is what is refused. Concretely: writing to
  a file that is a link to an outside file is refused (the target is never opened,
  created, or modified); a chain of links ultimately landing outside is refused the same
  way; writing *into* a directory that is a link to an outside directory is refused but
  reported as "not a directory" rather than as a violation (an inconsistency users
  notice); deleting a link deletes the link only, never the target, wherever it points;
  deleting a path that traverses *through* an escaping link is refused identically
  whether or not the file exists; and renaming a link as a whole entry succeeds even for
  escaping links — renaming never dereferences, so users can shuffle dangling and
  escaping links freely. Only traversal is blocked.
- Recursive walks — size accounting, ownership passes, archive creation — never descend
  into symlinks.
- The root itself is special-cased: it cannot be deleted, renamed, or renamed over, each
  attempt yielding the same "outside the root" refusal rather than a confusing OS error.
- Enforcement is designed to be immune to check-then-use races: operations run against
  already-open directory handles rather than re-walking path strings, so an attacker
  swapping a directory for a symlink mid-operation gains nothing. On older kernels
  lacking native support for this, the fallback verifies where an open actually landed —
  with the observable difference that the target may be briefly opened before rejection.
- Hard links inside the sandbox are unrestricted; accounting deduplicates them (§17).

**Trust model.** The threat model is entirely multi-tenant, but the mechanism is worth
keeping for a trusted local user as a **correctness** boundary rather than a security
one: it converts "the delete-world button had a path-join bug" from unrecoverable data
loss into an error message. Drop the information-hiding: for a local user, a clear "that
path is outside the server folder" beats a fake "not found."

### 19. Protected-file denylist

**What it does.** Each server can carry a list of gitignore-syntax patterns naming files
inside its own directory the tenant may never modify (the server jar, a EULA file, a
startup script) — an operator-versus-tenant control, independent of the sandbox.

**Observable behavior.** Enforcement is per-operation and deliberately partial: checked
on write, upload, copy, and rename (source and destination), but **not** on read,
download, or listing (protected files are fully visible and readable) and not on delete
(a determined tenant can remove a protected file even though they cannot edit it).
Matching runs against the path string as supplied, not fully normalized, so an unusual
but equivalent spelling can slip past. During archive extraction, entries matching the
denylist are **silently skipped** — no error, no warning, the rest extracts normally —
the most surprising behavior in the feature. The refusal message is explicit and
forbidden-flavored, unlike sandbox violations which masquerade as not-found.

**Trust model.** Entirely multi-tenant. Could be repurposed as an opt-in "protect these
files from accidental edits" toggle in a local tool; if so, make the skip-on-extract case
loud rather than silent.

### 20. File operations

**Reading.** Opening a file yields a handle plus metadata including a content-sniffed
MIME type (the head of the file is read and the position rewound — one extra small read).
FIFOs are rejected with "cannot open files of this type" (reading one would block
forever). Content is streamed with a hard cap at the size observed **at open time**:
deliberate, because the running game may be appending concurrently and a consumer already
promised a byte count. A log file being actively written is served truncated at its
open-time length, accepted as correct-enough — worth copying verbatim for a tool where
every interesting file is being appended to.

**Whole-file writes.** The caller declares the byte count in advance; the file is created
(with missing parents) and truncated, then exactly that many bytes are copied — a short
source yields a short file, excess is discarded, zero empties the file. Writing to a path
that is an existing directory is refused distinctly ("name conflicts with an existing
directory by the same name"). **Writes are in place and not atomic** — truncate, then
rewrite; an interrupted write leaves a truncated or partial file, and there is no
temp-file-and-rename anywhere in the system. For a desktop tool this is worth fixing, not
copying.

**Directory creation.** Creates the whole missing chain at once; creating beneath a file
or an escaping symlink fails as "not a directory" with an explicit explanation; never
counts against the quota.

**Rename/move.** One operation covers both. **Refuses if the destination exists** — it
never silently clobbers, stricter than the underlying OS call and the right default.
Missing destination directories are created automatically. A missing *source* is an error
at the lowest layer, but the batch layer above deliberately swallows it as no-op success,
so moving a list where one entry already vanished still succeeds. Batches run in parallel
and abort as a group on the first genuine error — a partially completed multi-file move
is a reachable state with no rollback.

**Copy.** Single regular files only; copying a directory or a symlink is refused and
deliberately reported as "does not exist" (so callers treat it as a nonexistent target),
which reads confusingly. Copies land beside the original with a name-suffix scheme
(" copy", " copy 1", …), probing about fifty candidates before falling back to a
timestamped name. Double extensions ending in `.tar` are special-cased so `.tar.gz`
becomes "name copy.tar.gz"; no other double extension is handled, so `.txt.bak` breaks in
the obvious way. Quota is checked first; permission bits are inherited.

**Delete.** Recursive by default, no confirmation, no trash. Deleting something that does
not exist is **success**, so batch deletes don't fail on already-gone entries. The root
cannot be deleted. Symlinks are unlinked, never followed. A recursive delete that hits an
error partway keeps removing what it can and reports the first error — partial deletion
is reachable. A separate "wipe everything and reset accounting to zero" operation exists
for restore-over-live-server (§25).

**Permissions and ownership.** Permission bits can be set without following symlinks
(changing a link's mode affects the link); only permission plus setuid/setgid/sticky bits
are meaningful. Ownership is not user-controllable; instead the recursive
"re-own everything to the server's user" pass (§4) exists purely because the game runs
containerized under a different uid/gid — a desktop app running as the user should drop
it entirely. Access/modification times can be set explicitly, used to restore archive
timestamps.

### 21. Directory listing

**Observable behavior.**

- One metadata record per entry: name, size, modification time, a "created" time that is
  really the inode-change time (documented internally as never having been correct — do
  not surface it as a creation date), permission string, octal mode, directory flag,
  symlink flag, and detected MIME type.
- **Dotfiles are included** — no hidden-file concept anywhere.
- Ordering: directories first, then files; within each group, byte-wise ascending — so
  uppercase sorts before lowercase and `File10` precedes `File9`. For a world-folder
  browser this is visibly wrong; use natural, case-insensitive sorting instead.
- Not lazy, not paginated: fifty thousand entries produce fifty thousand records.
- **MIME sniffing opens and reads the head of every regular file in the directory** —
  expensive on large directories, and worse, a *single* unopenable file (permission
  denied, exclusively locked by the running game, deleted mid-listing) **fails the entire
  listing** rather than degrading that entry. If copied, make the sniff lazy or
  per-entry-fallible.
- Symlinks report the link's own size and mode, never the target's: a link to a 5 GB
  world file lists as a few dozen bytes.
- Listing a non-directory errors as "not a directory," translated one layer up into "the
  requested directory does not exist."

### 22. Archive creation and extraction

**Creation.**

- Exactly one output format: gzip-compressed tar. No zip creation.
- Selection is either an explicit **allow-list** of paths (an entry matches itself or any
  descendant, with careful slash-boundary handling so including "test" does *not* pull in
  "test_file.txt" — an easy bug worth guarding in any port) or a **gitignore-syntax
  ignore expression**; if both are supplied, the allow-list wins and the ignore list is
  not consulted.
- Sockets are skipped (tar cannot represent them). **Symlinks are effectively dropped**:
  the target read essentially always fails, a warning is logged, and the entry is
  omitted — so a user who symlinks their world folder onto another drive silently gets an
  empty backup of it. Empty directories are not archived (only files are added, parents
  implied), even though extraction goes out of its way to recreate them — an asymmetry
  worth fixing. Files that vanish mid-walk are skipped, not fatal.
- Compression level is configurable (none / fast / maximum, default fast — for a world
  full of already-compressed region files, the right call). An optional MiB/s
  write-throughput cap keeps one backup from starving other servers' disk I/O (a
  shared-host concern; off by default).
- Progress is reported as bytes written against an *estimated* total taken from the
  cached directory size (§17), so progress can exceed 100% or move erratically; the
  display clamps rather than trusting the arithmetic. Cancellation is honored between
  entries, so cancels stop promptly at the next file boundary — leaving a partial archive
  file behind.
- In-place "compress these files" writes the result into the same directory under a
  timestamped name with colons stripped so the filename is valid on every platform.

**Extraction.**

- Formats are far broader than creation, because both the filename *and the contents* are
  sniffed: zip, rar, tar with the usual compressors, plus single-file compressed streams.
  A mislabeled archive still extracts if recognizable; a correctly named file full of
  garbage is rejected with "the archive is in a format we do not understand." Zip is read
  with random access rather than as a stream (faster; permits concurrent entry reads).
- **Zip-slip is prevented structurally**: each entry's destination goes through the exact
  same sandbox check as any user-supplied path, so entries with `../` chains or absolute
  paths are refused. Refusal **aborts the whole extraction** rather than skipping the
  entry — a hostile archive leaves a partially extracted tree.
- **Symlink entries do not produce symlinks** — they come out as ordinary (usually empty)
  files. This closes the classic two-stage attack (entry one is a link to a system file,
  entry two writes through it) as a property that falls out of the design rather than a
  bolted-on special case.
- Directory entries are created explicitly, including empty ones — a deliberate fix,
  since nothing else would create them.
- Size guards: an up-front check that the sum of declared uncompressed sizes fits the
  quota — **skipped entirely when there is no quota**, so an unlimited server has no
  zip-bomb protection at that stage — plus a per-entry re-check during writing, so an
  archive that lies about its sizes is still stopped mid-extraction (leaving a partial
  result). Integer overflow in the size summation is handled explicitly, so absurd
  declared sizes report out-of-space rather than wrapping into a pass.
- Permission bits and modification times from the archive are applied; setuid/setgid/
  sticky bits **are** honored — relevant if anything extracted will later be executed.
- Failure modes a user actually hits: unknown format; not enough space; and "one or more
  files this archive is attempting to overwrite are currently in use by another process"
  — the classic case of extracting a jar over a *running* server, with a message that
  explicitly says to stop the server and retry. Common enough in a Minecraft manager to
  deserve the same clear message.
- There is no dry-run, no conflict prompt, no per-file overwrite confirmation, and no
  atomicity: extraction overwrites in place, file by file, and a failure at entry 400 of
  500 leaves the first 399 applied.

**Trust model.** The hostile-archive protections (zip-slip, symlink neutralization, size
pre-check) are framed as tenant defenses but are worth keeping even for a fully trusted
user, because archives come from the internet — modpacks, plugin bundles, world
downloads — and filling the real disk is a real desktop failure mode.

---

## Part V. Backups and restore

### 23. Backup creation

**What it does.** A backup is a snapshot of the server's entire data directory as a
gzip-compressed tar archive, created while the server keeps running.

**Observable behavior.**

- **The unit is the whole server.** There is no "back up only the world."
- Exclusions use gitignore syntax, supplied per backup; absent that, a dot-prefixed
  ignore file at the root of the server's own data directory is honored, which the user
  maintains themselves. That file is read defensively — ignored if it is a symlink or
  over 32 KiB — because it is tenant-controlled and reading through a link there would
  funnel an arbitrary host file into a parser.
- Archive-creation semantics are those of §22: sockets skipped, symlinks dropped with a
  warning (the maintainers' stated position: symlinks cause far too much pain to be worth
  failing a backup over), vanished files skipped, configurable compression, optional
  write-throttle.
- **Nothing is quiesced. Backups run against a live server** with no world-save flush, no
  pause, no console command issued first, and no consistent-snapshot attempt; actively
  written files are captured mid-write. **For a Minecraft manager this is the most
  important caveat in the backup design**: a naive port produces backups with torn region
  files. Bracketing the archive with the game's own save-off / save-all / save-on
  commands is an obvious, cheap improvement Wings does not make.
- Backups are written *outside* the server's directory, so they neither count against its
  quota nor appear in future backups.
- **No free-space check precedes a backup**; a full disk is a mid-write failure. Nothing
  prevents multiple concurrent backups of the same server.
- Backup identifiers must be well-formed UUIDs, validated and canonically lowercased
  before any path is derived from them — a path-traversal guard against identifiers
  containing separators.

### 24. Backup completion, integrity, and offloading

**Observable behavior.**

- On success, a SHA-1 checksum and the byte size of the finished archive are computed
  and reported; the checksum is stored as metadata for later verification.
- **One completion event shape covers both outcomes**: success carries the identifier, a
  success flag, checksum and checksum type, and size; failure carries the same shape with
  the flag false, an empty checksum, and zero size. A listening UI handles exactly one
  event and can never be left waiting on a backup that silently failed.
- A failed backup also reports failure to its bookkeeping layer; failure to do even that
  is logged without masking the original error. **If the archive succeeds but the
  bookkeeping call fails, the archive is deleted** — the stated rationale being that an
  archive nobody tracks is worse than no archive (it consumes disk forever, unmanaged).
  Defensible, but it means a transient tracking failure discards a completed backup.
- **There is no progress reporting for a backup's body** — start and finish only, which
  on a multi-gigabyte world is a long silence. (Progress machinery exists for other
  archive operations and simply is not wired in here.)
- Deleting a backup that is already gone is success, not an error.

**Local versus offloaded.** Local backups stay on the machine in a dedicated directory
keyed by identifier — the mode a desktop manager wants. Offloaded backups are built
locally *first* (offloading does not avoid needing local free space for the whole
archive), then uploaded in parts to pre-signed URLs handed out by a control plane, then
the local copy is deleted regardless of upload outcome. Uploads retry with exponential
backoff for up to a minute on server-side (5xx) failures; client-side (4xx) failures are
permanent and abort immediately; network and DNS errors count as retryable. The upload
timeout is deliberately enormous (two hours), sized for multi-gigabyte archives on slow
links. The mode itself assumes a control plane, but its shape transfers to any "copy the
backup somewhere else" feature: build locally, upload in parts, retry server errors but
not client errors, delete local afterwards, expect hours.

### 25. Restore

**What it does.** Unpacks a backup archive back into the server's data directory, from a
local archive or a downloaded stream, optionally wiping the directory first.

**Observable behavior.**

- **The server is stopped first**, waiting up to two minutes gracefully — and notably
  *without* force-kill: a server that refuses to stop aborts the restore rather than
  being killed for it. A missing container counts as already stopped.
- **The server enters a protected state for the duration**: all power actions are refused
  with a distinct "server is currently being restored" message, the server is
  additionally marked unstartable so nothing can boot it mid-restore, and file-transfer
  sessions are forcibly disconnected so nothing writes into the directory while it is
  rewritten. All of it is cleared on completion, success or failure.
- **Wipe-first is an explicit option, and the difference matters enormously**: without
  it, the restore *merges* — archived files overwrite their counterparts, everything else
  survives. Surface it as a choice, never a default.
- **Every restored file's name is announced in the console** as a daemon message —
  extremely chatty on a world with tens of thousands of files (and it interacts with
  flood throttling), but the user watches real progress instead of a frozen spinner.
  Modification times are restored. The same write-throttle as backups applies.
- **The stored checksum is not verified before restoring.** Integrity data is captured at
  creation and never checked on restore.
- **There is no rollback.** A restore failing partway leaves the directory half-restored
  — some files new, some old, and with wipe-first, some simply missing. The failure is
  reported; recovery is manual.
- A completion event fires either way, so the UI stops waiting.
- For downloaded archives, the source URL is validated before fetching: the response
  content type must be the expected compressed-archive type, and destinations on private,
  internal, carrier-grade-NAT, and benchmarking address ranges are refused unless
  allow-listed — server-side request forgery protection, existing purely because the URL
  comes from an untrusted caller.

**Trust model.** Stop-first, the protected state, merge-versus-wipe, and per-file
narration are portable. The URL validation is purely multi-tenant. The gaps worth closing
in a port: verify the stored checksum before overwriting a user's world, and restore into
a staging location so failure is not catastrophic.

---

## Part VI. Config file parsing and editing

### 26. The config rewrite system

**What it does.** Before the game process starts, the manager reaches into the game's own
configuration files and forces certain settings to specific values — most importantly the
bind address and port, but in practice anything the operator pins. The user is free to
edit these files themselves, so the manager cannot simply own them; it must change
specific settings and leave everything else intact. Each server carries a list of
(file, format, list of edits); an edit is a key path, a value, and an optional condition.

**Why it exists.** Port assignments and addresses are the manager's decision, and games
read them only from their own config files. Without forced rewriting, every boot risks
the game binding somewhere other than where the manager promised.

**Behaviors common to all formats.**

- All configured files are processed exactly once, in parallel, immediately before boot.
- **Failure never blocks a boot.** A file that cannot be parsed is logged and left
  byte-for-byte unchanged; the server starts with the file as the user left it. The right
  instinct, worth keeping.
- **Every structured format creates the file if missing** — a missing YAML config becomes
  a file containing only the managed keys, which for most games is worse than absence.
  Plain-text mode is the deliberate exception: prefix-matching against nothing is
  meaningless, so a missing file is skipped, never created.
- Files over 64 MiB are refused and left untouched (every parser buffers the whole file,
  and content is attacker-controlled in Wings' world); plain-text mode additionally caps
  a single line at the same bound.
- **Rewrites are destructive and in place** — the file is truncated and rewritten with
  the reserialized document. No backup copy, no temp file, no rename; an interrupted
  rewrite loses the file, and a concurrent write by the game during the window is lost.
  In practice this is survivable only because the pass runs while the server is stopped.
  A port should make this atomic (sibling file, sync, rename) — configs are precious.
- Because the whole document is reserialized from a parsed model, **formatting is
  normalized on every structured rewrite** — the largest source of user surprise in the
  subsystem, detailed per format below.
- **There is no way to remove a key** — only to set one. No dry-run, no diff; the rewrite
  happens silently during startup, and the user discovers their comments are gone
  afterwards.

### 27. Rewrite fidelity per format, key paths, and values

**Formats understood:** YAML (both extension spellings), JSON, XML, INI, Java
`.properties`, and a fallback line-oriented plain-text mode.

**Fidelity per format.**

- **Java `.properties`:** only the comment block at the very top of the file survives —
  every comment below the first real content line is destroyed, and body blank lines
  vanish. Keys keep essentially their original order; new keys append. Values are written
  escaped to ASCII, so any non-ASCII character becomes an escape sequence — a documented,
  deliberate choice between two mutually exclusive bug populations (some games parse only
  escapes, others only literal UTF-8), with escaping chosen as the majority-compatible
  option. For Minecraft this is the correct call, but note a section-sign color code in a
  MOTD round-trips as an escape sequence. Two traps: reference-style placeholders inside
  values are *expanded* on rewrite (a value referring to another key is replaced by that
  key's value), and a *circular* reference makes the whole file fail to parse — thus left
  untouched.
- **YAML:** comments are lost **completely**; key order is normalized (effectively
  alphabetical) because the document passes through an unordered map; anchors and aliases
  are expanded; multi-document files fail to parse and are left alone; values traverse a
  JSON representation, so non-string keys become strings and very large integers can lose
  precision or reappear in exponential notation. **For a Minecraft audience this is
  severe**: rewriting a Bukkit/Spigot/Paper YAML strips every explanatory comment, and
  users notice immediately. A port serving Minecraft should use comment- and
  order-preserving YAML editing instead.
- **JSON:** reindented (four spaces), keys reordered, duplicate keys collapse to one,
  numbers may be reformatted after a round trip through floating point.
- **XML** fares best: comments and processing instructions survive, the document is
  reindented (two spaces), a missing root is synthesized from the first edit's path, and
  missing element chains along a non-wildcard path are created. A replacement value
  written in a specific bracketed name/value spelling sets an *attribute* on the matched
  element; anything else sets its text content.
- **INI:** sections, keys, and comments are preserved; the file is rewritten with normal
  alignment; missing sections and keys are created. Paths are one or two segments — a
  bare key targets the unnamed global section, a dotted pair targets a named section, and
  dots inside bracketed segments stay literal so section names containing dots work.
- **Plain text:** matching is by **line prefix only**, and a matching line is replaced
  *in its entirety* — so the match generally must include the key and separator, and the
  replacement must reproduce them. If several edits match one line, their values are all
  concatenated onto it. Line endings normalize to LF and a trailing newline is always
  added; non-matching lines pass through byte-for-byte, making this the only mode that
  leaves an unrecognized file intact.

**Key paths.** Structured formats use dot-separated paths. **One wildcard segment is
supported** — the edit applies to every child at that point, then follows the remaining
path inside each (the motivating case: per-world config blocks all needing the same bind
address). Nested wildcards are explicitly unsupported: only the first is honored, the
rest are taken literally. **Array indexing** is supported with bracket notation,
including a trailing path inside the indexed element; a missing array is created **only
for index zero** (any other index into a missing array errors and skips that edit).
**Missing paths are created in every structured format** — there is no
"update-only, never add" mode, so applying an edit list to an unfamiliar file injects
keys the game may not recognize. A path into a scalar (asking for a child of a string)
errors and skips that one edit without disturbing the rest.

**Conditional edits ("only change it if it currently says X").** In `.properties` this
works as documented: overwrite only if the current value matches exactly, and never
create the key if absent. **In the structured formats the same feature is broken**: the
comparison is made against the wrong thing, so in practice an existing key is essentially
never overwritten and the net behavior is "set only if missing"; a second regex-flavored
conditional mode has its guard inverted, engaging only when the path does *not* exist —
never what any author intended (an invalid regex is logged and the edit skipped). Neither
conditional mode exists for plain-text or XML. **Do not port this feature as written; if
conditional edits are wanted, design them fresh.**

**Value handling and coercion.** Values arrive typed; booleans are honored, and otherwise
a value is tried as an **integer first**, written as a number if it parses, string
otherwise. Floats are never produced. Real consequences: a port supplied as text becomes
a proper number (usually desirable), "1.20" stays a string, "0755" becomes the number 755
and loses its leading zero, and an IPv4 address stays a string only by accident of not
parsing as an integer. Coercion applies only where the format has types (JSON, YAML);
`.properties`, INI, and XML receive strings. A null-typed value writes the language
runtime's literal textual placeholder for null into the file, and an unrecognized type
writes a literal "invalid" placeholder — both end up in the user's config file, almost
certainly unintended. Escaped string values are unescaped before writing; a malformed
escape sequence crashes the daemon rather than erroring — a robustness hole not worth
reproducing.

**Substitution from daemon-known values.** A value may contain a double-braced
placeholder naming a daemon configuration key by dotted path (spelling-normalized before
lookup). **Only a deliberately tiny, curated subset of the daemon's configuration is
reachable** — everything else is invisible on purpose, so a hostile or careless config
cannot exfiltrate daemon credentials into a world-readable game file. Only scalars
substitute; pointing the placeholder at a collection leaves the placeholder text intact,
and so does an unknown key — deliberately, so the failure is *visible in the file* rather
than silently becoming an empty string. Both policies are excellent regardless of trust
model. Everything else — the server's own port, memory, user-defined variables — is
resolved upstream before the daemon sees the edit list; the daemon itself does no
server-metadata interpolation. In a single-process local tool that split disappears and
everything resolves in one place.

**Edge cases.** Malformed file: logged, untouched, boot proceeds. Missing file: created
with only managed keys (except plain text: skipped). Wrong format declared: a JSON file
declared as YAML still parses (YAML being a JSON superset) and is rewritten in the other
format's style — a silent way to mangle a file. Empty file: parses as an empty document
and emerges containing only the managed keys. Nothing coordinates with a running game
process rewriting its own config — the two writes race and one loses; avoided in practice
only by running the pass while stopped.

**Trust model.** The system's *purpose* (pin settings, tolerate user edits, never block a
boot) is exactly what a local Minecraft manager needs for `server.properties` and friends
(port, MOTD, max players). The parse-size ceiling and the curated substitution allowlist
are untrusted-input defenses (the ceiling is still a reasonable sanity check locally).
The pieces not to port as-is: destructive in-place rewriting, YAML comment destruction,
the broken conditional modes, integer auto-coercion of numeric-looking strings, and the
null/invalid placeholder leakage.

---

## Part VII. Events

### 28. The event stream and its delivery semantics

**What it does.** A per-server publish/subscribe stream carries everything a UI needs to
stay live without polling: state changes, resource samples, console output lines,
daemon-authored messages, install lifecycle and install output, backup completion,
restore completion, transfer progress, and deletion.

**Why it exists.** Clients (panel tabs, dashboards) need a single subscription that keeps
them current, with the process never blocked on a slow client.

**Observable behavior.**

- **Two tiers.** The runtime layer announces a small fixed set (state transition with the
  new state, a usage sample, and the three phases of image preparation); the server layer
  consumes those internally and translates them into the broader client-facing set — 
  image-pull progress becomes install-channel output, pull start/finish become
  human-readable daemon console lines.
- **Fire-and-forget envelopes.** Publishing never blocks meaningfully, never reports
  whether anyone received it, and never fails; an unserializable payload is treated as a
  programming error (a crash), not a dropped event.
- **Namespacing collapses.** A publisher may qualify a topic with the specific subject
  (which backup completed); subscribers register for the unqualified topic and receive
  all of them — qualification is publisher convenience, not a matching key.
- **Subscribers receive everything and filter for themselves**; there is no per-topic
  subscription at the transport level. Clients keep a whitelist of topics they care about
  and ignore the rest.
- **Same bounded, lossy, no-replay transport as console output** (§11): ordered per
  subscriber, oldest dropped under pressure, silent total drop for a non-draining
  subscriber, no gap markers, nothing retained when nobody listens. A late subscriber
  never learns of earlier events; connecting clients are therefore separately sent a
  current-state snapshot and a one-off usage sample.
- **State changes and usage samples share one internal queue**, so under a burst a state
  transition can in principle be evicted by usage samples. This is safe only because the
  state is *also* directly readable as an authoritative current value — recovery from a
  missed event is to re-read, never to replay.
- **Delivery order is guaranteed per subscriber; handling order is not.** Received events
  are handled concurrently, so two rapid state changes may be *processed* out of order — 
  a real hazard, not a theoretical one, and precisely why the authoritative state lives
  in a directly readable value rather than being reconstructed from event history.
- Deleting a server tears down every listener and open connection for it.

**The design principle underneath, and the most important thing to carry forward:**
events are notifications that something changed, never a durable record of what changed.
Every event that matters has a corresponding readable current value — state, latest usage
snapshot, log tail. A subscriber that misses an event recovers by reading. That is what
makes the aggressive dropping safe.

**Trust model.** Fully portable; it maps naturally onto a desktop event bridge to a UI
layer, and the no-replay property is exactly what a remounting view needs. Deliberate
divergences recommended: serialize event *handling* per server (Wings' concurrent
handling is its own footgun), and consider the gap marker Wings omits.

---

## Part VIII. Container-specific behavior (flagged as such)

The features in this part only exist because servers run in Docker containers on shared
hosts. They are summarized for completeness, with the few genuinely portable insights
called out.

### 29. Image management

The container image is pulled on every start — always attempting the newest version of
the tag; "always latest" *is* the update policy, with no only-if-missing mode. A naming
convention marks an image local-only (no pull attempted), and per-registry credentials
match by registry host and optional repository-path prefix, most specific winning. Pulls
are capped at 15 minutes and stream progress into the console as user-visible output
(start line, per-layer progress, finish line), bracketed by events so a UI can render a
"preparing" phase distinct from "starting."

**The portable part is the failure policy:** a failed pull with a matching local image
proceeds with a loud log line instead of failing the boot — a registry outage must not
take every server on the machine offline. Translated: *try to update the runtime artifact
(server jar, mod loader) on every launch, but never let a failed update block a launch
that could succeed with what is already on disk* — and give downloading its own visible
phase.

### 30. Resource limits

Memory, CPU quota, CPU core pinning, swap, block-IO weight, a process-count cap
(anti-fork-bomb, default 512), and a per-server OOM-kill toggle are applied at container
creation; memory/CPU/IO can also be adjusted live on a running server, where a live
application failure is a logged warning, not an error — the settings are saved and simply
apply on next boot ("settings are saved; application is best-effort," a sound pattern for
any live-reconfiguration feature). Some changes (removing pinning, removing a memory
limit) can never apply live and silently defer to next boot. CPU is expressed to users as
percent-of-one-core (100 = one core). When *no* CPU limit is set, the CPU knobs are
omitted entirely rather than sent as "unlimited," because their mere presence broke
Java's detection of available processors — absence and explicit-unlimited are not
equivalent. A CPU-burst feature (bank unused quota, spend it on spikes) degrades silently
where kernel support is missing, warning once rather than forever; IO weight is applied
only after probing that the host will honor it, since sending it blind failed container
creation on some hosts — detect the capability, not the version.

**The one insight that transfers directly: memory overhead.** The hard limit actually
applied is deliberately larger than what the user configured — about 15% extra for small
allocations (up to ~2 GB), 10% mid-range (to ~4 GB), 5% above, curve overridable — 
because a JVM configured for N of heap reliably exceeds N in resident memory, and a hard
limit of exactly N gets Java servers OOM-killed at random during garbage collection. The
configured value is kept as a soft reservation. Anyone setting heap flags for a local
Minecraft server, or warning a user who allocated 100% of their RAM, needs the same
insight. The visible consequence to manage: the reported ceiling does not match what the
user typed (§16) — label it.

### 31. Networking

A dedicated bridge network with configurable subnets/MTU/isolation; each server has one
primary address and port (handed to the process as environment variables and substituted
into config files) plus arbitrary extra mappings. **Every mapped port is bound for both
TCP and UDP unconditionally** — guessing which a given game needs is a losing game — and
out-of-range ports are silently skipped. A user asking to bind loopback almost never
means "reachable only from inside the container," so loopback bindings are silently
rewritten to the bridge address, with the environment variable rewritten to match: what
the user typed and what actually binds deliberately differ. Optional forcing of outbound
traffic onto the server's own primary address exists for games verified by external
master servers. **Portable:** bind both TCP and UDP for a game port, and be explicit with
the user about the address the server is actually reachable on.

### 32. Mounts and hardening

The server's data directory is bind-mounted to a fixed path in the container; additional
read-only/read-write mounts can be layered; a bounded memory-backed temp directory exists
because some installers need one (its size counts against host RAM untracked — a noted
footgun). Containers run with read-only root, no-new-privileges, dropped capabilities,
and a non-root user. The runtime contract's own guidance for non-container backends: the
mount list collapses to "the server's folder," and the hardening has no analogue when the
process runs as the user who owns the machine.

### 33. Ownership normalization

The recursive re-own pass (§4, §20) exists solely because the game runs in a container
under a different uid/gid than the daemon and files arrive (via extraction, transfers,
panel uploads) owned wrongly. A desktop app running everything as the user has no
equivalent problem and should drop it entirely.

---

## Part IX. Summary by trust model, and gaps worth closing

### Multi-tenant / Docker / untrusted-input machinery — do not port as-is

- Disk quota *enforcement* (refusing writes; stopping a running server for usage) and the
  negative-quota freeze.
- Suspension, and disconnect-everyone-on-suspend.
- The protected-file denylist.
- Activity logging of actions and commands with user identity and IP.
- SSRF defenses on restore-download URLs.
- Defensive caps on user-supplied input: the ignore file's size/symlink rules, UUID
  validation before deriving paths, the 64 MiB config parse ceiling (as a DoS guard;
  still reasonable as a sanity check).
- Reporting sandbox escapes as "not found" to avoid leaking host layout.
- All container hardening, resource-limit enforcement, networking rewrites, image
  registry auth, ownership normalization, backup write-throttling as tenant fairness, and
  fetching configuration from a remote authority each boot.

### Portable behavior — the heart of what is worth learning from Wings

- The four-state model; ready detection from configured output patterns (with regex
  option and ANSI stripping); stopping-as-a-shield so deliberate teardowns never look
  like crashes.
- One exclusive power-action lock per server, kill bypassing it, distinct
  error-per-refusal-reason, restart holding the lock across both legs.
- The narrated pre-boot sequence; rebuild-the-launch-spec-from-live-settings every start;
  attach-before-start; a hard budget on attach-plus-launch; failed starts walked through
  stopping.
- Declared per-server-type stop methods; graduated deadlines (generous for user stops,
  short for enforcement); escalation to kill; cancellation never cancels the kill;
  missing-process-is-success everywhere; idempotent stops.
- Typed-stop-command and echoed-stop-command intent marking.
- Crash detection by transition, the console crash banner with exit code and OOM flag,
  clean-exit-counts-as-crash default, restart through the ordinary power path, explicit
  message when detection is disabled.
- Console: 64 KiB line cap with truncation; carriage-return normalization (a Minecraft
  quirk specifically); chunks-may-contain-multiple-newlines contract; drop-oldest bounded
  fan-out with subscriber isolation; per-episode-latched flood throttling that drops
  output rather than punishing the server; independent channels for console versus
  install/job output; daemon narration inside the user's console.
- Stdin fire-and-forget with distinct not-attached errors.
- Stats semantics: absolute CPU, match-the-OS-tool memory, cumulative network, zero
  everything on stop, one-off snapshot for connecting clients, disk on its own slower
  cached cadence; the JVM memory-headroom insight.
- Cached directory-size accounting with stale reads for display and blocking reads for
  decisions; the once-per-boot enforcement latch pattern.
- Sandbox path confinement as a correctness boundary; never following symlinks on delete
  or during recursive walks; refuse-to-clobber renames; delete-missing-is-success;
  open-time size caps on reads of live-written files; FIFO rejection.
- Zip-slip prevention, archive-symlink neutralization, declared-size zip-bomb pre-checks,
  slash-boundary-aware selection matching; the in-use-file extraction error message.
- Backup as whole-directory tar.gz with gitignore exclusions, checksum-and-size on
  completion, one completion-event shape for success and failure; restore with
  stop-first, a protected state, an explicit merge-versus-wipe choice, and per-file
  progress.
- Config rewriting that pins specific keys, tolerates hand edits, creates missing
  structure, and never fails a boot; plain-text mode's byte-for-byte preservation of
  unmatched lines; visible-in-the-file placeholder failures; the curated substitution
  allowlist principle.
- Events as lossy notifications backed by readable authoritative values; no replay;
  snapshot-on-connect.
- State persistence with adopt-don't-kill recovery, bounded per-server recovery time, and
  bounded recovery concurrency.
- Treating every external dependency's absence or hang as a normal, bounded outcome.

### Wings' own weaknesses — close these rather than inherit them

- **No console history when offline and none across boots.** A locally written bounded
  per-session log per server beats it outright; "show me the console from the overnight
  crash" is table stakes for a desktop tool.
- **No quiescing before backups** — bracket the archive with the game's save commands to
  avoid torn region files.
- **No free-space checks anywhere** — the quota is an allowance, not physical
  availability; check real free space before backups, restores, and boots.
- **No checksum verification, no staging, no rollback on restore.**
- **No backup progress reporting.**
- **Crash-loop protection is one in-memory timestamp** — add a counter, escalating
  backoff, a terminal give-up state, persistence, and (desktop-only luxury) the option to
  ask the user.
- **Nothing ever times out a stuck "starting" state.**
- **Concurrent event handling breaks transition ordering** — serialize handling per
  server; it costs nothing locally.
- **Silent staleness**: stats streams die silently, and dropped output/events carry no
  gap markers — a local UI can and should say "numbers are stale" and "N lines dropped."
- **Non-atomic writes everywhere** (file writes, config rewrites) — use
  write-sibling-then-rename for anything precious.
- **Fragile details flagged above**: the broken conditional config edits, integer
  auto-coercion of numeric-looking strings, null/invalid placeholder leakage into files,
  YAML comment destruction, whole-listing failure on one unopenable file, byte-wise
  sort ordering, silent skip of denylisted archive entries, symlinks silently dropped
  from backups, and empty directories lost on archive creation.
