# Wings adoption: constraints and sequencing

The implementation companion for the 15 behaviors adopted from the Pterodactyl Wings
survey. Decisions and the full for/against record live in `survey/wings-triage.md`
(decision record at its end); the behavioral survey itself is `survey/wings.md`. This
file holds what every implementing session needs *beyond* its issue: the cross-cutting
constraints, the recommended order, and the reconciliations with pre-existing issues.

**How a future session should use this file.** Implement one issue per session per PR.
Read: this file, the issue being implemented, and the files the issue points at.
That is the whole required context — do **not** re-read `survey/wings.md` (only consult
it if the *why* behind a behavior is unclear; the issue names the relevant §), and do
not re-derive the triage. Code pointers in the issues were verified 2026-08-21;
re-verify them against the current tree before editing, and expect drift. Conventions,
gates and the definition of done are `agent_docs/CLAUDE.md`'s — they are not repeated
here.

## The set at a glance

| Issue | Item | Short name | Wave |
|---|---|---|---|
| [#112](../../issues/112) | 5 | Console capture survives long lines / CR | 1 |
| [#115](../../issues/115) | 8 | Quiesce world duplication | 1 |
| [#116](../../issues/116) | 9 | Atomic config/app-data writes | 1 |
| [#111](../../issues/111) | 4 | Exit code on crash | 1 |
| [#109](../../issues/109) | 2 | Per-server power-action lock | 2 |
| [#108](../../issues/108) | 1 | Lifecycle state machine + ready detection | 2 |
| [#110](../../issues/110) | 3 | Stop grace, escalation, force kill | 2 |
| [#113](../../issues/113) | 6 | Manager narration in the console | 2 |
| [#114](../../issues/114) | 7 | Free-space preflight | 3 |
| [#119](../../issues/119) | 12 | Cached directory sizes | 3 |
| [#120](../../issues/120) | 14 | JVM heap headroom warning | 3 |
| [#121](../../issues/121) | 15 | Stop-and-restore + start-during-restore guard | 3 |
| [#118](../../issues/118) | 11 | Past-session logs in the console tile | 4 |
| [#117](../../issues/117) | 10 | Ask on close + re-adopt on relaunch | 4 |
| [#57](../../issues/57) | 13 | Per-server shaping | constraint on 2–4 |

Owner decisions the set was calibrated against (2026-08-21): prompt on app close
(stop / leave running); crash handling stays notification-only (no built-in
auto-restart — the scheduler's crash trigger remains the recipe); concurrent servers
wanted eventually; past-session logs wanted in the console tile.

## Cross-cutting constraints

These apply to every issue in the set and are easy to violate one issue at a time:

1. **Shape per-server, never deeper into the singleton** (item 13, tracked by #57).
   Any new runtime state a wave-2+ issue introduces — state enum, lock, adoption
   record, per-session log handles — belongs in per-server-shaped state (see #57's
   `serverInstance` first step), or at minimum must not add new fields to the
   `ServerService` singleton that #57 would have to unpick. #57's "interim fix"
   (clear console/status on active-server switch) is aligned work: if a wave-2 issue
   touches those stores anyway, doing it in passing is in scope.
2. **Never break the `expectedStop` contract.** Crash detection is the transition
   "was running, went away, and no deliberate stop marked it expected". Every new
   teardown path (#110's escalation and force kill, #121's stop-and-restore, #117's
   close-time stop) must mark intent before the process exits, or users get crash
   notifications for deliberate stops — the exact failure the triage calls the most
   maddening. The reverse also holds: adopted-then-lost servers (#117) must *not* be
   marked expected.
3. **Events through the EventBus with constants** (`backend/services/events.go` +
   `frontend/src/lib/constants.ts`), payload structs in `backend/models/`, and
   `wails generate module` after any bound-method or model change. State-change
   events fire on actual change only; every event keeps a readable getter twin
   (`GetServerStatus` parity — the repo's existing rule, which Wings independently
   arrives at).
4. **New Go logic ships with tests** and minds the `backend/services` coverage floor
   (a ratchet — raise, never lower). The concurrency-sensitive issues (#109, #110)
   need race-shaped tests, not just happy paths.
5. **One issue, one PR**, labeled per the ladder in `agent_docs/CLAUDE.md`. The
   issues carry suggested `type:` labels; re-judge at PR time with the ladder, not
   the diff size.

## Recommended order and why

- **Wave 1 — independent bug fixes** (#112, #115, #116, #111): no dependencies, each
  a small self-contained PR, all bug-grade. Any order. #112 first is sensible; it is
  the only one whose failure mode (console silently dead) masks testing of everything
  else.
- **Wave 2 — lifecycle core** (#109 → #108 → #110 → #113): the lock is the choke
  point everything else threads through, so it lands first; the state machine rides
  on it; stop escalation needs both; narration (#113) wants the escalation stages to
  narrate but can land any time after #108.
- **Wave 3 — independent smalls** (#114, #119, #120, #121): any order, any time;
  #114 prefers #119's cached sizes for its estimates but can ship with a direct walk
  and pick up the cache later.
- **Wave 4 — the heavy feature** (#118 → #117): past-session logs first (independent
  value, and #117 needs it for the adopted-server console). #117 last, after #99
  (RCON auto-enable) and the wave-2 state machine exist. #117 also carries the
  platform design question (Job Object kill-on-close vs leave-running) that should be
  answered in the issue before code.

## Reconciliations with pre-existing issues

Recorded so nobody re-litigates or double-builds:

- **#101 (Starting/Stopping labels in Stats)** is the user-facing request; **#108
  implements it** and should close it. Do not build #101 separately.
- **#99 (auto-enable RCON like the EULA prompt)** was filed independently and is now
  also the prerequisite for #117's adopted-server control path. Its priority
  effectively rises with #117.
- **#30 (integrity check / corrupt-zip detection on restore)** overlaps the triage's
  *rejected* item 23 (backup checksums). Reassessment recorded 2026-08-21: the staged
  extract-then-swap already fails a corrupt zip during extraction (zip CRC per entry)
  *before* the live directory is touched, so #30's core need is structurally met.
  What #30 still legitimately covers is surfacing that failure clearly (and, if
  wanted, an explicit "verify backup" affordance). Decision on narrowing or closing
  #30 belongs to the owner; nothing in this set builds separate checksums.
- **#26 (back up sibling dimensions)** already tracks the multi-dimension backup gap
  the 2026-08-21 sweep re-found; the sweep also noted `worlds.go`'s "(+ siblings)"
  comment overstates today's behavior — fix the comment when #26 lands.
- **#29 (backup concurrency guard)** is the same missing-serialization family as
  #109; whoever builds #109 should skim #29 for shape alignment, but they stay
  separate PRs.
- **#42 (global JVM defaults)** is the natural future home of #120's warning.

## Rejected items and their standing triggers

The 21 rejections stand (triage items 16–36); the ones with concrete anchors:

- Item 20 (file-manager operation suite) → revisit when **#33** (file explorer tile)
  is built.
- Item 21 (zip-bomb pre-check, archive symlink neutralization) → revisit when
  **#31** (import external backup file) is built — imported archives are the first
  untrusted input.
- Item 22 (backup exclusions) → revisit if backup size actually hurts.
- Item 28 (per-server-type stop commands) → revisit if proxy support
  (BungeeCord/Velocity) ever lands.
- Item 29 (bounded event fan-out / backend flood throttle) → revisit at the first
  real output flood, or if the scheduler ever subscribes to `log:line`.

Everything else rejected has no trigger and should not come back without a new
argument (`survey/wings-triage.md` records the reasoning to argue against).
