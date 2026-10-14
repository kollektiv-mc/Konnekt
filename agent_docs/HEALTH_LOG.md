# Konnekt — Project Health Log

The completed remediation history for `agent_docs/HEALTH_CHECKLIST.md`: the
per-session narrative of health gaps that have been **closed**, split out of the
checklist so that file stays a lean, scannable yardstick. When a checklist
`Open backlog` item is closed, its write-up moves here, newest last. `✅` marks
a closed item.

- Evergreen quality yardstick + still-open items: `agent_docs/HEALTH_CHECKLIST.md`
- Architecture conventions + build/test commands: `agent_docs/CLAUDE.md`
- Feature scope (Alpha/Beta): `agent_docs/ROADMAP.md`

## The cap

**This file stays under 3,000 lines.** `scripts/check-health-log.mjs` holds it,
in the health run (`.claude/suite.json`) and in CI's `invariants` job. The log
reached 6,182 lines in the two months after it adopted dated entries, about
2,200 a month and 85 an entry, which is past what a session opens in one go,
and a record is only consulted while its recent part is small enough to read.

When an entry takes the file over the cap, move the oldest whole month out to
`agent_docs/health-log/YYYY-MM.md`, index lines included, until it is under
again, and list the file under `Archived` below. The current month never moves,
so the cap stays above the largest month so far (August 2026, 2,465 lines), and
an entry that archiving cannot pay for is one to shorten. An archived month is
not edited: a correction is a new entry here that names the old one.
`agent_docs/health-log/undated.md` holds what was written before the log
adopted dates, grouped by finding.

## Index

Newest last. Each archived file carries its own index.

**By date**

