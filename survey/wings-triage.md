# Wings survey triage: what Konnekt adopts

Companion to [`wings.md`](wings.md) (the clean-room behavioral survey of Pterodactyl
Wings). That document describes what Wings does; this one argues, per surveyed feature,
whether it belongs in Konnekt — a single-user local desktop app whose owner already
fully controls the servers it manages, with no tenancy, no untrusted input, and no
isolation boundary to defend.

**How to use this file.** Every item carries an **Adopt / Reject** checkbox pair. The
section an item sits in (Clear fit / Needs adaptation / Doesn't belong) is the
*recommendation*; the ticked box is the *decision*. Items left with neither box ticked
are undecided. Some rejected items carry an explicit revisit trigger in their notes —
rejecting them now does not erase the trigger.

**Owner answers this triage was calibrated against** (recorded 2026-08-21):

- **App close:** prompt on close — offer both "stop the server" and "leave it running."
- **Crash restart:** notification only; no built-in auto-restart. The visual scheduler's
  crash-trigger → start-server recipe remains available for power users.
- **Concurrency:** one server at a time today, but concurrent servers are wanted
  eventually — adopted lifecycle work should be shaped per-server.
- **Old logs:** yes — past-session console (e.g. after an overnight crash) should be
  readable inside the console tile.

**Where Konnekt is already ahead of Wings** (nothing to adopt; listed so the survey
doesn't read as one-way):

- Staged extract-then-swap restore with rollback on failure. Wings restores in place
  with no rollback.
- save-off / save-all flush / save-on quiescing around backups of a running server.
  Wings has no quiescing at all — its worst backup flaw.
- Comment- and order-preserving editing of `server.properties` and YAML. Wings' rewrite
  engine destroys YAML comments entirely.
- Event/getter parity with refetch-on-event and a reachability flag — the exact
  "readable authority behind every event" principle Wings arrives at.

---

## Clear fit

Recommended for adoption. Several are really Konnekt bugs the comparison exposed rather
than features to build.

### 1. "Starting" state + ready detection from console output (survey §1–2)

- **For:** Konnekt flips to running the instant the process spawns; a server
  mid-worldgen is indistinguishable from one accepting players. The console scanner
  already exists (player/EULA/stopping patterns), so the mechanism slots in, and the
  arbitrary 15-second TPS-poll delay could key off real readiness instead.
- **Against:** Adds a state enum through store and UI; ready-pattern maintenance per
  server flavor; Wings' stuck-in-starting failure mode.
- **Note:** Adopt *with* the timeout Wings lacks, and shaped per-server (see owner
  answer on concurrency).

- [ ] **Adopt**
- [ ] **Reject**

### 2. One power-action lock per server; restart holds both legs (survey §3)

- **For:** Fixes observed races: unguarded concurrent Stops, restart's stop-then-start
  race losing to the running flag still being set, and restart on a stopped server
  erroring without ever starting.
- **Against:** A singleton could get by with a plain mutex — but concurrency is wanted
  eventually, so per-server is the right shape at the same cost.

- [ ] **Adopt**
- [ ] **Reject**

### 3. Graduated stop deadlines, escalation, explicit force-kill bypassing the lock (survey §5)

- **For:** Today's stop is a fixed 8-second grace then a SIGKILL of the process tree — a
  genuine data-loss risk mid-save on a large world. Wings' shape (generous grace for
  user-initiated stops, visible escalation, kill as an explicit escape hatch) addresses
  exactly this.
- **Against:** Wings' 10-minute default is hosting-scale; a desktop app wants shorter,
  configurable numbers and a visible "force stop" button, not the full policy set.

- [ ] **Adopt**
- [ ] **Reject**

### 4. Crash reporting: capture and surface the exit code (survey §6, reporting slice only)

- **For:** Konnekt currently discards the exit status entirely; the crash notification
  says only "stopped unexpectedly." The exit code is the top JVM diagnostic and costs
  almost nothing to capture and show.
- **Against:** Wings' OOM flag half is cgroup-specific; the desktop analogue (spotting
  OutOfMemoryError in the log) is optional extra.

- [ ] **Adopt**
- [ ] **Reject**

### 5. Console capture hardening: truncate-and-continue long lines, carriage-return normalization (survey §9)

- **For:** Fixes a latent bug: the default 64 KiB scanner token limit means one giant
  stack-trace line silently kills console streaming for the rest of the session. The
  stray-carriage-return quirk Wings normalizes is Minecraft's own.
- **Against:** None serious — a bug fix wearing a feature's clothes.

- [ ] **Adopt**
- [ ] **Reject**

### 6. Supervisor narration in the console stream (survey §14)

- **For:** Backup start/failure, kill-after-timeout, EULA writes, and install steps are
  invisible in the console narrative today. The survey's best value-per-effort: one
  prefixed line type, and the console becomes a debuggable sequence of both the server
  and its manager.
- **Against:** Partially duplicates the notification feed; needs restraint to stay at
  lifecycle moments rather than chatter.

- [ ] **Adopt**
- [ ] **Reject**

### 7. Free-space preflight before backup, restore, and world duplication (survey's flagged gap)

- **For:** Konnekt checks nothing; a full disk is the likeliest local backup failure and
  currently surfaces as a mid-write error. A cheap check with a clear message.
- **Against:** "Engineering without need" if disks are large — but the cost is low
  enough that the argument doesn't hold.

- [ ] **Adopt**
- [ ] **Reject**

### 8. Quiesce world duplication (survey §23's torn-region caveat, applied)

- **For:** World duplication is the one world operation with no running-server guard and
  no quiescing — it can copy live chunk files. The existing save-off/save-all machinery
  covers it with a one-call reuse.
- **Against:** None — bug-grade, found by the comparison.

- [ ] **Adopt**
- [ ] **Reject**

### 9. Atomic writes (temp file + rename) for config and app-data files (survey weakness list; Wings shares the flaw)

- **For:** Config writes are truncate-then-write; a crash mid-write corrupts the file,
  and the three-copy backup rotation doesn't protect the file currently being written.
  The temp+rename pattern already exists in this repo (mod downloads, restore) — just
  not where it matters most.
- **Against:** Windows rename fiddliness; the harm frequency is low.

- [ ] **Adopt**
- [ ] **Reject**

---

## Needs adaptation

Recommended in principle; the mechanism must diverge from Wings.

### 10. State persistence + adopt-on-relaunch; "never kill what you find running" (survey §8)

*Pulled into scope by the "ask me on close" owner answer.*

- **For:** The keep-running option on close needs exactly this: persist identity and
  PID, find the process on relaunch, adopt instead of colliding on the port, verify
  liveness within a bounded budget.
- **Against / adaptation:** Heavy. Stdin cannot be reattached, so an adopted server is
  controlled via RCON only (Konnekt should offer to enable RCON) with console via log
  tailing. PID-reuse checks needed. Wings' principles transfer; its mechanism doesn't.

- [ ] **Adopt**
- [ ] **Reject**

### 11. Console history for stopped servers and past sessions (survey §13)

*Pulled into scope by the "old logs in the console tile" owner answer.*

- **For:** "Show me the console from the overnight crash" is the survey's core desktop
  lesson, and it also provides the console view for an adopted server (item 10).
- **Against / adaptation:** Diverge from Wings entirely: don't write Konnekt-side logs —
  read Minecraft's own `logs/latest.log` and rotated archives, which every supported
  flavor already writes. Needs tail-reading for large files. Wings structurally cannot
  do this; Konnekt can.

- [ ] **Adopt**
- [ ] **Reject**

### 12. Cached, background-refreshed directory sizes (survey §17, caching pattern only)

- **For:** Konnekt runs synchronous full directory walks per call for world sizes and
  the backup-progress denominator; a large modded world will stall those paths.
  Stale-read-plus-background-refresh is exactly right.
- **Against / adaptation:** Cache invalidation complexity for something not yet reported
  slow. The quota *enforcement* attached to this in Wings stays rejected (item 20).

- [ ] **Adopt**
- [ ] **Reject**

### 13. Per-server shaping of lifecycle state, console buffer, and stats history (survey §1/§16, consequence of the concurrency answer)

- **For:** The 1-hour stats ring is global today and survives server switches, showing
  the previous server's data on the chart. Anything adopted above should be keyed
  per-server so eventual concurrency doesn't force a rewrite.
- **Against:** This is architectural guidance, not a feature: don't build multi-process
  supervision now, just stop baking the singleton deeper.

- [ ] **Adopt**
- [ ] **Reject**