- [2026-09-01 — The tile that took the dashboard with it](#2026-09-01-the-tile-that-took-the-dashboard-with-it)
- [2026-09-01 — The chart that rendered once per tick of the clock](#2026-09-01-the-chart-that-rendered-once-per-tick-of-the-clock)
- [2026-09-01 — The crash you could see but not send](#2026-09-01-the-crash-you-could-see-but-not-send)
- [2026-09-02 — The overlays that took turns losing](#2026-09-02-the-overlays-that-took-turns-losing)
- [2026-09-05 — The overlay the tile kept, and six smaller repairs](#2026-09-05-the-overlay-the-tile-kept-and-six-smaller-repairs)
- [2026-09-07 — The restore that failed as a backup, and four smaller repairs](#2026-09-07-the-restore-that-failed-as-a-backup-and-four-smaller-repairs)
- [2026-09-08 — The audit brief, and the gate that came out of it](#2026-09-08-the-audit-brief-and-the-gate-that-came-out-of-it)
- [2026-09-08 — The mod description that could reach the bridge](#2026-09-08-the-mod-description-that-could-reach-the-bridge)
- [2026-09-08 — The kick reason that was two commands](#2026-09-08-the-kick-reason-that-was-two-commands)
- [2026-09-08 — The server id that was a path](#2026-09-08-the-server-id-that-was-a-path)
- [2026-09-08 — The backup that reported a flush it never made](#2026-09-08-the-backup-that-reported-a-flush-it-never-made)
- [2026-09-11 — The vendored file the gate reformatted](#2026-09-11-the-vendored-file-the-gate-reformatted)
- [2026-09-12 — The listing that could panic on a vanished file, and three smaller repairs](#2026-09-12-the-listing-that-could-panic-on-a-vanished-file-and-three-smaller-repairs)
- [2026-09-13 — The backup tests that pinned nothing, and the perfect scores that were a leftover file](#2026-09-13-the-backup-tests-that-pinned-nothing-and-the-perfect-scores-that-were-a-leftover-file)
- [2026-09-16 — The two thirds of a world the backup never took](#2026-09-16-the-two-thirds-of-a-world-the-backup-never-took)
- [2026-09-16 — The schedules that followed the sidebar](#2026-09-16-the-schedules-that-followed-the-sidebar)
- [2026-09-18 — The type scale sweep reaches the whole tree](#2026-09-18-the-type-scale-sweep-reaches-the-whole-tree)
- [2026-09-18 — Per-server scoping gets its gates](#2026-09-18-per-server-scoping-gets-its-gates)
- [2026-09-18 — The superseded jar survives a failed install](#2026-09-18-the-superseded-jar-survives-a-failed-install)
- [2026-09-19 — The zip bomb the standard library had already stopped](#2026-09-19-the-zip-bomb-the-standard-library-had-already-stopped)
- [2026-09-21 — The scroll that felt like dragging was the physics, not the pixels](#2026-09-21-the-scroll-that-felt-like-dragging-was-the-physics-not-the-pixels)
- [2026-09-21 — Linux gets the GPU back](#2026-09-21-linux-gets-the-gpu-back)
- [2026-10-09 — Vite 8, and the test runner it could not leave behind](#2026-10-09-vite-8-and-the-test-runner-it-could-not-leave-behind)
- [2026-10-09 — The updater tests that survive mutation](#2026-10-09-the-updater-tests-that-survive-mutation)

**Archived**

- [`health-log/undated.md`](health-log/undated.md): 20 entries grouped by
  finding, written before dated entries, no reliable date
- [`health-log/2026-08.md`](health-log/2026-08.md): 30 entries, 2026-08-15 to
  2026-08-30

---

## Entries

### 2026-09-01 — The tile that took the dashboard with it

**Closed:** the P2 backlog item "One `ErrorBoundary` for eleven tiles, and now
five lazy chunks" (filed 2026-08-29).

**The gap.** `main.tsx` wraps the whole app in one `ErrorBoundary` whose
fallback is a full-screen "render error", and until the Overview tile (#211)
put a boundary around each of its sections, that was the only one in the tree.
So any tile that threw during render replaced the entire dashboard — every
other tile, the sidebar, the title bar — with two lines of monospace, and the
only way back was a relaunch. That was already true for the two original lazy
tiles; the 2026-08-29 split took the lazy count to five, on tiles people open
routinely, and #184 removed the one *live* trigger (a binding called with no
bridge) without touching the blast radius. What kept the item open was a design
question rather than plumbing: what should a dead tile offer?

**The answer** turned out to be smaller than the question. The header of every
tile is rendered by `TileWrapper` *above* its content slot and already carries
Remove and Maximize/Restore. With the boundary placed around the content slot
alone (`tiles/TileWrapper/index.tsx`), "remove" costs nothing and needs no new
UI, and maximizing a failed grid tile is a fresh mount of the same tile in the
overlay, which is a retry by another name. What the fallback adds is one
control: Retry, which bumps a counter the boundary is keyed on, so the failed
subtree is unmounted and the tile mounts again from scratch, fresh state and
fresh effects, rather than the same instance being asked to try again with
whatever it had when it threw. The copy is "tile failed to render" plus the
error message, in the lowercase mono register of the Overview's "unavailable"
and the app's "render error"; the header above it already names the tile.

`ErrorBoundary`'s `fallback` now also accepts a function of the error, which
is what lets the tile show the message. The node form the Overview passes and
the full-screen default are unchanged.

Why the wrapper and not eleven tiles: `TileWrapper` is the one component every
tile renders through, canvas copy and maximized copy alike (`Dashboard.tsx`),
the same argument #164 makes for its wheel handler. One boundary there covers a
tile that exists today and one added next month, with nothing to remember. The
Overview's per-section boundaries stay on top of it: the wrapper's would keep a
throwing section from reaching the app but would blank the other four with it,
and one readout going dark should not cost the rest. (`Section.tsx`'s comment
said the app-level boundary was "the only other one"; it now says this.)

**Known and accepted.**

- Retry after a *failed chunk load* remounts the tile but cannot make React
  re-request the chunk: `lazy()` caches a rejected factory and rethrows it on
  every later render. The frontend is `go:embed`ed and served locally, so a
  chunk request does not fail in a well-formed build; for that case the
  boundary's job is containment, which the test pins, not recovery.
- Retry counts nothing and backs off nothing. A tile that throws
  deterministically fails again on every press, inside its own frame, which is
  the correct answer for a render bug and needs no cleverness.
- The fallback sits inside the tile's `overflow-hidden` frame, so a very long
  message wraps with `break-all` and is clipped past that rather than scrolled.
- React reports a caught error through `console.error`, which in a packaged
  WebView build goes nowhere. `konnekt.log` (2026-08-20) captures the backend
  only, so a tile crash a user can now *see* is still one they cannot attach to
  a report. Filed as [#245](../../issues/245): same mechanism as #97, the
  diagnostic exists and the packaged build throws it away.
- #234 will key the tile tree by server; when it does, a server switch remounts
  the wrapper and its boundary with it, which is the right reset for a tile
  that failed on one server's data. Nothing here has to change for that.

**Verification.** `tiles/TileWrapper/index.test.tsx` renders a throwing child
and a rejected `lazy()` import inside a `Suspense`, through the wrapper,
*inside* the app-level boundary, and asserts the app's "render error" never
appears while the tile's header, Remove, Maximize and Restore all keep working;
Retry is driven by a flag the test flips rather than a "throws N times"
counter, because React retries a failed render once before handing it to a
boundary and a counter would have to know that number. Run against the wrapper
from before this change, seven of the eight cases fail and the eighth is the
nothing-throws control. `components/ErrorBoundary.test.tsx` covers the three
fallback forms directly.

Frontend suite 703 tests across 58 files, up from 691 across 56; lint holds at
14 warnings, byte-identical to the count on the tree before this change, and
typecheck and `format:check` are clean. Entry chunk 154.5 KB gzip against the
165 KB budget, `check-tokens` and `check-prefetch` green, the three generated
token files already current, and the border invariant finds nothing. Go is
untouched and re-run anyway against the fresh `dist`: `go vet` and `go test`
clean, `backend/services` at 59.7% against the 49% floor.


### 2026-09-01 — The chart that rendered once per tick of the clock

**Closed: [#209](../../issues/209)**, filed from the 2026-08-30 no-bridge work.

**The gap.** The Performance tile's maximized view anchors its time window on
the newest sample, or on `Date.now()` when there is no sample to anchor to. It
read the clock per render, and fed the cutoff derived from it to a `setState`
effect keyed on that cutoff. With history empty, every render therefore
produced a fresh cutoff, the effect fired, its `setState` scheduled the next
render, and that render read the clock again. Each render scheduled the next
for as long as consecutive renders landed in different milliseconds.

Two things about the shape of this are worth recording, because the issue got
one of them wrong and the other decides how much it mattered.

The issue said React "eventually cuts it off". It does not. Checked in the
installed `react-dom` 19.2.7 rather than from memory: the `setState`-inside-
`useEffect` guard is a development-only `console.error` after fifty nested
updates that resets its counter and carries on, and the production build
carries no such check at all. The two warnings the issue saw in Chromium were
that counter wrapping twice. In a packaged build the loop is silent, unbounded,
and burns a core until the tile is closed.

And the mount alone does not start it. The effect's first `setState` carries
the value the state was initialised with, so React bails out. What starts it is
any re-render from above, and Dashboard's maximize animation supplies several
while the overlay opens; one is enough. So the condition is exactly: the
Performance tile maximized, and no history. `stats.go` emits no snapshot while
a server is stopped, so a server that has never run has no history at all, and
every maximize on one spun until the tile was closed. The compact summary and
the Overview's section do not have the anchor and never spun.

**The fix** (`tiles/performance/index.tsx`) memoizes the anchor on `history`,
so the clock is read only when the history changes. The invariant it restores
is the one the issue named: a render must not be able to change its own
effect's dependency. Keying the effect on `history.length` was the other
candidate and was rejected; it hides the dependency rather than removing it.

**Verification.** `tiles/performance/index.test.tsx`, the folder's first test,
renders the tile maximized with no bridge so history stays empty, re-renders it
once from above, stubs `Date.now` to advance on every call, and after 250ms
asserts the maximized view read the clock fewer than ten times and React's
loop warning never fired. It renders through `createRoot` with the act
environment off rather than through Testing Library: `render` runs inside
`act()`, which keeps flushing effects until the tree goes quiet, so the loop
would have hung the test instead of failing it. Against the unfixed code the
count was **288** in the 250ms window; the first draft, without the parent
re-render, passed vacuously, which is how the mount bail-out above was found.

Frontend suite 693 tests across 57 files, up from 691 across 56; lint holds at
14 warnings, byte-identical to the count before this change; typecheck and
`format:check` clean. Entry chunk 154.3 KB gzip against the 165 KB budget,
unchanged to the tenth of a kilobyte, and `check-tokens` and `check-prefetch`
green. Go is untouched and re-run anyway: `go vet` and `go test` clean,
`backend/services` at 59.6% against the 49% floor.


### 2026-09-01 — The crash you could see but not send

**Closed: [#245](../../issues/245)**, filed earlier the same day from the
per-tile boundary work.

**The gap.** `konnekt.log` exists so a bug reporter has something to attach
(#97, 2026-08-20), and it captured the backend only. React reports a caught
render error through `console.error`; an uncaught exception or an unhandled
rejection goes to the WebView's console. A packaged build has neither a
terminal nor devtools, so all three went nowhere. The per-tile boundary made a
tile crash *visible*, "tile failed to render" with the message in the tile's
own frame, and left it exactly as unreportable as before: the same mechanism as
#97, the diagnostic exists and the packaged build throws it away.

**The fix.** One bound method, `LogClientError(origin, message, stack)` on
`App`, writing one `slog.Error` line tagged `frontend:` through the default
logger `services.InitLogger` already points at the file. Each field is clamped
to a rune budget (64, 1024, 8192) so a minified stack plus a component stack
cannot eat the log on its own, and the method cannot fail, because a logger
that can fail is a second error to log.

On the frontend, `lib/clientErrors.ts` is the one path in. `reportClientError`
returns before touching the binding when there is no bridge, which is the
browser-only preset where the binding would throw synchronously, and otherwise
fires it and swallows both a synchronous throw and a rejection, since it runs
from inside error handlers and has nothing to revert and nobody to rethrow to;
that empty catch is the contract, not the swallowed write the IPC conventions
warn against. `ErrorBoundary.componentDidCatch` calls it with React's component
stack, which is the part worth having: a production JS stack is minified, the
component stack names the tile. Every boundary in the tree, app-level,
Overview section and tile, goes through that one hook. `main.tsx` installs
window `error` and `unhandledrejection` listeners before React mounts, so an
exception that escapes and a promise nobody handles, which is the shape of
every binding called from a click handler without a catch (#185), land in the
same file. Nothing is logged twice: React 19 routes an error no boundary caught
through `reportError`, which fires the window listener, and an error a boundary
did catch reaches `componentDidCatch` and never fires it.

**Known and accepted.**

- No dedupe or rate limit. A tile retried repeatedly logs repeatedly, bounded
  by the log's 2 MiB rotation and the per-line clamp.
- Production stacks are minified and stay so. Source maps are not shipped and
  this does not propose to; the message and the component stack carry the
  triage value.
- With no bridge nothing is logged, by design. The preset has a devtools
  console and no log file to reach.

**Verification.** `lib/clientErrors.test.ts` (7 cases): silent with no bridge,
forwards origin, message, stack and detail with one, takes a non-Error reason,
never throws when the binding throws synchronously, never leaves a rejection
unhandled when it rejects, the window listeners forward both event types until
uninstalled, and a withheld error object falls back to the event message.
`ErrorBoundary.test.tsx` gains the case that a caught error is reported with a
component stack naming the subtree. On the Go side `client_error_test.go` pins
the line on the default logger, the clamp on every field and that the clamp
cuts on rune boundaries.

Two things found by writing those tests rather than by reading. Vitest's jsdom
environment re-raises a window `error` event that carries an error object as an
uncaught exception whenever no user `error` listener is registered, so the
"after uninstall, nothing is forwarded" probe has to use the rejection event;
the first draft used another `ErrorEvent` and failed the run from outside any
test. And the bindings regeneration the checklist's Clean pillar asks for was
run both ways here: the pinned CLI installed in a cloud container in about two
minutes, regenerating with no source change produced a byte-identical tree in
six seconds, and regenerating after the Go change produced exactly the one new
method in `App.d.ts` and `App.js`, nothing else. 92/92 bound methods and 45
emitted structs; the checklist said 83 and 36, which had been stale since the
multi-server and loader work landed.

Frontend suite 713 tests across 60 files, up from 705 across 59 on the branch
this stacks on; lint holds at 14 warnings, byte-identical to the count before
this change; typecheck and `format:check` clean. Entry chunk 154.7 KB gzip
against the 165 KB budget, up 0.2 KB for the reporter, and `check-tokens` and
`check-prefetch` green. `gofmt`, `go vet` and `go test` clean,
`backend/services` at 59.6% against the 49% floor.


### 2026-09-02 — The overlays that took turns losing

**Closed: [#178](../../issues/178)**, and the P2 backlog item "Modal stacking
is nine files' worth of literal z-index" (filed 2026-08-31).

**The gap.** Fifteen distinct z-index values across `frontend/src`, thirteen
surfaces sharing `z-50`, and the only record of which had to beat which was a
comment on the loser, written after it lost. It lost twice on the record: the
server manager opened underneath a maximized tile because both were `z-50` and
`<aside>` comes before `<main>`, and the mods tile's dependency dialog opened
underneath the preview that raised it, at `z-50` against a `z-[400]` backdrop.
Each fix was local, move the manager to App level, raise the dialog to
`z-[500]`. Neither was a rule, and the next `fixed` overlay written inside a
tile or the sidebar would have rolled the same dice.

**The fix.** Five named layers in one place, `lib/layers.ts`: `overlay` (the
maximized tile) 100, `modal` 200, `dialog` 300, `popover` 400, `splash` 500,
with the table of what goes where and the rule of thumb that if a surface opens
another it is a modal and what it opens is a dialog. Production reads them as
classes, `z-modal` and so on, because the inline-style lint rule makes
`style={{ zIndex }}` an error everywhere and the existing test read the value
off `className`. The classes exist because `style.css` declares the same
numbers as `--z-index-*` in its one hand-authored `@theme` block, the namespace
Tailwind v4's `z` utility resolves, checked in the tagged v4.3.2 source rather
than remembered. Two spellings of one scale, so `lib/layers.test.ts` reads the
CSS and asserts it equals the module, and `check-token-classes.mjs` now takes
`z-<name>` from that block as candidates, so "the class compiles to a rule"
holds for the scale the way it holds for the colours.

Twenty-five sites converted, each checked against what it actually competes
with rather than given its old number back. Three of those checks changed the
answer a naive conversion would have given. The crate drag preview is
`z-popover`, not `z-overlay`: it renders before the maximize overlay in the
same context, so an equal value would draw it under a tile maximized mid-drag,
and a pointer-attached transient is what the popover layer is for. The
`EulaModal` stays `z-modal`, which keeps today's order, although it is
event-raised and can open under the manager or Settings (both `z-modal`,
rendered later); one class fixes that and it is filed as #256, so this
change stays a chore with no visible behaviour of its own. And the three
backdrop-plus-panel pairs (200/201, 400/401, 1000/1001) collapse to one value
each, because the panel is the later sibling. The intra-tile numbers stay: the
backups tile's `z-[1]` to `z-[9]`, the in-tile scrims and side panels at `z-10`
and `z-20`, the carousel's computed index and its `z-[150]` arrows all order
siblings inside one tile and never compare with the root context, and a named
layer would claim something false about them.

The four "document order is what puts these on top" comments were wrong the
moment the scale existed and now say what is still true: rendering from App is
still required, because `<aside>` goes `pointer-events-none` during a navbar
resize or a crate drag and an overlay nested in another overlay's subtree
cannot escape its stacking context; the order among those App-level surfaces
is the scale's.

**Known and accepted.**

- A value only orders things in one stacking context. A surface rendered
  inside a tile is clamped inside the maximize overlay whatever it carries,
  exactly as the old 400, 500 and 9999 were. The scale does not change where
  anything renders; the two portals still escape by being portals.
- Prettier's Tailwind plugin does not know the new classes and sorts them to
  the front of each class string, the same treatment every token class
  (`bg-canvas`, `border-hairline`) already gets. Pointing the plugin at
  `style.css` would teach it the whole theme and re-sort every file in the
  repo, which is a change of its own.
- Vitest empties every CSS import unless told otherwise, `?raw` included.
  `vite.config.ts` now lets a `?raw` read through, and only that, so the drift
  test reads the same file the build compiles; a plain CSS import in a
  component still costs nothing.
- `check-tokens` covers the namespace failure (declared and used, no rule
  emitted), which is the silent one: every overlay drops to `auto` and the
  maximized tile swallows modals again. A misspelled declaration is the drift
  test's to catch, and a misspelled class at a call site is caught only by a
  test that renders that component and asserts its layer, which five now do.
- Found designing this and filed rather than fixed: react-grid-layout v2.2.3
  defaults `useCSSTransforms` on and `Dashboard` passes no override, so every
  grid copy of a tile is a transformed element, and a transformed ancestor is
  the containing block for `position: fixed`. `PlayerDetailPopup`, the compact
  `InstalledPanel`'s preview and the command confirms raised from grid tiles
  therefore open inside the tile's box, not the viewport. The scale cannot
  change that; a portal can. Filed as #257, marked as needing a desk check.

**Verification.** `lib/layers.test.ts` (4 cases) pins the CSS to the module,
the order, the splash rule and that a bare number resolves to no layer;
confirmed to fail when one declared value drifts. `ModPreviewDialog.test.tsx`'s
`declaredZ` now resolves names through the module and throws on a literal, and
`DisconnectConfirm.test.tsx` (new) pins the pair that caused the original bug,
the confirm above the manager that raised it; each confirmed to fail with its
dialog put back on the literal it used to carry. `SettingsModal`,
`LoaderUpdateDialog` and the presets dropdown each assert their layer, the last
also that it is portaled out of its tile. `pnpm check-tokens` confirmed to name
all five layer classes as used-but-uncompiled when the declarations are moved
out of `@theme`, then green. The Clean pillar's new grep prints nothing.

Frontend suite 722 tests across 62 files, up from 713 across 60; lint holds at
14 warnings, byte-identical to the count before this change; typecheck and
`format:check` clean. Entry chunk 154.7 KB gzip against the 165 KB budget,
unchanged to the tenth of a kilobyte; `check-tokens` counts 68 token classes in
use, 5 of them layers, all compiled; `check-prefetch` green over six chunks. Go
is untouched and re-run anyway against the fresh `dist`: `go vet` and `go test`
clean, `backend/services` at 59.6% against the 49% floor.

### 2026-09-05 — The overlay the tile kept, and six smaller repairs

**Closed: [#256](../../issues/256), [#257](../../issues/257),
[#258](../../issues/258), [#259](../../issues/259), [#260](../../issues/260),
[#261](../../issues/261), [#262](../../issues/262)**, and the documentation
half of [#263](../../issues/263). Every one was already in the checklist's Open
backlog. The session's first job was to check each claim against the tree at
3beb290 before touching anything, and every claim held, with one upgrade: #257
went from inferred to measured.

**The gap, in three parts.**

*Four failures that reported nothing.* `CreateBackup` and `CreateWorldBackup`
emitted `backup:started`, then on a Stat failure after the zip closed returned
the error and emitted nothing, so the in-progress row the frontend had shown
never cleared, with no toast and no console line. `EventBus.Emit` recovered a
panicking subscriber and discarded it, so a scheduler trigger that crashed on an
event simply stopped firing with nothing in `konnekt.log`. `AcceptEula` in
`app.go` wrote `eula.txt` with a raw `os.WriteFile`, the one file left outside
`writeFileAtomic` after #116, and joined an unchecked `cfg.WorkingDir`, so an
unconfigured server wrote the flag into whatever directory Konnekt was launched
from. And two comments said things the code had stopped doing: `BackupWorld`
claimed to zip the dimension siblings it does not, and nothing said why
`maxPlayers` and `maxRAMMB` survive the stop reset that clears every other
per-run field.

*Five formatters, three behaviours.* Five copies of `fmtBytes`, four untested,
two stopping at MB so a 4 GiB archive read `4096.0 MB` on the Backups tile, the
primary surface for gigabyte-scale objects; three private relative-time helpers
under three names; two `fmtDate`s with different output because the player
popup joined a date and a time by hand and lost the locale's own separator. The
Go side narrated every backup size in MB too.

*The overlay the tile kept.* #257 was filed on 2026-09-02 as inferred from
react-grid-layout's `useCSSTransforms` default and a CSS rule, with a desk
check still owed. This session ran the check instead of waiting for a desk: the
browser demo, built from the same tree, under headless Chromium at 1440x900
with one tile framed in the grid through the recorder's own `?tile=<id>&h=9`
door. The grid item carried `transform: matrix(1, 0, 0, 1, 12, 12)`, and the
player popup's `fixed inset-0` backdrop measured 204,47 1224x456, the tile's
box to the pixel, not the window. The Stop confirm raised from the
quick-commands tile measured the same. In the screenshot the backdrop dims the
Players tile alone and the popup is centred inside it. A z-index cannot change
that: it orders things inside one stacking context and never picks the
containing block. #256 was the neighbouring finding from the same layering
work: the EULA prompt is raised by a console line a second or two after any
start click, so it can open while the server manager or Settings is up, and on
the same `z-modal` layer, rendered first, it lost that tie on document order.

**The fix.** One commit per issue on the branch, so each can be read, reverted
or cherry-picked alone.

- #258: every failure after `backup:started` goes through one `failBackup`
  helper (remove the partial archive, emit, narrate), so a further path cannot
  skip the emit; the Stat sits behind a `statBackup` seam so a test can fail
  it. While there, `backup:failed` had two payload shapes, the create paths
  with a `serverID` and the four restore paths without one, so `App.tsx`'s
  processes row and `useBackupWorlds`' refresh never reacted to a restore
  failure. One shape now, from every emit.
- #259: `ConfigEditorService.AcceptEula` resolves the working directory,
  refuses an empty one and writes through `writeFileAtomic`; `app.go` calls it
  and narrates. Deliberately not `WriteConfigFile`, which snapshots the previous
  file into `config_backups` and prunes, right for a file the user edits and
  noise for a one-line flag. The empty-directory guard lives in the shared
  `workingDir` helper, so every config-editor path now says "has no working
  directory" instead of the sandbox's misleading "path outside working
  directory".
- #261: `slog.Error` inside the recover, naming the event and the panic value;
  the contract comment on `Subscribe` says so.
- #262: the two comments say what the code does.
- #260: every caller reads `lib/format.ts`, which gained `fmtDate`, and the
  copies are deleted. `relativeMs` and `fmtDate` treat an epoch of 0 as never
  and render a dash, which is the guard the Worlds HUD kept in a private
  wrapper (a never-played world has `lastPlayed` 0 and read as twenty thousand
  days ago) and the player popup kept in its own formatter; neither wrapper
  exists now and no caller can forget it. `backup.go`'s `sizeMB` became a
  `fmtBytes` with the same tiers as the frontend, so console and tile agree.
- #257: `PlayerDetailPopup`, `ModPreviewDialog` (its dependency dialog inside
  it) and the two command dialogs render through `createPortal` to
  `document.body`, the way the scheduler's quick-add menu and the
  quick-commands presets dropdown already escaped their tile, keeping their
  layer classes so the scale still orders them. The caveat in `lib/layers.ts`
  records the rule: an overlay raised from inside a tile is a portal.
- #256: `EulaModal` carries `z-dialog`. One class, the table moved with it.
- #263: `agent_docs/CLAUDE.md` says stacked pull requests land as merge
  commits and why. The other two halves, the repository's merge-method
  setting and the `merged_pulls` test upstream in kollektiv, are not changes
  in this tree, so the issue stays open.

**Known and accepted.**

- A restore failure now clears a processes row it never opened (`finish` is a
  no-op on an unknown id) and still toasts as "Backup failed", because
  `RestoreBackup` has no event of its own. Filed as #280 rather than widened
  into #258.
- The console tile's Stop is an icon button the probe did not find by text.
  It raises the same `LifecycleConfirmDialog` from the same panel, so it is the
  same case and the same fix. `ModPreviewDialog` was not driven in the demo
  either (the installed list needs a Modrinth-matched fixture); its test
  asserts the portal, and at 600px wide it was the worst-clipped of the four.
- Re-run after the fix, the same probe measured both overlays at 0,0 1440x900
  and outside the grid item, which is the end-to-end proof the unit tests
  cannot give: jsdom computes no layout, so they assert the portal and the
  layer class and stop.
- Found while moving `EulaModal` and filed rather than fixed: 70
  `onMouseEnter` / `onMouseLeave` handlers across 29 files write
  `el.style.background` or `el.style.color` directly to get past the
  inline-style lint rule the rule cannot see (#279).
- The rest of the Open backlog was re-verified line by line against today's
  tree and the entries that had no issue now do: #281 to #287. The
  memoization evidence entry was not re-measured; `Dashboard` has since gained
  `useMemo`s the 2026-08-29 note predates, and the checklist now says so.
- Landed as nine pull requests, one per concern, each cherry-picked from the
  session's integration branch onto `main`. The only edit the split needed was
  moving the Go `fmtBytes` tier test up beside `TestValidateFilename`, because
  it and the #258 tests both appended to the end of `backup_test.go` and two
  appends at the same spot conflict whichever merges second. The order was
  verified rather than guessed: all nine merged into a scratch `main` in the
  proposed order and again in reverse, both clean, both the same tree, and
  every gate above green on that tree.
- `graphify update .` was not run: graphify is not installed in this
  container, and `graphify-out/` is gitignored, so nothing in the tree is
  behind.

**Verification.** Every gate in `.claude/suite.json`, run against a fresh
`pnpm build`: typecheck, lint (0 errors, 14 warnings, byte-identical to the
count before this session), Prettier over `frontend/` and `website/`, the
website link and scene checks, the release-notes extract and its Python tests,
the bundle budget, the token-class check, the prefetch warm list, the issue
templates, `go vet`, `go test`, the coverage floor, the generated-token diff
(all three files already current) and the border invariant. All green.

Frontend suite 729 tests across 65 files, up from 722 across 62: the new
files are `EulaModal.test.tsx`, `PlayerDetailPopup.test.tsx` and
`CommandDialogs.test.tsx`, plus cases in `format.test.ts` and
`ModPreviewDialog.test.tsx`. Entry chunk 154.5 KB gzip against the 165 KB
budget, down 0.2 KB from 154.7 with the formatter copies gone; `check-tokens`
counts 68 token classes in use, 5 of them layers, all compiled; `check-prefetch`
green over six chunks. Backend: `eventbus_test.go` is the package's first (3
cases), `backup_test.go` gains the Stat-failure table (2 cases), the
restore-payload case and the `fmtBytes` tier table, `config_editor_test.go`
gains the atomic EULA write and the empty-directory refusal;
`backend/services` at 59.9% against the 49% floor, up from 59.6%. The #257
probe before and after the fix is the acceptance test: 1224x456 in the tile,
then 1440x900 over the window.

### 2026-09-07 — The restore that failed as a backup, and four smaller repairs

**Closed: [#280](../../issues/280), [#281](../../issues/281),
[#283](../../issues/283), [#185](../../issues/185) and
[#287](../../issues/287)**, plus a two-number correction to the checklist
itself. The session's first job was to check every claim in the Open backlog
against the tree at 365821d before touching anything. Most held. The ones that
did not are the more useful record, so they come first.

**What did not hold.**

- The checklist filed the recharts first-mount entry as #286 and the motion
  easing entry as #285. GitHub has them the other way round. Fixed.
- #185's site list was stale: the `QuickCommandsPanel` sites it named moved
  into `useCommandsStore` with #184, and the console tile's send is gated on
  `reachable`, which is false without a bridge, so it never reaches the
  binding. Six sites were live, and one more the list never had: the player
  refresh after a pardon, a read with the same bare `.catch()`.
- #282 says the serial walk is in `modservice.go` and cites
  `for _, versionID := range versionIDs` as it. That loop is `Install`'s. The
  walk is `ModrinthClient.ResolveDependencies` in `modrinth.go`, behind the
  `ModProvider` interface, and the client already backs off on 429. Recorded
  under the checklist entry; the issue itself is the user's to correct.
- #284's "model type plus binding regeneration" is not the honest shape any
  more. Wails v2.12.0, the version in `go.mod`, has
  `options.App.ErrorFormatter func(error) any`, and `main.go` does not set it.
  Verified in the module source, since the proxy blocks wails.io. Recorded
  under the checklist entry, with the global-fallback caveat.
- #280 was bigger than filed. Beyond the wrong toast, two of `RestoreBackup`'s
  failure paths narrated "Restoring…" and then returned bare: a `MkdirTemp`
  failure while staging and a failure to move the current files aside, in both
  branches. The shape #258 closed for backups, still open for restores.
- #283's suggested fix, resolving the parent directory only, misses a
  symlinked *file* on the read path: `ReadConfigFile` follows it. The write
  path was already safe by accident, because `writeFileAtomic` renames a temp
  file over the destination rather than writing through it.
- #281's suggested mapping of warm-list specifiers onto hashed chunk names is
  unnecessary. `check-prefetch` asserts every lazy chunk is in the warm list,
  and the built import graph shows the entry importing no helper chunk
  statically, so "every chunk except the entry" *is* the warm list's closure.

**The fix.** One commit per issue on the branch, so each can be read,
reverted or cherry-picked alone.

- #281: `check-bundle-size.mjs` asserts a second budget, the gzip total of
  every chunk except the entry, against 800 KB. Measured 712.3 KB: WorldsScene
  259.4, EditorPanel 179.9, charts 101.3, MarkdownBody 98.4, GraphEditor 63.7,
  CommandLibrary 4.6 and 5.0 of shared helpers. Same headroom method as the
  entry budget, recorded in the header with the argument above. A build with
  no chunk besides the entry fails loudly rather than comparing zero.
- #280: `backup:restore-failed`, restore's own event, with the same
  `{serverID, error}` payload the backup event carries. Every failure after the
  opening narration goes through one `failRestore` helper, `failBackup`'s
  twin, so the six sites cannot skip the emit; the staging call sits behind a
  `mkdirTempRestore` seam so a test can fail it. `App.tsx` toasts "Restore
  failed". The scheduler's `trigger.backup` keeps its `backup:failed`
  subscription and now says why restore failures do not route to it: the
  block says "Fires when a backup completes or fails", and a restore is not a
  backup.
- #283: after the lexical test, `sandbox` resolves the working directory and
  the target with `filepath.EvalSymlinks` and compares again. The target may
  not exist yet, so its nearest existing ancestor stands in for it. When the
  working directory itself is not on disk the lexical answer stands, which is
  what keeps the existing tests against a fake `C:\servers` path meaningful.
  The lexical path is returned rather than the resolved one, so a link that
  points inside, a symlinked world folder, still works.
- #185: each of the six writes branches on `hasWailsBridge()`, the split
  `agent_docs/CLAUDE.md` prescribes, and the pardon refresh goes through
  `readOr`. Four cases in `tiles/noBridge.test.tsx` reach a binding by clicking
  rather than mounting. One mechanism worth knowing: a handler that throws is
  reported by React through window's `error` event and never escapes
  `fireEvent`, so `not.toThrow()` around a click passes vacuously. The
  quick-command case collects those events instead; the three async cases
  assert on the statement that used to be skipped (the preset selection, the
  `onMutated`, the `onClose`). All four failed on the previous code.
- #287: `pnpm test:coverage` runs the suite under `@vitest/coverage-v8` and
  prints the per-directory table. First measurement on 733 tests: 53.7% of
  lines, 80.5% of branches, 49.9% of functions, with repeat runs landing
  between 53.1% and 53.7%. The floor is 50% of lines in `vite.config.ts`, held
  the way the Go one is, and both `suite.json` and `ci.yml` run it as its own
  step so a floor failure and a test failure stay separate. The table is what
  the issue wanted: `tiles/backups` sits at 29.7% and `tiles/mods` at 36.4%,
  and those two directories hold the three files carrying most of the React
  Compiler-readiness findings, so that item's gate is now "cover those two to
  the floor first", which can be met.

**Known and accepted.**

- The config tile's restart button lives in the lazy CodeMirror panel and
  `CommandLibrary` in the lazy library chunk, so those two carry the #185
  change without a click test.
- Neither backup hook listens for `backup:restore-failed`: a restore failure
  changes neither the backup list nor an archive's contents, and the refresh
  they used to do on `backup:failed` was a side effect of sharing the event.
- Coverage moves by about half a point between runs of the same tree, from
  timing-dependent paths. The floor leaves room for it; a floor set at the
  measurement would flake.
- The coverage step runs the suite a second time in CI, about half a minute.
  Chosen over folding coverage into `pnpm test` so the two gates fail
  separately, which is the Go side's shape too.
- `.claude/suite.json` and `.github/workflows/ci.yml` were already outside the
  Prettier gate's glob and already unformatted at HEAD; the added lines follow
  each file's existing style and nothing else was touched.
- The repo root carries its own `package.json` (lefthook) and lockfile, so a
  pnpm command run from the root rather than `frontend/` lands somewhere real.
  It happened here, twice, because a parallel command had changed the shell's
  working directory; the root manifest and lockfile were reverted and its
  `node_modules` reinstalled before anything was committed. Worth knowing
  before the next session runs `pnpm add`.
- `graphify update .` was not run: graphify is not installed in this
  container, and `graphify-out/` is gitignored, so nothing in the tree is
  behind.

**Verification.** Every gate in `.claude/suite.json` through
`.claude/suite-check.py`, against a fresh `pnpm build`: typecheck, lint (0
errors, 14 warnings, unchanged), Prettier over `frontend/` and `website/`, the
website link and scene checks, the release-notes extract and its Python tests,
both bundle budgets, the token-class check, the prefetch warm list, the issue
templates, `go vet`, `go test`, both coverage floors, the generated-token diff
and the border invariant. All green.

Frontend suite 733 tests across 65 files, up from 729 across 65: the four
click cases in `noBridge.test.tsx`. Entry chunk 154.5 KB gzip against
the 165 KB budget; warmed chunks 712.3 KB against the new 800 KB
budget; `frontend/src` at 53.7% of lines against the 50% floor. Backend:
`backup_test.go` replaces the payload case with two, one pinning that a
truncated archive emits `backup:restore-failed` and not `backup:failed`, one
failing the staging seam and checking the event, the narration and the
untouched world; `config_editor_test.go` gains the symlink case on `sandbox`
and the one through both public entry points, both of which fail with the
physical check stubbed out and skip where `os.Symlink` fails.
`backend/services` at 60.1% of statements against the 49% floor.

### 2026-09-08 — The audit brief, and the gate that came out of it

**Filed: [#306](../../issues/306) to [#317](../../issues/317). Landed: the
aislop gate, 13 handled errors, a widened checklist grep, and five checklist
lines corrected.** An externally written "AI slop audit brief" prescribed a
tool per failure mode (dead code, duplication, pattern drift, test quality,
complexity, security, doc drift) and asked whether the tree reads as
AI-assisted and human-directed or as fully generated. Every tool ran in the
cloud container except two, and everything below is reproducible from the
command named; `[T]` is tool output, `[J]` is judgment.

**The brief against the repo first.** About half of it was already here, and
it was the automated half: the checklist prescribed `deadcode` and
`staticcheck` on both `GOOS`es, the coverage floors were gated, the path
traversal and zip-slip guards were tested and named. What had never run:
`knip`, `jscpd`, `gocyclo`, ESLint complexity, `gosec`, `govulncheck`, any
mutation tool. Two parts of the brief were wrong for this repo and are
recorded so nobody re-argues them: its "fresh context, read no docs" rule
produces an auditor that re-reports what this file already holds, and its
Modrinth framing does not apply, since Konnekt consumes Modrinth's API and is
not a project type Modrinth hosts. The disclosure it worried about is
`README.md:16`, which already says most of the code is Claude's.

**Tool results [T].**

| Check | Result |
| --- | --- |
| `staticcheck ./...`, linux and windows | 3: `loader.go:140` ST1005 (the product name, deliberate), `server_state_test.go:331` SA4006, the known `job` false positive |
| `deadcode`, both OSes and `-test` | 0, 0, 0 |
| `pnpm dlx knip` (no config) | 1 orphan file, 2 orphan exports, 3 dead icon re-exports, 2 dependencies never imported in any commit. #311 |
| `jscpd --min-lines 8` | 93 clones, 1.58% of lines; 20 Go and 32 TS clusters outside tests. #313 |
| `gocyclo -over 15` | 18 functions; `worldsFromServerZip`, `readPayload`, `ListConfigFiles` at 35 |
| ESLint `complexity: 15`, `max-lines-per-function: 200` | 23 and 18 functions; `App` 453 lines, `GraphEditorInner` 780. #314 |
| `gosec ./...` | 104, none high: G104 26, G304 25, G115 21, permissions 19, G204 6, G404 5, G110 1 |
| `govulncheck ./...` | **blocked**, the proxy 403s `vuln.go.dev`. Needs one local run |
| `go-mutesting` on `rcon.go` + `scheduler_validate.go` | 148 mutants, **66.2%** killed. `rcon.go`: 94% line coverage, about 64% mutation score. #312 |
| Stryker | **did not start** under `pnpm dlx`; needs the two devDependencies. #317 |
| `aislop scan` (v0.16.0) | 75/100 before this entry: 15 errors, 221 warnings |

**What the mutation run said [J].** The two best-covered files in the package
lose a third of their mutants. In `rcon.go` every `if err != nil { return }`
after auth can be deleted and the suite passes, both edges of the packet
length check (`length < 10 || length > 4096`) are untested, and no test
unwraps a `%w`. The tests pin what the functions do and mostly not how they
fail, which is the gap coverage cannot see and the reason the checklist's
Stable pillar now names a periodic mutation run.

**Security [J, sites T].** One high: `MarkdownBody.tsx:35` renders Modrinth
descriptions through `rehype-raw` with no sanitizer and no CSP, the one path
by which remote content reaches a WebView that holds the bridge (#306). Four
medium: `serverID` joined into data-dir paths unvalidated (#307), kick/ban
reasons reaching stdin with newlines intact (#308), RCON `save-off`/`save-on`
failures discarded around a backup (#309), the NeoForge installer run with no
checksum (#310). Already guarded and tested: config-editor traversal and
symlink escape, backup filenames and zip-slip, world names, mod filenames and
SHA-512, every subprocess is argv, the updater's checksum with rollback. No
secrets in the tree; `slog` never logs the RCON password or the java command
line.

**Doc drift [T].** `DEPENDENCIES.md` listed two packages as part of the worlds
scene that were never imported. The checklist's "no dead code" box was true on
2026-08-19 and false from 2026-08-30. Its "no blank `_ =` error-ignores" box
was verified by a grep that returns nothing while 40 `x, _ := f()` sites
existed, because an error in the second return position is not `_ = `. Its
`EventsOn` line said three spellings; there are five. Its store line said all
five stores comply; two do not (#315). Each line is corrected above, and the
ones that are now false are unchecked with the issue that closes them.

**Verdict [J].** Defensible as AI-assisted and human-directed, and this file
is what makes it so: it is the record of a person deciding what the code
should do and checking that it does, including two earlier occasions of
mutation-checking a test by hand. What reads as generated: symmetry written
twice (`ServerInfoPanel`/`WorldInfoPanel`, the two backup paths in
`backup.go`, three hand-rolled dropdowns, four `EventsOn` effects in
`App.tsx`), eighteen functions over 200 lines, the 138 hover-style writes that
route around the lint rule (#279), and three orphans from one refactor eleven
days after a dead-code sweep.

**The aislop tool, evaluated before adoption.** `scanaislop/aislop` v0.16.0,
MIT, run through `npx`. Read from source before running: telemetry to PostHog
is on by default with an allowlisted payload (no paths, no code, no repo
name), opt-out by config; the `scan` path makes no model call and no repo
content leaves the machine; `fix` is destructive (regex line deletion, a
`package.json` rewrite) and is never to be run here. It is mostly an
orchestrator (oxlint, biome, knip vendored; gofmt and golangci-lint if on the
path) with about twenty heuristics of its own. Its 236 findings on this tree:
195 style policy, 25 slop indicators, 2 security. 94 of the 99
`narrative-comment` hits were the `// --- Section ---` separators; all 12
`meta-comment` hits were ordinary explanatory comments; the 2 `innerhtml`
errors were guarded by `website/markdown.js`'s escaping. The 13
`swallowed-exception` errors were real by this repo's own rule ("errors always
handled"), and the 74 size and duplicate warnings were the same set `gocyclo`
and `jscpd` found. Decision, with the four options put to the maintainer:
turn the two style rules off with a written rationale, hold the size limits as
a ratchet at today's maximum (the coverage-floor pattern, lowered as #314
shrinks the holders), make it a CI gate at 100 alongside `suite.json`, and
condense the audit report into this entry rather than keep it as a file.

**What changed in the tree.**

- `.aislop/config.yml` (the policy, with every decision as a comment beside
  the setting it decides), `.aislopignore` (generated and vendored paths), an
  `aislop` job in `ci.yml` pinned to 0.16.0, an `aislop` command in
  `suite.json`. Score after: **100**, 0 findings, `aislop ci` exit 0.
- The 13 flagged error ignores, handled: `installer.go` and `loader.go` now
  return an unreadable installer jar as an error rather than "not an
  installer"; `loader.go`'s post-install check uses `detectLoaderVersion`'s
  second value (where the version was read from) in its message instead of
  discarding it; the jar-metadata, manifest and `server.properties` reads in
  `modidentify.go`, `modjar.go`, `modservice.go`, `server.go`,
  `serverlaunch.go` and `worlds.go` log at debug through `slog` and keep their
  degrade-to-default behaviour, so a corrupt jar or a missing properties file
  now leaves a line in `konnekt.log`. One site (`loader.go:151`) was a false
  positive, `resolveTarget`'s second value being the loader name, and carries
  a directive saying so.
- Small lint: the console tile's duplicate `react` import merged; three unused
  catch bindings in `website/release.js`; two useless `?? {}` spreads; a
  caret regex replaced by `startsWith`; `WorldSystem` aliased once in
  `types/index.ts` instead of twice; `flowToGraph` builds its `models.Graph`
  through the generated `createFrom` instead of three `as unknown as` casts.
- Directives with reasons on the documented exceptions: `readOr`'s fallback,
  the three `three`/`@react-three/fiber` camera casts, the two canonical URLs,
  `must()`'s panic at construction, the two guarded `innerHTML` sinks; and a
  file-level `duplicate-block` directive naming #313 on each of the 13 files
  in its table, three of them marked as deliberate tables.
- `.github/scripts/release-notes.py` formatted with `ruff format` (12 lines);
  its test still passes. `.claude/suite-check.py` is vendored and is ignored
  instead.

**Verification.** `go vet`, `go test ./...`, `pnpm typecheck`, `pnpm lint` (0
errors, the 14 pre-existing warnings), `pnpm test` (733), `pnpm format:check`,
`pnpm format:website`, the release-notes test, and `aislop ci` at 100.

### 2026-09-08 — The mod description that could reach the bridge

**Closed: [#306](../../issues/306), the p1 from the morning's audit.** A
Modrinth project body is the one piece of third-party HTML Konnekt renders,
and it rendered through `rehype-raw` with nothing after it. React neutralises
`<script>` and string `on*` handlers on its own, which is why the audit's
first grep found nothing, but `rehype-raw` hands `<iframe srcdoc>`,
`<object>`, `<meta http-equiv>` and `<style>` through untouched, and the
WebView is same-origin with `window.go`: a srcdoc frame runs as the app and
can call `parent.window.go.main.App.StopServer()`, or `DeleteBackup`, or
`RunInstaller`, from a mod listing. Two layers close it, because either alone
is a single schema away from being wrong.

**The sanitizer.** `rehype-sanitize` (6.0.0, MIT, the rehype maintainers'
own, `hast-util-sanitize` its only dependency) now runs after `rehype-raw`
with the GitHub schema plus `style` on the strip list. Chosen over a
hand-written allowlist because the GitHub schema is the shape Modrinth
bodies are already written against: `<div align>`, `<img width>`,
`<details><summary>`, tables, `language-*` code classes, `mailto:` links all
survive, and the test pins each. What it does to the hostile shapes, each
asserted: frames, objects, embeds, scripts, meta, base and forms are gone;
an `onerror` and a `style` attribute are dropped; a `javascript:` href is
dropped and its text kept; an `<input>` becomes the one shape that cannot
take input, a disabled checkbox; a `data:` image source is refused. `style`
had to be added to `strip` by hand: the default only strips `script` and
unwraps everything else, so a `<style>` block's CSS would have rendered as
prose. One consequence to know: an element outside the schema is unwrapped,
not removed, so `<center>` loses its centring and keeps its text. No other
HTML sink exists (`dangerouslySetInnerHTML`/`innerHTML`: zero hits under
`frontend/src`).

**The policy.** `frontend/index.html` carries a Content-Security-Policy
meta: `default-src 'self'`, `script-src 'self'`, `style-src 'self'
'unsafe-inline'`, `img-src 'self' https: data:`, `frame-src 'none'`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. Each value was
read off the tree rather than guessed. Wails v2.12.0 inserts
`/wails/ipc.js` and `/wails/runtime.js` as same-origin `<script src>` tags
(`pkg/assetserver/common.go`'s `insertScriptInHead`) and the origin is
`http://wails.localhost/` on Windows and the `wails://` scheme on Linux, so
`'self'` covers both; the IPC itself is `chrome.webview.postMessage` /
`webkit.messageHandlers.external.postMessage`, which no directive governs;
neither runtime file contains `eval` or `new Function`, and nor does any
built chunk. `'unsafe-inline'` on styles is react-grid-layout's positioning
plus CodeMirror's and `@xyflow`'s injected style elements. `data:` on images
is CodeMirror: its stylesheet draws gutter and search icons from SVG data
URIs (`grep data:image dist/assets/EditorPanel-*.js`), and `img-src` governs
CSS `url()` too. The worlds chunk mentions `blob:` twice and both are
three.js classifying a URL, not making one, so there is no `blob:` and no
`worker-src`. The remote hosts are `cdn.modrinth.com`, Modrinth gallery
images and `mc-heads.net`, all `https:`.

**Where the policy lives, and the one deviation from the issue.** The issue
said put the meta in `index.html`; it is there, and the built output ships it
verbatim, the demo's included (`demo/dist/index.html` carries it, and the
shim is a same-origin module script, so it loads). What the issue did not
anticipate: `@vitejs/plugin-react` injects the React refresh preamble as an
*inline* `<script type="module">` in serve mode (`transformIndexHtml` in its
`dist/index.js`, gated on `skipFastRefresh`), and Vite's HMR client speaks
over a websocket. `script-src 'self'` refuses both, so `wails dev` and the
`frontend-dev` preset would have opened on a blank page. `vite.config.ts`
now strips the meta in serve mode only, verified by starting the dev server
and reading its `index.html` back: no policy, preamble present. The cost is
recorded in the checklist: dev never runs under the policy, so a refused
resource is a `wails build` finding.

**What could not be verified here, and how it was reasoned.** The issue's
"check the Wails IPC still works with it" needs a WebView, which the cloud
container has not got. What the sources establish: the two runtime scripts
are same-origin script tags; Go-to-JS callbacks run through
`webkit_web_view_run_javascript` on Linux (`window.c:682`) and WebView2's
`ExecuteScript` on Windows (`go-webview2`'s `Chromium.Eval`), both host-side
evaluation APIs rather than script the document loads, which a `script-src`
does not govern. A web search for a documented statement that WebView2's
`ExecuteScript` is exempt from a page CSP found none either way, so this
rests on the mechanism, and the first `wails build` on Windows and Linux
should confirm a tile still starts and stops a server before this entry is
trusted. If it does not, the fallback is `script-src 'self'` plus a nonce on
the two Wails tags, which the assetserver does not currently emit.

**Verification.** `pnpm typecheck`, `pnpm lint` (0 errors, the 14
pre-existing warnings), `pnpm test` (736, the three new ones in
`MarkdownBody.test.tsx`), `pnpm format:check`, `pnpm build`, `pnpm
check-bundle` (entry 154.5 KB unchanged; warmed 714.4 of 800 KB, the
MarkdownBody chunk 98.4 → 102.8 KB gzip for the schema), `pnpm check-tokens`,
`pnpm check-prefetch`, `node demo/build.mjs`, `aislop ci` at 100. No Go
changed.

### 2026-09-08 — The kick reason that was two commands

**Closed: [#308](../../issues/308).** `KickPlayer`, `BanPlayer` and
`PardonPlayer` format a console line from a name and a reason and hand it
to `SendCommand`, which writes it to the server's stdin with `Fprintln`.
The server reads that stream one line at a time, so a reason of
`spam\nstop` was a kick and then a stop. Low impact today, since the
operator already owns the console, but a real primitive the moment anything
else reaches the bridge, which is the chain #306 opened.

The check went into `serverInstance.SendCommand` rather than the three
`app.go` wrappers, because every path to stdin comes through it: the
console tile, kick/ban/pardon, quick commands, Kommands buttons and the
scheduler's command block. A command containing `\r` or `\n` is refused
with `errMultilineCommand` before the running check and before the lock,
and nothing is written; refused rather than truncated to the first line, so
the caller learns nothing was sent instead of half of it. A trailing newline
is refused too, deliberately: `Fprintln` adds the line's end, and a caller
that appends its own is the thing this exists to catch. Verified in
`TestSendCommandRefusesALineBreak` with a capturing stdin behind the
running-server fixture: four shapes refused with nothing on stdin, then one
plain command arriving as exactly one line.

`SendCommand` itself moved out of `server.go` into `server_command.go`,
with the sentinel beside it. Not for tidiness: the aislop size ratchet sits
at `server.go`'s own length (1597 lines against a ceiling of 1600), so the
twelve lines this added tripped it, and a ratchet that is meant to be lowered
as #314 shrinks its holders should not be answered by raising it. The file is
1585 lines after the move, the first step down.

**Verification.** `gofmt`, `go vet ./...`, `go test ./...`, the Go coverage
floor (60.2% against 49%), `aislop ci` at 100 with no warning. No frontend
changed.

### 2026-09-08 — The server id that was a path

**Closed: [#307](../../issues/307).** A server id is minted in the frontend
(`crypto.randomUUID`) and accepted by `SaveServerConfig` as any string, and
four services joined it straight into data-dir paths: `backups/<id>/...`,
`mods/<id>.json`, `config_backups/<id>` and `loader-snapshots/<id>`. The
two that took the id from the caller with no config lookup in front of them
were the exposed ones: `ListBackups("../../x")` listed, and `DeleteBackup`
removed, any `*.zip` under a caller-chosen directory. Local-only, so it
needs a compromised WebView first, which is what #306 closed; the two
together were the chain.

**One helper, called where the id is persisted and at every join.**
`validServerID` in `config.go`: non-empty, not `.` or `..`, equal to its own
`filepath.Base`, no separator either way. The same shape as
`validateWorldName` and `validateFilename`, so the three read alike. Where it
runs: `SaveServerConfig`, so a bad id cannot be stored; `backupRoot`, a new
helper in `backup.go` that is now the only place the id is joined, which
`serverBackupDir`, `worldBackupDir`, `findBackupFile` and `ListBackups` all
go through, so every public backup method is covered without a call at the
top of each; `loadManifest` and `saveManifest` in `modservice.go`, the two
readers of the manifest path; `ConfigEditorService.backup`; and
`snapshotLaunchFiles` in `loader.go`, which takes `cfg.ID` from a stored
config and is guarded twice over. Not `GetServerConfig`: a lookup of a bad id
already fails on the miss, and the joins are the surface.

**Tests.** `TestValidServerID` is the table the issue asked for, plus a
space and a dot on the accepted side so nobody tightens it into a UUID
check by accident. `TestSaveServerConfigRejectsAPathAsID` asserts nothing
is persisted. `TestBackupsRefuseAPathAsServerID` plants a zip outside
`backups/` and asserts `ListBackups`, `DeleteBackup` and `CreateBackup` all
refuse `../outside`, the planted file survives and no directory is created
there. `TestManifestRefusesAPathAsServerID` does the same for the manifest.

**Verification.** `gofmt`, `go vet ./...`, `go test ./...`, the Go coverage
floor, `aislop ci` at 100. No frontend changed: the id the UI mints was
always a single segment, so nothing a user does is refused.

### 2026-09-08 — The backup that reported a flush it never made

**Closed: [#309](../../issues/309).** Three commands quiesce a world before a
file-level copy: `save-off`, `save-all flush`, then `save-on` afterwards. All
three discarded their errors behind a `//nolint:errcheck` reading "best-effort
save-flush before backup; backup proceeds either way", and
`PrepareForBackup` returned `true` whatever happened. Two silent failures came
out of that, and the first is the one that matters:

- RCON drops after auth (the 5s deadline in `rcon.go:35` is the usual way), the
  flush never runs, and the archive is a copy of a world still being written
  to — reported as a success, listed in the tile, and indistinguishable from a
  good one until somebody restores it.
- `save-on` fails after the copy and autosave stays off until the server
  restarts, with nothing in the console, the log or the UI.

The stdin fallback for the same commands already existed. It was reached only
when `s.rcon` was nil — when RCON was *unconfigured*, never when it was
configured and failing, which is the case that actually happens.

**The fix the issue asked for would have made it worse.** It said
`PrepareForBackup` should return false and the backup be refused. But `false`
already means "the server is not running, so there is nothing to pause", and
all three call sites (`backup.go`'s two paths and `worlds.go`'s
`DuplicateWorld`) *proceed* on it — `if s.server != nil && s.server.PrepareForBackup(serverID)`.
Returning false on a quiesce failure would have left the copy running
un-quiesced anyway and additionally skipped the `ResumeSaves` defer, so a
failed flush would have turned autosave off permanently. The return needed a
third state, not a different boolean.

**What it is now.** `PrepareForBackup` returns `(bool, error)`:

| Return | Meaning | Caller |
| --- | --- | --- |
| `(false, nil)` | not running, no live writes to pause | proceed |
| `(true, nil)` | saving paused | proceed, then `ResumeSaves` |
| `(false, err)` | neither channel carried the quiesce | refuse |

`saveCommand` is the new seam: it tries RCON, falls back to stdin **per
command** rather than per quiesce, and errors only when both fail, wrapping
both causes. Per command is the point — RCON dropping between `save-off` and
`save-all flush` is exactly the reported case, and a per-quiesce fallback
would have missed it.

A refusal puts saving back before it returns. `save-off` can land and the
flush after it fail, and refusing at that point without a `save-on` would be
the original bug wearing a different hat: no backup *and* autosave off.

`ResumeSaves` returns an error, and a failure there logs at `slog.Error`,
narrates a failed console line and emits `server:autosave-stuck`
(`{serverID, error}`), which `App.tsx` toasts as a warning. Its own event
rather than `backup:failed`: the archive may be perfectly good, and the thing
the user has to act on is the server. This is the failure that outlives the
operation that caused it, which is why it gets a channel of its own.

**`DuplicateWorld` refuses too**, for the reason #115 exists: an un-quiesced
copy of a live world is the torn copy that issue closed, so the quiesce is
load-bearing there and not merely nice.

**The narration got one more line.** The stdin path sleeps `quiesceWait` and
said "RCON unavailable, giving the save 1ms to flush". That is now the message
for RCON never being configured; a configured RCON that failed says "RCON did
not answer", because those are different situations and the console is where a
user finds out which one they are in.

**Tests** (`server_quiesce_test.go`, new). `fakeRconServer` serves exactly one
connection, and `Execute` opens one per command, so a second dial parked on the
5s deadline instead of failing — hence `rconServerLoop`, its multi-connection
twin, with an `rconRecorder` that hangs up after auth on nominated connection
numbers and records the commands it does serve. `runningInstance` is
`fakeRunningServer` with a readable stdin rather than `io.Discard`, since the
whole question here is which channel carried each command. Five cases: the
stdin fallback on an RCON drop, the refusal when both channels are dead, the
`save-on` after a failed flush (asserted on the RCON side, connection 3), the
stuck-autosave event and console line, and `CreateBackup` refusing with the
reserved archive removed rather than left as a zero-byte entry the tile would
list. A sixth covers `DuplicateWorld`'s refusal.

**Verification.** All 20 checks in `.claude/suite.json` via
`.claude/suite-check.py`, green. `backend/services` coverage moved 59.7% →
60.7%; frontend 736 tests, 53.7% of lines. `aislop ci` at 100. Neither method
is bound on the `App` struct, so no binding regeneration.

**Left open deliberately.** `rcon.go:35`'s `conn.SetDeadline` still discards
its error bare, which is not a `_ =` and so is invisible to both the
checklist's grep and the aislop rule — the same shape as the 27 stdlib ignores
#316 collects. The mutation survivors in `rcon.go` that this shares a root with
are #312's, not this change's; the fake that fails after auth is now in the
tree for it to reuse.

### 2026-09-11 — The vendored file the gate reformatted

**What went wrong.** The 2026-09-08 aislop entry above ran `ruff format` over
`.github/scripts/release-notes.py`, which is vendored from kollektiv and
byte-compared against its master by that repo's `sync-notes.sh`. kollektiv's
nightly reported this repo as drifted on every run from Sep 8, and nothing here
could have fixed it: the master was the unformatted one. `.aislopignore` already
excluded the vendored runner for exactly this reason; the generator was the same
case and was not listed.

**What was done.** kollektiv now formats and lint-cleans its masters under the
same aislop policy this repo runs, so a vendored file arrives clean, and holds
that policy as `.aislop/base.yml`, vendored here beside `.aislop/config.yml`,
which now only extends it and carries the size ratchet. Both vendored Python
files are in `.aislopignore`. The runner and the generator's test were
re-vendored (the generator itself was already identical, since the ruff pass
here produced what the master now is). `.github/release.yml` is vendored too
now, from a generic master, since Kommands carries the same generator; only
its comments changed. The test no longer asserts `website/` and
`CONTRIBUTING.md` unconditionally, since Kommands has neither; it asserts them
where they exist, so this repo's guarantee is unchanged. The CI job is kollektiv's
aislop workflow, vendored as `.github/workflows/aislop.yml` beside the CodeQL and
Scorecard copies rather than called by reference (a `uses:` on kollektiv's main
would put an unpinned dependency into every run), and it pins ruff: without a ruff
binary aislop's Python engines
run nothing, which is how this job passed at 100 while a local scan flagged
`version-precedence.py` twice (a shebang on a non-executable file, and a
`startswith`/slice that `removeprefix` replaces). Both fixed. `.aislop/history.jsonl`
was tracked and changed on every scan; untracked and ignored.

The bug and feature forms ask the suite's priority question between
`suite:priority` markers, rendered by kollektiv's `sync-priority.sh`, and
`.github/workflows/issue-priority.yml` applies the label on open. The feature
form's own "How much would this matter to you?" was the same question in other
words and is replaced rather than doubled; nothing on the website prefilled its
`impact` id. The question form does not ask: a question is not prioritised work.

**Verification.** `aislop ci` exit 0 at 100 with ruff 0.16.7 on PATH; one
warning remains, `backend/services/server.go` at 1651 lines against the 1455
the ratchet's 1.5x allows, left for #314 rather than raising the number.
`version-precedence_test.py` passes. `pnpm check-issue-templates`: 3 forms, 25
fields, all valid. Every kollektiv drift check (`sync-tokens`, `sync-runner
--require-vendored`, `sync-notes`, `sync-aislop`, `sync-priority`,
`validate-schemas --require-products`, `check-participation
--require-products`) reports this repo up to date.

### 2026-09-12 — The listing that could panic on a vanished file, and three smaller repairs

**Closed: [#311](../../issues/311), [#315](../../issues/315),
[#316](../../issues/316) and [#312](../../issues/312).** The session's first
job, as on 2026-09-07, was to check every open backlog issue against the tree
at 3b2509d before touching anything. Three readings did not hold, and they
come first because they changed what was built.

**What did not hold.**

- **#315's layout half is not a swallow.** `useLayoutStore.persistActiveLayout`
  records and does not rethrow, as filed, but the comment above it says why
  (react-grid-layout drives it from a drag callback that cannot await, and
  there is nothing to revert into: the layout on screen is what the user just
  arranged), `LayoutPresets` renders the recorded `error` in the sidebar, and
  `useLayoutStore.test.ts` pins the shape. That is the IPC convention's own
  "says why it deliberately does neither" clause, written into #207 nine days
  before the issue was filed. Left as it is, and the checklist line now names
  it as the sanctioned exception rather than an open defect. The `startError`
  alignment suggested for `useLoaderStore` is declined for the same reason:
  its doc comment separates a refused start (`startError`) from a failed load
  (`error`) and a failed job (`updateError`), and different UI reads each.
- **#311's icon count was stale, and knip found two more.** Three dead
  re-exports were filed; `RotateCcw` had already gone with f9965e0, so two
  remained. knip, once configured, reported two dead type exports the issue
  did not have: `RowDraft` in `tiles/quick-commands/types.ts`, and the
  `LayoutItem` re-export in `types/index.ts`, which every consumer already
  took from `react-grid-layout` directly.
- **#316's count was right and its reading was not.** The 27 stdlib sites
  were filed as "degrade to default by design". Ten of them were not. Seven
  `info, _ := e.Info()` sites, six in `config_editor.go`'s `ListConfigFiles`
  and one in `modservice.go`'s `ListInstalled`, fed `info.Name()` or
  `info.Size()` unguarded, so a file deleted between `ReadDir` and `Info` was
  a nil-pointer panic inside a bound method. The time-of-day trigger
  discarded `strconv.Atoi`'s errors, so a node whose time read `ab:cd` fired
  at midnight while `nextTimeOfDay`, which parsed the same field correctly,
  showed no next run for it. And the two `io.ReadAll` discards, in the
  Modrinth client and the HTTP block, handed a body cut off mid-transfer to
  the caller as the body, with `onComplete` in the block's case.

**The fix.** Five pull requests: one per user-visible repair, so each gets
its own release-notes line, and one chore carrying the rest, which includes
the four repairs because its gate is only green once they are in.

- **#316.** Per site, in the order the issue listed them. The seven `Info`
  discards skip the entry, the way `backup.go`'s listing already did. The
  three `serverConfig` and `ListInstalled` discards in `Categories`,
  `MoreByAuthor` and `ResolveDependencies` return the error, the same answer
  `GetVersions` beside them gives an unknown server; `loaderForServer`'s two
  do the same. The `loadManifest` discards log at warn and go on, since the
  rename or delete they follow has already happened; the directory and
  `meta.json` reads log at debug and list what they can, since a server not
  yet installed has no directory at all. `parseTimeOfDay` is one parser for
  the trigger and the next-run display, with a range check, because
  `time.Date` normalises `25:99` into an instant the trigger's hour/minute
  comparison can never match. Both readers surface the read error, the HTTP
  block routing to `onFailed` with the status still published. The args-file
  scan in `serverlaunch.go` no longer pins the search on a first match it
  could not stat. `scheduler_registry.go`'s comma-ok map lookup with the `ok`
  discarded is written without it, and `makeConfigFile`'s `filepath.Rel` over
  a `Join` of the same root carries the `//nolint:errcheck // reason` the
  repo's other deliberate discards carry.
  The gate is `suite.json`'s `no discarded errors` invariant: `, _ :?= ` with
  a lookahead that leaves out the comma-ok type assertion, a `//nolint` line
  and `resolveTarget`'s loader-name discard, over `app.go`, `main.go` and
  `backend/` with tests excluded. It passes on this tree and failed on the
  tree before it. Tests: a `parseTimeOfDay` table, `maybeFireTimeOfDay` for
  the malformed, matching and off-by-a-minute cases, a truncated body against
  each reader through an `httptest.Server` that declares more `Content-Length`
  than it sends, and the unknown-server refusal on all three mod queries
  through a provider that answers, so the refusal is the server lookup's and
  not the provider's.
- **#312.** `rcon_test.go`: both edges of the length check from both sides
  (9, 10, 4096, 4097), a server that hangs up after auth, `errors.Is` through
  the recv wraps and `errors.As` through the dial wrap, the packet types the
  fake actually saw, and a body that arrives in two writes. The send-path
  guards needed a seam: `RconService` gained an unexported `dial` field
  defaulting to `net.DialTimeout`, so a test can hand `Execute` a `net.Pipe`
  whose far end is closed, which is the one way to make a write fail on
  demand. `scheduler_validate_test.go`: every alias in `dataTypeAliases` in a
  wiring that is only refused when the alias resolves (a bool input is the
  target both string and number are refused on), a `dataTypesCompatible`
  table, and a walk over edges to missing nodes, unregistered blocks and
  undeclared ports that asserts two bad edges yield two issues.
  Score, `go-mutesting` v2.10.6 over the two files: 90.4% (169 of 187
  killed) against the 66.2% (98 of 148) the 2026-09-08 run measured on an
  older mutator set, so the rate is comparable and the counts are not. What
  still escapes, and why none of it is worth chasing, is under Verification.
- **#311.** `SchedulerSummaryCard.tsx` deleted; `PerformanceSummaryCard` and
  `WorldsSummaryCard` removed with the imports only they used, and the doc
  comment that pointed at the first; `SquareActivity` and `SlidersHorizontal`
  dropped from `lib/icons.ts`; `@react-three/postprocessing` and
  `postprocessing` removed from `package.json` and the lockfile, with a
  `Removed` entry in `DEPENDENCIES.md` and the worlds row corrected; the two
  type exports above removed. `frontend/knip.json` ignores `wailsjs/**`,
  declares `playwright` and treats an in-file export as used, so `pnpm dlx
  knip` from `frontend/` prints nothing. The entry chunk did not move: none
  of it was ever in it.
- **#315.** The seed write records into `error`, which `CommandLibrary`
  renders beside the buttons, and the comment says why it is the one write in
  the store that does not rethrow: the seed is shown either way, so a rethrow
  into `hydrate`'s catch would have emptied the tile to report a write the
  user could not act on anyway. `save`'s bridge check now reads as the guard
  the other stores spell. Two tests: a rejected seed keeps the buttons and
  records the message; no bridge records nothing and never calls the binding.

**Verification.** `go vet ./...`, `go test ./...`, `go run
./scripts/coverage-floor`; `pnpm typecheck`, `pnpm lint` (0 errors, the 14
pre-existing warnings), `pnpm test` (759), `pnpm test:coverage`, `pnpm
format:check`, `pnpm format:website`, `pnpm check-bundle` (entry 154.4 KB
gzip), `pnpm check-tokens`, `pnpm check-prefetch`, `pnpm check-issue-templates`,
the release-notes and website checks, `.claude/suite-check.py --section
invariants` (both pass), `aislop ci` at 100, and `pnpm dlx knip` printing
nothing.
**The 18 mutants that still escape**, listed so nobody chases them: the two
timing constants (`rconDialTimeout`, the five-second deadline) in seven
mutants, which only a slow test could tell apart; the seam's field cleared
to nil, which means the default by design; `readPacket`'s `readFull` guard,
which with named returns falls through to the same `err`; `Uint32` over
`data[0:5]`, which reads four bytes whatever the slice; `readFull`'s count on
either return path, which its one caller discards; the four `continue`
bodies in the validator's walk, whose zero values resolve to unresolved and
therefore allowed, which is what the skip does; and `tgt == dataTypeNumber`
in `dataTypesCompatible`, redundant after the `src == tgt` and `tgt ==
string` returns above it. `go-mutesting-*.json`, which the tool writes into
the working directory on every run, is gitignored the way
`.aislop/history.jsonl` is.

**What is left of #312.** The issue's second half, the same run over
`config_editor.go`, `backup.go`, `update.go` and `modservice.go`, ran after
this entry was first committed: 2,398 mutants, 1,791 killed, 74.7%. Per
file: `update.go` 478 mutants and `modservice.go` 818, none escaped;
`config_editor.go` 297, 36 escaped (88% killed); `backup.go` 809, **571
escaped, 29% killed**, 457 of them past line 400 in the restore, per-world
and meta.json paths. That file's line coverage says nothing of the kind, and
it is the file whose failure modes this log has recorded twice. Filed as
#348, with a note that the two perfect scores want a second look first: a
mutant whose test run hangs counts as killed, so a file that times out on
every mutation would score 100% for the wrong reason.
`govulncheck ./...` still needs one local run; the container's proxy blocks
`vuln.go.dev`.

### 2026-09-13 — The backup tests that pinned nothing, and the perfect scores that were a leftover file

**Closed: [#348](../../issues/348).** The 2026-09-12 run had `backup.go` at
29% killed, 571 of 809 mutants, next to 100% for `modservice.go` and
`update.go` in the same package. The escape map, read function by function
rather than as a number, said where the tests were missing rather than weak:
`GetBackupWorlds` and the two archive readers behind it had no test at all,
nor did the legacy layout (archives from before the server/worlds split,
directly under the backup root, with the kind read off the filename), the
world-only restore, either rollback, the sidecar's failure modes, the
progress events, or the quiesce around a backup. What the round trip
covered was the happy path through the server directory, and everything
else could be deleted with the suite green.

**The tests.** Two files beside `backup_test.go`, split by subject rather
than added to it, each case written from the question "what would a user
see if this line were wrong". `backup_worlds_test.go`: a server archive
with an active world carrying vanilla DIM folders, an inactive world laid
out the Bukkit way whose DIM-1 must not become a second nether, a
`level.dat` below the top level that is not a world, and server files that
count towards nothing, asserting dimensions, paths, sizes, the active flag
and the `level.dat` metadata; a world archive with two nether files and one
nether dimension; the refusals; a `parsePropertiesReader` and an
`isServerFilename` table, the latter at every boundary of "five digits and
an underscore"; the legacy root listed with its sidecar, resolved by
`findBackupFile` with the right kind, and ordered newest first across
directories by the file's own mtime; `session.lock` left out of an archive
and an empty directory kept in one. `backup_restore_test.go`: a named world
restore that replaces that world and nothing else and leaves no set-aside or
staging directory behind; a restore into a world that was deleted; a legacy
world archive restored into `level-name`, or `world` when that is unset;
a legacy server archive replacing the working directory; the swap failing
after the current files were moved aside, for both kinds, with the current
files put back (the staging directory is placed on `/dev/shm`, which is a
separate mount from the temp directory on Linux, so the final rename fails
with a cross-device error on demand; the test skips where the two share a
filesystem); the set-aside failing because the world's name is at the
filesystem's 255-byte limit and leaves no room for the `.bak-` suffix (the
first version made the target's parent a file, which is `ENOTDIR` on Linux
but `ERROR_PATH_NOT_FOUND` on Windows, and that one is `os.IsNotExist`
there, so CI's Windows job saw the set-aside skipped and the swap fail);
`DeleteBackup` dropping the sidecar entry; `UpdateBackupMeta` over a
sidecar that will not parse (rewritten) and one that cannot be read at all
(refused, while the listing degrades to untagged rather than hiding the
archive); the three backup events with their server and filename, and the
progress percentages exactly once each; a backup that pauses and resumes a
running server's saves; one that fails, with the reason wrapped, when the
saves cannot be paused; a `BackupService` with no `ServerService`; and the
refusals before `backup:started` when the backup directory cannot be made.

**Score.** `go-mutesting` v2.10.6 over `backup.go`: 589 of 809 killed,
72.8%, from 238. Run in three `--match` chunks (165 of 230, 200 of 259, 224
of 320) with `go clean -cache` between them, because the build cache grows
about 35 MB per mutant and the whole file filled the container's disk in
one go: the first attempt ended with 278 mutants errored on "no space left
on device", a number to distrust rather than record. By mutator,
`conditional/negated` is 118 of 126 and `composite/field-clear` 60 of 63,
while `expression/error-guard` is 24 of 61 and `branch/if` 88 of 139, and
that is what the 220 left are: error guards on calls that cannot be made to
fail as root (`MkdirAll`, `Stat`, `ReadFile`, `Create` on paths the test
owns), the `>` against `>=` boundaries no fixture sits exactly on, clears
that turn an empty slice into a nil one, `statement/return` on paths already
behind a guard the tests do trigger, and the error paths inside the zip
walks. A few are equivalents (the sort comparison, the prefix attribution in
`findBackupFile`). Not chased further: what remains wants a filesystem that
fails on cue, and the fake for that is worth more than the last points.

**The restore's error does not say which step failed.** `failRestore`
narrates "Restore failed while swapping files, previous state kept" and
emits `backup:restore-failed`, but returns the raw rename error, so the
toast reads "invalid cross-device link" with no step. That is how #280
shaped it (the console line carries the step, the event carries the error
and the server) and it is left as it is; the tests assert the step on the
console and the error on the event, which is where each lives.

**The perfect scores were one leftover file.** The note on the 12th guessed
at timeouts. It was not that: three timeouts across the two files today, one
in `update.go` and two in `modservice.go`, each counted as a kill because
the tool maps `go test`'s exit 1 to killed whatever produced it, which stays
worth knowing but is nowhere near 1,296 mutants. The run's own output is the
evidence. It took the four files as `backup.go`, `config_editor.go`,
`modservice.go`, `update.go`, and every escape it printed is in the first
two. `AcceptEula` writes `eula.txt` under the server's working directory,
and `TestConfigEditorRefusesAnEmptyWorkingDir` asserts both that a server
with no working directory is refused and that no `eula.txt` lands in the
process's working directory, which under `go test` is `backend/services/`.
The mutant that drops that guard writes the file there and is killed,
correctly. The file outlives it: the tool restores the source between
mutants and nothing else. From then on the test failed on every run, so
every mutant after it, the rest of `config_editor.go` and all of the other
two files, was scored as killed by a test that never looked at it.
Reproduced today in both directions: an `eula.txt` in the package directory
and nothing else fails the suite on exactly that test, and the directories
`backup.go`'s own mutants leave behind (`backups/`, `server/`, `worlds/`)
fail nothing, which is why its 571 escapes were real. Measured one file per
invocation with the directory cleaned between: `update.go` 56.9% (271 of
476 killed) and `modservice.go` 28.2% (229 of 811), filed as #349 and #350;
`config_editor.go`'s 36 escapes on the 12th were cut short by the same
file, and measured alone it is 28.3% (84 of 297), filed as #352; the two
containment tests in `sandbox` are among the kills, and its four escapes are
the propagation of an `EvalSymlinks` failure that cannot be provoked as
root. The test now runs in a directory of its own
(`t.Chdir(t.TempDir())`), so a leftover cannot fail it and the guard mutant
is still caught, checked by hand with the guard removed. And a rule for
reading the tool, now in the Stable pillar: a mutant's side effects on the
working directory persist for the rest of the run, so mutate one file per
invocation, look at what is left in the package directory before believing
the number, and treat a 100% file as a question rather than a result.

**Verification.** `gofmt -l`, `go vet ./...`, `go test ./...`, `go run
./scripts/coverage-floor`, `aislop ci` at 100, and the mutation runs above.

### 2026-09-16 — The two thirds of a world the backup never took

**#26, `type:bug`, `p1`.** On Paper, Spigot and Bukkit a world is three
folders: `world`, `world_nether`, `world_the_end`. `BackupWorld` passed the
base name straight through to `CreateWorldBackup`, which zipped
`WorkingDir/<name>` and nothing else, so on those servers a world backup held
the overworld alone. Restoring one put the overworld back beside whatever
nether happened to be on disk. Vanilla was never affected: it keeps `DIM-1`
and `DIM1` inside the overworld folder, so they came along for free, which is
most likely why this survived as long as it did.

**It was silent in the worst possible place.** `ListWorlds` groups the
siblings into one `WorldSystem` (`worlds.go:39`) and the Worlds tile draws
them as moons orbiting the planet (`scene/Planet.tsx:247`). The user saw
three dimensions and pressed Backup on the planet holding them. Nothing in
the archive, the tile or the console said that two of the three had been
skipped.

**`worldSiblings` already existed.** `DeleteWorld`, `RenameWorld` and
`DuplicateWorld` have walked the sibling set since the Worlds tile shipped
(`worlds.go:328`). `BackupWorld` was the one sibling-aware operation that
never adopted it, and its own doc comment said so: "Only that folder ...
not included in the archive yet (#26)". The 2026-08-21 sweep had flagged
that comment as overstating today's behavior; it was understating it, in
the sense that the comment was the only place the gap was written down.

**A world archive is now multi-root.** `CreateWorldBackup` zips every
existing sibling under its own folder name, so the archive holds `world/`
and `world_nether/` side by side where it used to hold the overworld
folder's *contents* at the zip root. `zipDirWithProgress` and the new
`zipRootsWithProgress` share one tree writer, and progress is a single
0-100 across every root rather than one sweep per root: the caller emits
it straight to the UI, and a bar that restarts twice reads as three
backups rather than one.

**Archives written before this still restore, and that is the part worth
getting right.** The layout is read off the *extracted* tree, not the zip:
a `level.dat` at the root can only be the old layout and settles the case
even for an old-layout world that contains a subfolder named after itself;
with no root `level.dat`, a folder named after the world is the new layout;
anything else reads as the old layout, so an archive the check does not
recognise restores exactly the way it did before. The first version read
this by opening the zip a second time *before* extracting, which passed its
own tests and quietly reclassified a corrupt archive from "Restore failed
while extracting" to "while reading the archive".
`TestRestoreWorldBackupReportsStagingAndExtractFailures` caught it, which is
the second time that test has earned its keep.

**Two renames are not one atomic step**, so the guarantee is the weaker one
that still leaves a bootable server: every dimension is the restored one, or
every dimension is the one that was there before. `swapWorldDirs` puts back
what it had already swapped before reporting a failure, so a Paper world
never ends up with a restored overworld beside a nether it was not restored
with. `renameIntoPlace` is the seam that test drives, the same shape as
`mkdirTempRestore` and for the same reason: the rollback matters most in the
case that is hardest to produce for real.

**A dimension the archive does not hold is left alone, deliberately.** The
other reading, "make the world exactly what the archive says", deletes the
nether beside an overworld-only archive written before this change. That is
data the restore was never asked to touch, and unlike a stale dimension it
is not recoverable once the aside copy is cleaned up. Leaving it is the
recoverable failure of the two, and the restore now narrates which
dimensions it replaced so the choice is visible rather than silent.

**Verification.** Nine tests in `backup_dimensions_test.go`, each confirmed
to fail against the unfixed tree rather than assumed to: reverting the write
side alone fails five, and disabling the multi-root restore detection alone
fails five (three of them pre-existing). `gofmt -l`, `go vet ./...`, `go test
./...`, `go run ./scripts/coverage-floor` (67.7% against a 49.0% floor) and
the full `.claude/suite-check.py` table, which was green at 22 of 22 before
the change and after it.

### 2026-09-16 — The schedules that followed the sidebar

**#236, `type:bug`, `p1`.** A scheduler graph belonged to no server. Every run
resolved its target from `active_server.json` at fire time, so clicking a
different server in the sidebar silently re-pointed every schedule the user had
written, and an event from one server fired every other server's graphs. A
backup graph authored while A was selected backed up B the moment B was
clicked.

**Half the issue had already been fixed by other work, and it was the half the
`p1` rested on.** The filed text argued this was urgent because `execBackup`
used `e.ServerID` while `execCommand`'s default branch and `execRcon` went
through the singleton `ServerService`, so one graph could back up B and RCON to
A. #232 and #239 closed that: `ServerService` holds an `instances` map with
`instanceFor(serverID)` and every block routes through `e.ServerID`. The issue
was corrected before the work started rather than left standing, because a
justification that no longer holds is worse than no justification. What kept it
at `p1` is the ambient re-pointing and the unfiltered trigger fan-out, both
reachable in Alpha: Alpha supports multiple saved server configs, and switching
the sidebar rewrites `active_server.json`.

**The dependency had landed the day before.** #233 put a `serverID` on all nine
server-scoped events (PR #355, 2026-09-15) and #234 keyed the tile tree by
server the same day. The filter this needed was mechanically available and
simply not applied.

**`AttrScope` turned out to be the seam.** The five sites that seeded a run
(`scheduler_engine.go:111,252,344` and `scheduler_preview.go:32,220`) each read
`activeServerID()` independently. The scope was already threaded through every
one of them and already carried a `serverID`, so each `ExecContext` now reads
its server back off the scope instead of resolving one of its own. A block's
target and an `@attribute`'s target are the same server by construction; before,
they were two reads that agreed only because nothing had changed between them,
and a condition reading one server while its action hits another guards the
wrong thing. Reverting only the `ExecContext` half makes the test say so
directly: block server b, attribute server a.

**The plan said `activeServerID` would be deleted, and it was not.** Its absence
was going to be the proof the ambient read was gone. The migration needs it, and
so does the fallback for a graph the migration could not assign, so it survives
with exactly two callers and a comment saying a third would be the ambient read
coming back. The deletion was a nice proof and not a design constraint; keeping
the fallback was worth more.

**The migration runs once against real user data, so it went in on its own,
tests first.** An unassigned graph is given the active server, but only once
that id resolves against a real config: `active_server.json` is a bare string
written with no referential check and can name a server that has since been
deleted. A single configured server wins whatever that file says, because it is
the only server those graphs can ever have run against. Where neither applies
the graph is left unassigned and keeps running against the active server the way
it always has. A graph is never assigned to a server the user does not have,
which would be a schedule that silently stops and never says so.

**The existing #233 tests caught a regression in the trigger filter that the
plan had not anticipated.** The first version filtered strictly on the event's
server id, and the three lifecycle tests #233 shipped went red: they drive
graphs with no owner through a scheduler with no config service, and every one
of them was silenced. In production the same shape is a user with several
servers and no valid `active_server.json`, whose schedules would simply have
gone quiet. The filter now applies only when both sides are known. An event with
no id fires everything and logs an error, because an emit site added without one
is a mistake worth seeing rather than absorbing, and strict filtering there is
the exact failure `WINGS_ADOPTION.md`'s constraint 2 calls the most maddening.
Over-firing is the recoverable fault of the two.

**The minute ticker is deliberately not filtered** and now says so: a nightly
backup on a server nobody has selected is still due at that time, and each graph
runs against its own server.

**The frontend's hydration latch was a boolean.** #234 keys tiles
`${tile.id}:${serverId}`, so the scheduler tile remounts on a switch and calls
`hydrate()` again, which short-circuited: the previous server's graphs stayed on
screen under the new server's name. It is `hydratedFor` now. It deliberately
does not bail on a fetch in flight for a *different* server, or a server
switched to mid-fetch would never load, since the tile only hydrates on mount.
Two fetches can therefore overlap, so a response is applied only if it is still
the server being asked about, and a switch clears the graphs rather than showing
the old ones for the length of the fetch.

**Run history is scoped through the graph rather than by a field.** A `ServerID`
on `RunRecord` would need a second migration for the 200 records already on
disk, which could only recover their server through the same join. A record
whose graph was deleted drops out, losing a row that could not be opened anyway.

**`models.ConfigField`'s `"server"` type went rather than got built.** Nothing
used it: no `ConfigField`, no block, no editor control. A per-node server
override would put back the ambiguity this closes.

**Verification.** Five commits, each green on its own. Twenty-four Go tests
across `scheduler_migrate_test.go` and `scheduler_scoping_test.go`, each
confirmed to fail against a mutated implementation rather than assumed to:
reverting the ambient read, reverting only the `ExecContext` half, removing the
trigger filter, making it strict, extending it to the time ticker, trusting an
unresolved active id, dropping the single-config fallback, always reporting the
migration as changed, and removing the migration call. Five new frontend cases
pin the server dimension of the store, including the overlapping-fetch order.
`.claude/suite-check.py` green at 22 of 22 before and after. Bindings
regenerated with the CLI version `go.mod` pins, changing exactly the seven
signatures and the new field.

### 2026-09-18 — The type scale sweep reaches the whole tree

**Closed:** the checklist's `P3 — The type scale sweep stops at the scheduler`
(filed 2026-09-17), as #368.

#163 moved the scheduler editor's twenty-seven inlined `text-[Npx]` sizes onto
the generated scale and left an invariant holding that one directory. This
sweep did the rest of `frontend/src`: 62 `text-[10px]` to `text-2xs`, 19
`text-[11px]` to `text-1xs`, 4 `text-[9px]` to `text-3xs`, and the one
`text-[13px]` (the mods tile's quick-install `+`, in a 22px box) to `text-sm`,
across seventeen files. The counts differ from #368's, which had 66 and 13 and
no 11px at all; #163 had landed between the filing and the sweep, and the 11px
ones had simply been missed. Every value except the 13px maps exactly onto a
token, so nothing renders at a different size.

**Twenty-seven sites carry two font sizes, and did before.** `text-xs
text-[10px]` was the pattern, mostly in the mods tile's dialogs, and it is
`text-xs text-2xs` now. Both render 10px: in the built CSS `.text-2xs` sits
after `.text-xs` exactly as `.text-\[10px\]` did, so the later rule wins in
both spellings. The `text-xs` is not dead, though. Tailwind's `text-xs` also
sets `line-height` from its own theme and the token-derived `text-2xs` sets
font-size only, so dropping the `text-xs` would change those rows' line-height.
Left as they were: a line-height decision is a design change, and this sweep
was a rename.

**One literal stays, by name.** `worlds/scene/Planet.tsx`'s focused-planet
label is `text-[7px]`. It is not a type size: drei's `Html` scales it by camera
distance (`distanceFactor`), and the focused planet sits close enough that the
scale's 9px floor would land larger on screen than the unfocused labels beside
it. The literal is the input to that transform, and a token for it would name a
screen size the label never has. The file says so beside the class, and the
invariant excludes that one file rather than the whole scene directory.

**The invariant is now `text uses the type scale` over all of `frontend/src`**,
renamed from `scheduler uses the type scale` and widened from
`frontend/src/tiles/scheduler`, which the checklist had said could not happen
without turning red on arrival. It is green on arrival. `no literal border
widths`' diagnosis used to name text as a sweep still open and now points here.

**Verified:** `.claude/suite-check.py --section invariants` green with the
widened path; `pnpm check-tokens` after a fresh build, so all four classes
compile; `pnpm typecheck`, `lint`, `test` and `format:check` green.

### 2026-09-18 — Per-server scoping gets its gates

**#237, `type:chore`, `p2`.** #232, #233, #234 and #236 made the dashboard
answer for one server at a time, and nothing kept it that way: each of those
defects arrived through a change that looked locally reasonable. Four checks
were asked for. The switch test (`tiles/serverSwitch.test.tsx`) had already
landed with #234; this closes the other three and writes the convention where
the next session reads it.

**Both Go checks read the source rather than the type graph.** The event
check has to see the second argument of every `Emit`, wherever that literal
was built, and the method check has to see parameter *names*, which
reflection does not carry. So `scoping_test.go` parses `app.go`,
`backend/services` and `backend/models` with `go/parser`, the same reasoning
`bindings_test.go` gives for living in Go rather than as a diff over generated
output: a new emit or a new bound method with the wrong shape fails on the
commit that adds it. Every `Event*` constant is classified, a payload
variable is followed to the composite literal assigned to it in the same
function, and a call whose event or payload is a parameter (`ExecContext.Emit`)
is listed by name with the reason. The bound-method rule accepts a parameter
named `serverID` or a `models` struct with a `ServerID` field, which is how
`UpdateLoader` and `PreviewScheduleNode` pass; thirty-seven methods are listed
as genuinely serverless, each with why, and an entry whose method later gains
an id fails the test so the list cannot rot. `GetLastStop` is on it with its
own comment's reason: unused by the frontend, and bindings cannot be
regenerated here, so it stays the getter it is until a caller needs the id.

**The Go gate found the four scheduler run events.** `schedule:run-started`,
`node-started`, `node-finished` and `run-finished` carried a `graphId` and no
`serverID`. A graph belongs to one server since #236, so the id was one field
away; it is on all four now. The editor still filters on `graphId`, which is
tighter, and is listed as such.

**The frontend gate is a source scan, not a `suite.json` invariant.** The
issue asked for the invariant shape, and it does not fit: "this handler reads
the payload's server id" spans lines, and the predicate may sit beside the
registration rather than in it (`usePlayers`'s `mine`), while an invariant is
one regex that must find nothing. `lib/serverScoping.test.ts` blanks strings
and comments, walks every `EventsOn` under `src/`, and requires a
server-scoped handler to read `serverID` or go through `isForActiveServer`,
looking one level out to the enclosing function body only when the handler is
passed by name. It mirrors the Go classification by hand; the two lists are
short and the rule for a new event is written in both files.

**It found two real gaps on the day it ran.** `useWorlds` rescanned on every
server's stop and every server's backup; it filters now, the way `usePlayers`
has since #233, with a switch test that fails with the filter reverted. And
the EULA prompt was a boolean: `server:eula-required` from any server showed
the modal, which then accepted and started the *selected* server. Since #236
a schedule can start a server that is not selected, so `App` now keeps the
id off the payload and the modal accepts for that one. An empty id falls back
to the selection, because `models/server.go` says the empty id is real and
the selected server is the only one that can have been started without one.
Eighteen registrations are listed as global on purpose, all in `App.tsx` and
the graph editor: app-wide notifications, two loader handlers keyed through
the started handler, and the four graph-scoped ones.

**Verified.** `go test ./...` and the frontend suite green. Each gate confirmed
to fail before its fix: the Go test on the four scheduler emits (and, as a
second check, on a `serverID` key deleted from `backup.go`), the frontend test
on `useWorlds` and the EULA handler, and the new switch case on the `useWorlds`
filter reverted. `.claude/suite-check.py` green, memory budget included.

### 2026-09-18 — The superseded jar survives a failed install

**#167, `type:chore`, `p3`.** `removeSuperseded` deleted the copy an install
replaces before two steps that could still fail, the `.disabled` rename and
the manifest write, so a failure at either left the new jar in place with a
manifest that still described the old one, and the old one gone. A working
server with a wrong manifest row, not an unbootable one, which is why it sat
at `p3`; the issue's own 2026-09-16 rewrite records that the two-jars case it
was filed for had already closed under #52.

**Moved aside rather than deleted.** The superseded file is renamed in place
to `<name>.superseded`, a suffix chosen because nothing reads it: Konnekt's
`ListInstalled` and `Rescan` take only `.jar` and `.jar.disabled`, and so does
every loader. `Install` puts the copies back and removes the new file if the
rename or the manifest write fails, and deletes them once the version is
recorded. No manifest write is needed to roll back, because the manifest on
disk still describes the old copy until `saveManifest` succeeds, which is the
property that makes "one jar, and a manifest that agrees" hold at both
failure points. A crash between the move and the discard leaves an aside copy
behind, invisible for the same reason it is safe; that is the one cost, and
it is written where the suffix is.

**The failure tests needed a seam.** Both failure points sit after the
manifest loads and inside one call, and the container runs as root, so a
permissions trick fails nothing. `ModService.installHooks` carries two
`func()` fields, nil outside tests, called just before each step; each test
uses its hook to make the *real* call after it fail, by occupying the
rename's target and the manifest's path with a directory. The production
code gains two nil checks and no fake.

**A smaller leak closed on the way.** `saveManifest` left its temp file
beside the manifest when the rename into place failed; it is removed now,
and the manifest-write test asserts the directory holds the manifest alone.

**Verified.** Three mutations, each caught: `undo` no longer restoring (both
restore tests fail), the aside copies never discarded (the replace test's new
folder assertion fails), and the old delete-in-place behaviour restored (both
restore tests fail). `go vet`, `go test ./...` and the services coverage
floor green.


### 2026-09-19 — The zip bomb the standard library had already stopped

**Checklist, Stable pillar, the security-lint line.** It had carried three
named findings since 2026-09-08: G110, an uncapped `io.Copy` on restore; seven
G115 conversions in `rcon.go`; and `govulncheck`, never run. The line is still
unchecked, because the last of those is still true. The other two are closed,
and neither was what the line said it was.

**G110 was a false positive, and the fix for it was a test that proved
nothing.** The first attempt bounded `unzipTo`'s copy with
`io.CopyN(out, rc, declared+1)` and rejected an entry that produced more bytes
than its header promised, with a test that forged a zip's central directory to
claim one byte in front of a 64 KiB stream. The test passed. It also passed
with the guard deleted, which is the only reason any of this was noticed:
`archive/zip`'s `checksumReader` already refuses to yield a byte past
`UncompressedSize64` and returns `zip.ErrFormat`. Measured on Go 1.26 against
that same forged archive, a plain `io.Copy` copied **0** bytes and failed. The
classic decompression bomb cannot be built through `zip.Reader` at all, and
gosec flags the line because it sees a copy out of a compressed stream and
cannot see the reader's contract.

So the `CopyN` came back out. Duplicating a guarantee the standard library
already makes reads, to the next person, like a guarantee the standard library
does *not* make. What is there instead is the annotation, the reason, and
`TestUnzipToStopsAtTheDeclaredSize`, which pins **both** halves: that
`archive/zip` still refuses, and that `unzipTo` surfaces the refusal as a
failed restore. The code is safe only for as long as the first half holds, and
a Go release that relaxed it would otherwise land here silently.

**What gosec could not see was the real gap.** Nothing bounded the
*declaration*. An archive honestly claiming a petabyte, or four million
entries, was extracted until the disk said no. `zipDeclaredTotal` now runs
before anything is written and refuses on entry count, per-entry size and
declared total. Restore only opens files `findBackupFile` locates under the
backups directory, so this is defense-in-depth for an archive that arrived
from somewhere else, which sharing a world backup makes an ordinary thing.

**Three G115 rows in `backup.go` were the same neighbourhood.**
`int64(f.UncompressedSize64)` summed a header field into the size the worlds
tile displays, so a forged size above 2^63 wrapped it negative. `zipEntrySize`
clamps it, and the table test covers `uint64` max, the ceiling, and one past
it.

**The seven G115 rows in `rcon.go` were five, and four were the wire
format.** Source RCON carries id and type as four little-endian bytes and
signals a failed auth as id -1, arriving as `0xFFFFFFFF`, so the round trip
through `uint32` is the protocol rather than a narrowing; those are annotated.
The fifth was real and unreachable: `writePacket` computed an `int32` length
from a body of any width, so a body near 2 GiB would have wrapped it negative
and panicked the `make` below it. `maxRconBody` bounds it, tested from both
sides of the boundary, which is the shape #312's mutation work asked for.

**The count in the line was not reproducible, and that is the part worth
keeping.** It read "104 findings, none high" with no version beside it. gosec
v2.29.0 reports 98 on today's tree with 20 HIGH, and carries rules (G122) the
earlier run may not have had, so there is no way to tell a regression from a
tool upgrade. The command in the checklist now pins the module version. It has
to be the module version: `gosec --version` prints `dev` for anything built by
`go install`, because the tag arrives through ldflags when a release is cut,
so the binary cannot be asked what it is.

**Triage now lives at the finding.** `#nosec <rule> -- <reason>` on the line,
the way the aislop gate already works, so a row triaged once is not triaged
again from scratch. Two rows were deliberately left un-annotated: `nbt.go`'s
`intGet` and `byteGet` narrow an NBT `int64` when reading a `level.dat` the
user may have downloaded, and an annotation should follow a test rather than
substitute for one (#395).

**Verified.** 107 findings before, 98 after, with G110 gone and G115 down from
22 to 14, the remainder being `scripts/gen-icons` build tooling and the four
rows above. Each new guard was mutation-checked by hand: deleting the zip-slip
check fails its test, widening `maxZipTotalSize` fails the ceiling test (the
subtest asserts the two ceilings stay within a testable distance of each other,
so the mutant fails on an assertion rather than an out-of-memory kill), and the
declared-size test fails if `archive/zip` ever stops enforcing it. `gofmt`,
`go vet ./...`, `go test ./...` and both coverage floors green.

### 2026-09-21 — The scroll that felt like dragging was the physics, not the pixels

**The report.** "Konnekt scrolling feels somewhat sluggish. Compared to a web
browser it is almost like it is dragging. Not visibly stuttering, but even on
a lower refresh rate screen a browser feels smoother." The browser was Zen, a
Firefox build; the machine was Windows 11, so the app was in WebView2.

**Ruling things out before ruling something in.** The frontend was cleared
first: no `scroll-behavior`, no non-passive wheel listener on the canvas (the
two that exist are scoped to the backups carousel and the worlds scene, which
claim the wheel on purpose), the prefetch listener is passive, and
react-grid-layout positions tiles with transforms. The Linux GPU policy in
`main.go` is a real software-rendering cliff, but it is inside the `Linux:`
block and this was Windows. What settled it was the browser demo: rebuilt
(`node demo/build.mjs`, which needed #418 to run on Windows at all) and
served to Edge and to Zen side by side, the same dashboard felt exactly
like the app in Edge and "absolutely wonderful" in Zen. Edge is the same
Chromium as WebView2, so the app's code was not the variable; the engine's
wheel animation was.

**What the difference actually is.** Chromium animates each mouse-wheel notch
with a fixed ease over a fixed duration: a run of notches is a run of
identical little glides that each start from rest. Gecko's
`ScrollAnimationMSDPhysics` models the scroll position as a unit mass on a
critically damped spring whose resting point is the destination. A notch
moves the resting point; the mass keeps its velocity; and the stiffness
follows the rhythm of the notches (1250 for the first notch of a gesture,
1000 through a steady run, 2000 once the gaps between notches grow past 1.3x
the previous one so the settle happens before the hand leaves the wheel).
Stock Firefox ships it off (`general.smoothScroll.msdPhysics.enabled` is
`@IS_NIGHTLY_BUILD@` in `StaticPrefList.yaml`); Zen turns it on. That one
preference is the whole gap the report described.

**The fix: port it rather than approximate it.** `lib/springPhysics.ts` is
the model with Gecko's constants and its `ComputeSpringConstant` schedule
verbatim, and `ClampVelocityToMaximum` from bug 1866904 so a carried velocity
can never overshoot. Where Gecko integrates numerically, the critically
damped case has a closed form, `dest + (A + Bt)e^(-wt)`, so the port is exact
at any frame rate and needs no timestep. `lib/springScroll.ts` is one
non-passive `wheel` listener on the document: for a stepped-wheel notch it
finds the scroller the notch would have moved (nearest vertical scroller with
room that way, an in-flight destination standing in for the position so a run
that reaches the bottom of the console chains into the canvas), takes the
event over, and drives `scrollTop` from `requestAnimationFrame`. Everything
else stays native: precision touchpads (`classifyWheel` reads Chromium's
legacy 120-per-notch `wheelDeltaY`, which the OS lines-per-notch setting does
not scale), events another handler already claimed, Ctrl or Shift held, a
horizontal delta, the OS reduced-motion preference, and a frame that finds
the element moved by something else (a scrollbar drag, the console following
its tail) stops rather than fights. `AppSettings.SmoothScrolling` is the
toggle, on by default, under Settings > Appearance, read per notch so it
applies without a restart; the Go default test pins that an older settings
file comes up with it on, since a `bool` defaulting to `true` is exactly the
case unmarshalling onto a zero struct would get wrong silently.

**Found on the way, filed on their own.** The demo build could not run on
Windows at all (#418), and the Linux `WebviewGpuPolicyNever` line is a real
software-rendering cliff that this physics can only draw slowly on; that one
is the next entry.

**Verification.** 28 new tests: the spring starts and settles where it is
told, never overshoots or reverses from rest, its velocity is the derivative
of its position, and the stiffness schedule's four branches and the velocity
clamp each have a case; a run of notches keeps its velocity across the
retarget and never passes the latest destination. The DOM half: a notch is
taken over and glides to its destination, a run accumulates and clamps at the
end, a precision delta, Ctrl, Shift, a horizontal delta, the toggle and an
already-claimed event are all left alone, an inner scroller bound for its end
chains outward, an outside move stops the animation, and uninstall leaves the
element where it was. 867 frontend tests pass; `tsc -b`, ESLint and Prettier
clean; the entry chunk stays under the 165 KB budget; `gofmt`, `go vet` and
the settings tests green. Measured by hand against Zen on the machine that
filed the report is the one check this session cannot run.

### 2026-09-21 — Linux gets the GPU back

**The ask.** With the wheel physics in, make Linux scroll smoothly out of the
box too, RHEL-based systems especially.

**What was in the way.** `main.go` set `WebviewGpuPolicy: linux.WebviewGpuPolicyNever`,
restating the default Wails applies when Linux options are nil, its workaround
for wailsapp/wails#2977. Never means no accelerated compositing at all: no
compositor thread, no asynchronous scrolling, and every scrolled frame a CPU
repaint. The mouse-wheel spring physics (its own pull request, "Scroll the mouse
wheel on Firefox's spring physics") run on Linux unchanged, but they animate
`scrollTop` on whatever the webview draws, and a software-rendered page is a
smooth curve drawn slowly.

**What the bug behind the workaround actually is.** Read at the source rather
than inherited: WebKitGTK's own default for `hardware-acceleration-policy` is
`ALWAYS` (`WebKitSettings.cpp`), which is what Epiphany and every Tauri app run
with, and `AcceleratedBackingStore.cpp` already drops to software on its own
when GTK cannot create a GL context. #2977 and its many siblings across Tauri,
Wails and Electron-adjacent trackers are one thing: the DMA-BUF renderer that
WebKitGTK 2.42 introduced failing GBM buffer allocation on the proprietary
NVIDIA driver, and the window staying blank. The fix the ecosystem settled on,
Tauri's Linux graphics page included, is `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
which WebKit still honours (`rendererBufferTransportMode` reads it first) and
which only gives up the DMA-BUF transport: the web process keeps compositing
on the GPU and hands frames over through shared memory. Turning acceleration
off for everyone to spare NVIDIA users a blank window was the wrong lever.

**The change.** `webviewgpu.go` decides the policy: Always by default;
`WEBKIT_DISABLE_DMABUF_RENDERER=1` set before `wails.Run` (GTK initialises
inside it) when any DRM card under `/sys/class/drm` is an NVIDIA device bound
to the `nvidia` driver, the same sysfs reads the `webkit2gtk-nvidia-quirk`
crate does for Rust apps, and never when the variable is already in the
environment, `0` included; `KONNEKT_WEBVIEW_GPU=never|ondemand|always` as the
override for a machine this still gets wrong. Nouveau is not a match, since it
does not have the problem. Every decision is one `linux webview gpu` line in
`konnekt.log` with its reason, so the next blank-window report starts from a
fact. The README's Linux bullet and `.claude/rules/builds-and-releases.md`
carry the user-facing and contributor-facing halves.

**What this does not settle.** No Linux machine was available to this session,
so the claim that Always is safe rests on WebKitGTK's own default and its
fallbacks, not on a run here. The quirk also costs a hybrid laptop the DMA-BUF
fast path whenever the discrete NVIDIA GPU is bound to the proprietary driver,
even when the integrated one would have drawn the window; that is the cheaper
side of the trade and the override is the way back. Wayland-specific NVIDIA
trouble (`__NV_DISABLE_EXPLICIT_SYNC`, WebKit bug 280210) is not handled.

**Verification.** Ten table-driven cases against a fake sysfs tree: no cards,
Intel only, NVIDIA on nouveau, NVIDIA proprietary, hybrid with NVIDIA second,
a preset `0` kept, each override value, a garbage override; plus a failing
`setenv` reported in the reason rather than swallowed, and a missing tree
reading as not NVIDIA. `gofmt`, `go vet ./...`, `go test ./...` green.

### 2026-10-09 — Vite 8, and the test runner it could not leave behind

**The ask.** #423: Dependabot's vite 5.4.21 to 8.x bump (#486) was red on
`vite.config.ts(40,3): error TS2769 ... 'test' does not exist in type
'UserConfigExport'`. Assess whether to move, and to what.

**Why #486 could never go green.** Reproduced on its branch. vitest 3.2.7
takes vite as a direct dependency (`^5 || ^6 || ^7`), so the lockfile held
vite 8.3.2 for the app and vite 5.4.21 for vitest, and `/// <reference
types="vitest/config" />` augments the copy vitest resolves. The app's
`defineConfig` came from the other one. Nothing in that pull request could fix
it, because the lockfile is generated and `dependabot.yml` ignored vitest
outright: the ignore kept vitest and coverage-v8 in step with each other by
never moving either, which is how vitest ended up two majors behind vite.

**The decision: move now, to vite 8.3.4, vitest 5.0.3 and
@vitest/coverage-v8 5.0.3.** `@vitejs/plugin-react` 5.2.0 and
`@tailwindcss/vite` 4.3.3 already peer `^8` and stay where they are. Vitest 4
(4.1.11) and Vitest 5 were each tried against the whole suite and both were a
drop-in: no test, mock or config line changed for either. 5 wins on runway
alone: 4.1.11 is from 2026-08-18 and the 4.x line has had no release since 5.0
shipped on 2026-09-03, so taking 4 would schedule another lockstep major
within months. Its one cost is Node: vitest 5 needs `^22.12 || ^24 || >=26`,
and vite 8 alone already needs `^20.19 || >=22.12`. Every workflow pins Node
22, and Node 20 is past end of life. Staying on 5.4.21 was the other option
and is the expensive one: vite 5 is no longer a maintained line. 5.4.21 is
from 2025-10-20, and the patch train of 2026-10-06 shipped 8.3.3, 8.2.4,
8.1.6, 7.3.7 and 6.4.4 and nothing for 5.4, so the next advisory against it
has no release to take. The plugin ecosystem
(`@vitejs/plugin-react` 6 already requires `^8`) moves on without it.

**Vite 8 against this app, item by item.**

- `stripCspInDev` keeps working unchanged: `transformIndexHtml` with
  `order: 'pre'` and a `handler` is still the hook's shape. Checked on a running
  dev server: the CSP meta is gone from the served page and the React refresh
  preamble is there, while `dist/index.html` still carries the policy.
- `define` of `process.env.DRAGGABLE_DEBUG` still replaces it in the build (no
  `DRAGGABLE_DEBUG` or `process.env` left in `dist/`). The dev optimizer, now
  Rolldown, leaves the expression in the pre-bundled `react-grid-layout`, and
  that is harmless: react-draggable 4.7.1 guards it with
  `typeof process !== "undefined"` itself.
- The bundle gate needed a fix. Rolldown hoists modules the entry shares with a
  lazy chunk (React, the JSX runtime, the server store, `App`) into helper
  chunks the entry imports statically, so `index-*.js` alone fell from 173.4 KB
  to 157.4 KB gzip while what a page load fetches before paint stayed put.
  `check-bundle-size.mjs` assumed the entry imported no helper chunk statically
  and said so; it now counts the entry plus everything `index.html`
  modulepreloads, which reads 172.5 KB (entry plus nine helpers) against main's
  173.4 KB (entry alone). The warmed set dropped from 750.2 KB to 721.2 KB.
  Without the fix the entry budget would have carried 15 KB of headroom nobody
  had agreed to.
- `pnpm check-prefetch` reads source and is unaffected: all 7 lazy chunks
  warmed.
- `demo/build.mjs` needs nothing: `node_modules/vite/bin/vite.js` is still the
  entry script, and the shim still lands ahead of the hashed module script.
- Vite 8 no longer installs esbuild, so the `esbuild` build allowlists in
  `frontend/package.json`, `pnpm.json` and `pnpm-workspace.yaml` now name a
  package that is not in the tree. Harmless, left alone here.

**Coverage.** The floor (`lines: 50`) holds untouched. The reading moved for a
reason that is not the tests: Vitest 3 read 64.0% of 20836 lines, Vitest 5
reads 58.7% of 7133 (Vitest 4 read 59.6% of 7139), on the same 1368 tests.
Since Vitest 4 the v8 provider remaps by AST and counts executable lines only.
Branches moved more (83.9% to 50.1%) for the same reason.

**`vite.config.ts` keeps the triple-slash reference and vite's
`defineConfig`.** `defineConfig` from `vitest/config` would also typecheck, but
it would have turned #486's clear TS2769 into plugin type mismatches between
two vite copies. The reference is kept as the canary, with a comment saying so.

**`dependabot.yml`** drops the vitest and coverage-v8 ignore for a
`vite-vitest` group (`vite`, `vitest`, `@vitest/*`, majors only, listed ahead
of `frontend`). Majors arrive as one pull request; minors and patches already
travel together in `frontend`. Whether Dependabot's pnpm updater resolves a
grouped major cleanly is something only its next run shows.

**What this does not settle.** No browser was reachable from this session, so
the built app and the demo were checked by their output, not rendered. The
default build target moved from Vite 5's `modules` to Vite 7's
`baseline-widely-available` (Safari 16.4 and Chrome 111 class), which WebView2
clears and which an old enough WebKitGTK might not; not measured on a Linux
machine. Tests ran 92s on Vitest 3 and 110s on Vitest 5 on the same machine,
almost all of it jsdom setup, which Vitest 5 itself flags (one environment per
file); worth a look on its own, not as part of the upgrade.

**Verification.** From `frontend/`: `typecheck`, `lint` (0 errors, the same 14
warnings), `build`, `test` (111 files, 1368 tests), `test:coverage`,
`format:check`, `check-bundle`, `check-tokens`, `check-prefetch` all green.
From the root: `node demo/build.mjs`, `go vet ./...`, `go test ./...` green.

### 2026-10-09 — The updater tests that survive mutation

#349 asked for `update.go` to be put through the recipe #348 used on
`backup.go`: for each escaped mutant, what would a caller observe if the code
were wrong that way. `update_check_test.go` and `update_install_test.go` are
the answer, about 980 lines, all through the public paths (`CheckForUpdates`,
`DownloadAndInstallUpdate`, `downloadAndApply` against an `httptest.Server`)
rather than against the mutants.

What they pin: the client `NewUpdateService` builds (the strict URL rule, a
30-second timeout); the update host compared case-insensitively; every field of a
check's result, an empty asset list sent as `[]` rather than `null`, and a
release-less repository echoing the running version; the snapshot channel's
tie going to stable; which endpoint a failed check names; the download
accepting exactly its declared size and stopping one byte over it, refusing
an announced length over the ceiling or over the declared size, a non-2xx, a
malformed URL and a truncated body; a checksum mismatch reported as an apply
failure; the user agent on every request; the redirect cap; progress
emitted once per percent and not at all without a length; the stall reader
re-arming on progress; and where a prerelease identifier stops being a number
(`'/'` and `':'` either side of the digits, a leading `+`, a digit run past
int64).

**Score.** `go-mutesting` v2.10.25 over `update.go` alone: 528 of 622 scored
mutants killed, about 85%, from 57% (271 of 476) on 2026-09-13. The two
numbers are not the same denominator: the file has grown since and v2.10.25
generates more mutants than v2.10.6 did, so read the change as the share,
not the count. Four mutants were skipped by the tool. Checked before
believing it: nothing left behind in `backend/services/` after the run, and
the baseline passed on its own.

**What the 94 left are.** Mostly equivalents and constants. 42 are
`numbers/incrementer` and `numbers/decrementer`, and the bulk of those are
the size and time bounds at the top of the file (`4 << 20` to `5 << 20`, a
30-second stall to 31) and zero values returned beside a `false` or an error
nobody reads; a test that pins a ceiling to the byte is a test of the
constant, not of the behaviour. In `numericIdentifier` the empty-string guard
and the digit scan are each equivalent to the `ParseInt` error check below
them for every input but the two now tested. The rest are error-wrap and
error-guard mutants on calls that do not fail under test, and the branches in
the asset download's redirect and stall handling that need a transport that
misbehaves on cue.

Coverage of `backend/services` went to 79.1%, and the floor in
`scripts/coverage-floor` from 74 to 77.