### 14. JVM memory-headroom warning (survey §30, the one portable piece of resource limits)

- **For:** A JVM given N of heap uses more than N of resident memory; a user who sets
  the max-heap flag at nearly all of physical RAM gets OS-level thrashing. Konnekt
  already parses the heap args and can read total RAM — a one-line warning in the server
  form.
- **Against / adaptation:** Nanny UX for a knowledgeable owner; advisory only, since
  there is no enforcement to attach it to locally. Small, low priority.

- [ ] **Adopt**
- [ ] **Reject**

### 15. One-click "stop, then restore" (survey §25's stop-first, softened)

- **For:** Refusing restore while the server runs is safe but two-step; Wings auto-stops
  with a bounded grace.
- **Against / adaptation:** Konnekt's explicit refusal is arguably better for a
  destructive operation. Adopt only as a convenience button on the refusal message,
  never as a silent auto-stop.

- [ ] **Adopt**
- [ ] **Reject**

---

## Doesn't belong

Recommended for rejection. Where a revisit trigger exists it is named; rejecting the
item keeps the trigger.

### 16. Crash auto-restart with loop protection (survey §6)

- **For:** Keeps unattended servers up.
- **Against:** The owner chose notification-only, and the scheduler already expresses
  crash → start with a cooldown for anyone who wants it. Zero new machinery needed.

- [ ] **Adopt**
- [ ] **Reject**

### 17. Disk quotas and enforcement: refusing writes, stopping over-quota servers, freeze semantics (survey §17)

- **For:** Bounds runaway disk use.
- **Against:** Landlord machinery. Refusing the owner's writes on their own disk is
  hostile; the real local need (actual free space) is item 7.

- [ ] **Adopt**
- [ ] **Reject**

### 18. Sandbox beyond lexical checks: handle-based race-immune confinement, escapes reported as "not found" (survey §18)

- **For:** Defense in depth against path-handling bugs.
- **Against:** The threat (a hostile tenant racing the daemon) doesn't exist. Konnekt's
  lexical validation and zip-slip guard already cover the own-bug case; hiding escapes
  as "not found" is actively wrong for a local user.

- [ ] **Adopt**
- [ ] **Reject**

### 19. Protected-file denylist (survey §19)

- **For:** Prevents edits to operator-owned files.
- **Against:** Operator-versus-tenant control; Konnekt's user *is* the operator.

- [ ] **Adopt**
- [ ] **Reject**

### 20. File-operation suite: refuse-clobber rename, copy-name suffixing, batch move semantics, listing with MIME sniffing (survey §20–21)

- **For:** Well-tested behavioral choices for a file manager.
- **Against:** Konnekt has no file manager — that's the Beta file explorer, explicitly
  out of Alpha scope.
- **Revisit trigger:** when the file explorer tile is built, crib these rows (plus lazy
  sniffing and natural sort, where Wings itself is weak).

- [ ] **Adopt**
- [ ] **Reject**

### 21. Hostile-archive defenses: zip-bomb declared-size pre-check, symlink neutralization (survey §22)

- **For:** Archives from the internet are untrusted even for a trusted local user.
- **Against:** Konnekt currently extracts only its own backups, which already carry the
  zip-slip guard.
- **Revisit trigger:** the day an "import world/modpack zip" feature exists.

- [ ] **Adopt**
- [ ] **Reject**

### 22. Backup exclusions via gitignore patterns / dot-ignore file (survey §23)

- **For:** Smaller archives — today's zips include jars, mods, and logs.
- **Against:** A full-server backup means full-fidelity restore; exclusions complicate
  restore expectations, and config-by-hidden-dotfile is hosting UX.
- **Revisit trigger:** backup size actually hurting.

- [ ] **Adopt**
- [ ] **Reject**

### 23. Backup checksums (survey §24)

- **For:** Detect corruption before restore.
- **Against:** Zip already CRC-checks every entry on extraction, so a corrupt backup
  fails the staged restore before the swap. The existing design already delivers the
  outcome.

- [ ] **Adopt**
- [ ] **Reject**

### 24. Offloaded backups: multipart upload to pre-signed URLs (survey §24)

- **For:** Off-machine backup copies.
- **Against:** Assumes a control plane. If "copy backups elsewhere" ever matters, it's a
  folder or rclone-style target, not this.

- [ ] **Adopt**
- [ ] **Reject**

### 25. Merge-vs-wipe restore choice (survey §25)

- **For:** Flexibility.
- **Against:** Konnekt's swap restore is strictly safer and simpler; merge semantics
  answer a hosting-panel question nobody asks a desktop tool.

- [ ] **Adopt**
- [ ] **Reject**

### 26. Restore-URL SSRF validation (survey §25)

- **For:** Blocks hostile URLs.
- **Against:** No untrusted caller ever supplies a URL.

- [ ] **Adopt**
- [ ] **Reject**

### 27. Boot-time config templating and the multi-format rewrite engine (survey §26–27)

- **For:** Guarantees settings apply at launch.
- **Against:** The authority model is inverted: Wings pins settings *against* the
  tenant; Konnekt's owner is the authority and edits via a UI that already preserves
  comments better than Wings' engine destroys them.
- **Note:** Sole exception worth considering separately: offering to enable RCON in
  `server.properties` when it's off (user-confirmed, one key) — relevant to item 10.

- [ ] **Adopt**
- [ ] **Reject**

### 28. Per-server-type stop commands (survey §5 slice)

- **For:** Generality across games.
- **Against:** Konnekt is Minecraft-only; `stop` is universal.
- **Revisit trigger:** proxy support (BungeeCord/Velocity use different stop commands).

- [ ] **Adopt**
- [ ] **Reject**

### 29. Bounded drop-oldest event fan-out + backend flood throttling (survey §11–12, §28 transport)

- **For:** Protects against output floods; Konnekt's event bus is unbounded
  goroutine-per-event and each console line crosses the IPC bridge individually.
- **Against:** No in-process subscriber to console lines exists, the frontend already
  batches at 150 ms, and no flood incident has occurred. A structural pressure point,
  but adopting now is engineering without a matching failure.
- **Revisit trigger:** the first real output flood, or the scheduler subscribing to log
  lines.

- [ ] **Adopt**
- [ ] **Reject**

### 30. Event taxonomy / readable-authority redesign (survey §28)

- **For:** Sound principles.
- **Against:** Konnekt already implements the same principles — getter parity,
  refetch-on-event, the reachability flag. Pure duplication.

- [ ] **Adopt**
- [ ] **Reject**

### 31. Runtime-backend abstraction layer (survey §7)

- **For:** A clean seam for a second backend.
- **Against:** One runtime exists (a child process) and none is planned; an abstraction
  with one implementation is speculative generality. The one transferable habit —
  "a missing process is a normal outcome, not an error" — belongs inside item 10, not
  in a layer.

- [ ] **Adopt**
- [ ] **Reject**

### 32. Always-pull image policy / update-tolerant launch (survey §29)

- **For:** Fresh runtime artifacts at every launch.
- **Against:** Konnekt fetches nothing at launch; self-update is separate and already
  doesn't gate anything.

- [ ] **Adopt**
- [ ] **Reject**

### 33. Container resource limits: CPU quota/pinning/bursting, PID caps, OOM toggles, IO weight (survey §30)

- **For:** Contain misbehaving servers.
- **Against:** cgroup/container machinery. A local owner has the OS's own tools, and
  Konnekt already controls the knob that matters (JVM heap args). The one portable
  insight is item 14.

- [ ] **Adopt**
- [ ] **Reject**

### 34. Networking: port rewriting, dual TCP/UDP binds, bridge networks, loopback rewriting (survey §31)

- **For:** Correct reachability in a containerized world.
- **Against:** The server binds itself from `server.properties`; Konnekt manages no
  network layer.

- [ ] **Adopt**
- [ ] **Reject**

### 35. Mounts, container hardening, ownership normalization (survey §32–33)

- **For:** Isolation and uid/gid repair.
- **Against:** Exists solely because the game runs containerized as a different user.
  No local analogue at all.

- [ ] **Adopt**
- [ ] **Reject**

### 36. Suspension, the protected-state web, activity log with user identity and IP (survey cross-cutting)

- **For:** Administrative control and audit.
- **Against:** Billing and tenancy concepts. The one sliver with local value — blocking
  Start during an in-flight restore — is a one-line guard worth folding into the restore
  path, not a state system.

- [ ] **Adopt**
- [ ] **Reject**
