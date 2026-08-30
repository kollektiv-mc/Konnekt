# Konnekt — Project Health Log

The completed remediation history for `agent_docs/HEALTH_CHECKLIST.md` — the
detailed, per-session narrative of health gaps that have been **closed**. This
was split out of the checklist so that file stays a lean, scannable yardstick;
this one is the append-only record of what was done, why, and how it was
verified.

- Evergreen quality yardstick + still-open items: `agent_docs/HEALTH_CHECKLIST.md`
- Architecture conventions + build/test commands: `agent_docs/CLAUDE.md`
- Feature scope (Alpha/Beta): `agent_docs/ROADMAP.md`

Entries below are historical. Unlike the checklist, this file *is* allowed to
grow. When a checklist `Open backlog` item is closed, move its write-up here.
`✅` marks a closed item; the "(the checklist above)" phrasing in the inherited
section below refers to the checklist as it read when these entries were
written.

## Index

Entries under `Remediation backlog` are grouped by finding and were written
before this log adopted dated entries; they carry no reliable date. Everything
after them is dated. Newest last, in both groups.

**By finding** — `## Remediation backlog`

- [P0 — CI foundation](#p0-ci-foundation)
- [P1 — CI blind spot: `@react-three/fiber`/`@types/three` resolution-dependent typecheck failure](#p1-ci-blind-spot-react-threefibertypesthree-resolution-dependent-typecheck-failure)
- [P1 — Auto-updater: check, release pipeline, and in-place install all shipped](#p1-auto-updater-check-release-pipeline-and-in-place-install-all-shipped)
- [Done — Lint/format enforcement (frontend)](#done-lintformat-enforcement-frontend)
- [P1 — Inline styles → Tailwind utilities (Milestone 2)](#p1-inline-styles-tailwind-utilities-milestone-2)
- [P1 — Modrinth client: HTTP paths are testable, and now tested](#p1-modrinth-client-http-paths-are-testable-and-now-tested)
- [P2 — React Compiler-readiness lint rules](#p2-react-compiler-readiness-lint-rules)
- [P1 — Test coverage + gate](#p1-test-coverage-gate)
- [P1 — Code-split heavy tiles](#p1-code-split-heavy-tiles)
- [P2 — Undocumented blank error-ignores](#p2-undocumented-blank-error-ignores)
- [P2 — Structured logging](#p2-structured-logging)
- [P2 — Repo hygiene](#p2-repo-hygiene)
- [P1 — Scheduler node-system deep analysis](#p1-scheduler-node-system-deep-analysis)
- [P1 — Scheduler tile convention gaps ✅ closed](#p1-scheduler-tile-convention-gaps-closed)
- [P2 — Memoization pass](#p2-memoization-pass)
- [P3 — Bound method missing `(T, error)` return](#p3-bound-method-missing-t-error-return)
- [P1 — Tile grid: two parallel systems collapsed into one](#p1-tile-grid-two-parallel-systems-collapsed-into-one)
- [P1 — Tile grid: crate-drag placement fixed (the above shipped broken)](#p1-tile-grid-crate-drag-placement-fixed-the-above-shipped-broken)
- [P1 — Tile grid: crate-drag placement, rebuilt (the above shipped broken too)](#p1-tile-grid-crate-drag-placement-rebuilt-the-above-shipped-broken-too)
- [P1 — Tile grid: right-hand cells unreachable from the crate](#p1-tile-grid-right-hand-cells-unreachable-from-the-crate)

**By date**

- [2026-08-15 — Checklist re-baseline after an unpaused stretch of app work](#2026-08-15-checklist-re-baseline-after-an-unpaused-stretch-of-app-work)
- [2026-08-17 — Milestone 2 closed: App.tsx's last inline styles](#2026-08-17-milestone-2-closed-apptsxs-last-inline-styles)
- [2026-08-17 — Last three data polls closed, and a checklist claim that was wrong](#2026-08-17-last-three-data-polls-closed-and-a-checklist-claim-that-was-wrong)
- [2026-08-17 — Backend test coverage, and a CI floor to hold it](#2026-08-17-backend-test-coverage-and-a-ci-floor-to-hold-it)
- [2026-08-17 — The coverage floor, rebuilt to match the repo's own gate shape](#2026-08-17-the-coverage-floor-rebuilt-to-match-the-repos-own-gate-shape)
- [2026-08-17 — The border-token sweep, and the invariant that now holds it](#2026-08-17-the-border-token-sweep-and-the-invariant-that-now-holds-it)
- [2026-08-18 — The dead `--panel-bg`, and why the recorded fix was wrong](#2026-08-18-the-dead-panel-bg-and-why-the-recorded-fix-was-wrong)
- [2026-08-18 — The website stops hand-copying the token layer](#2026-08-18-the-website-stops-hand-copying-the-token-layer)
- [2026-08-18 — website/ gets its first gates](#2026-08-18-website-gets-its-first-gates)
- [2026-08-18 — Backup filenames that were not unique, and an id that was not random](#2026-08-18-backup-filenames-that-were-not-unique-and-an-id-that-was-not-random)
- [2026-08-18 — The three error-ignores at the repo root, and the one directory everything persisted through](#2026-08-18-the-three-error-ignores-at-the-repo-root-and-the-one-directory-everything-persisted-through)
- [2026-08-19 — The dead code the per-file grep could never find](#2026-08-19-the-dead-code-the-per-file-grep-could-never-find)
- [2026-08-19 — Another product's roadmap, and eight boxes nobody had ticked](#2026-08-19-another-products-roadmap-and-eight-boxes-nobody-had-ticked)
- [2026-08-19 — The duration token Tailwind was never reading](#2026-08-19-the-duration-token-tailwind-was-never-reading)
- [2026-08-20 — Four stores that showed a refused write as saved](#2026-08-20-four-stores-that-showed-a-refused-write-as-saved)
- [2026-08-20 — The status every tile trusted and one tile owned](#2026-08-20-the-status-every-tile-trusted-and-one-tile-owned)
- [2026-08-20 — A log a bug reporter can attach](#2026-08-20-a-log-a-bug-reporter-can-attach)
- [2026-08-20 — The bound type TypeScript never saw](#2026-08-20-the-bound-type-typescript-never-saw)
- [2026-08-21 — Wings survey, triage, and adoption planning](#2026-08-21-wings-survey-triage-and-adoption-planning)
- [2026-08-22 — The console that died on one long line](#2026-08-22-the-console-that-died-on-one-long-line)
- [2026-08-22 — The half-written file a crash could leave](#2026-08-22-the-half-written-file-a-crash-could-leave)
- [2026-08-22 — The torn copy of a live world](#2026-08-22-the-torn-copy-of-a-live-world)
- [2026-08-23 — The power actions that raced each other](#2026-08-23-the-power-actions-that-raced-each-other)
- [2026-08-26 — The server that claimed running while still generating its world](#2026-08-26-the-server-that-claimed-running-while-still-generating-its-world)
- [2026-08-26 — The stop that killed mid-save](#2026-08-26-the-stop-that-killed-mid-save)
- [2026-08-27 — The console that learned to say what Konnekt was doing](#2026-08-27-the-console-that-learned-to-say-what-konnekt-was-doing)
- [2026-08-29 — The channel a snapshot could never update through](#2026-08-29-the-channel-a-snapshot-could-never-update-through)
- [2026-08-29 — The warm-up that moved the stutter onto the first scroll](#2026-08-29-the-warm-up-that-moved-the-stutter-onto-the-first-scroll)
- [2026-08-30 — The catch attached to a call that never returned](#2026-08-30-the-catch-attached-to-a-call-that-never-returned)
- [2026-08-30 — The narration you had to read to know whether it worked](#2026-08-30-the-narration-you-had-to-read-to-know-whether-it-worked)

---

## Remediation backlog

Concrete, prioritized follow-ups based on the most recent review. This section
*is* allowed to go stale/get checked off — unlike the checklist above, it's a
todo list, not a target.

### P0 — CI foundation
- ✅ Added `.github/workflows/ci.yml`: `frontend` job (ubuntu-latest —
  `pnpm typecheck` + `pnpm lint` + `pnpm build`) and `backend` job
  (windows-latest, matching the shipping target — `gofmt -l` + `go vet ./...` +
  `go test ./...` + `go build ./...`), both with dependency caching
  (`setup-node`'s `cache: pnpm`, `setup-go`'s `cache: true`). Runs on push to
  `main` and on every PR. `wails build` packaging deferred (see below) — the
  light `go build`/`pnpm build` smoke check was judged sufficient for now.
  Fixed the 14 Go files that weren't `gofmt`-clean as a prerequisite. Confirmed
  green on `main`: https://github.com/sandrogekeler/Konnekt/actions/runs/28618749554
- Follow-up (not yet done): a release-tag-gated full `wails build` packaging
  job, for stronger end-to-end confidence than the `go build`/`pnpm build`
  smoke check gives.

### P1 — CI blind spot: `@react-three/fiber`/`@types/three` resolution-dependent typecheck failure
- Found 2026-07-16: `frontend/src/tiles/worlds/scene/Galaxy.tsx`'s new
  `LayoutScaleController` (from the worlds zoom-to-fit merge) called
  `.unproject(state.camera)` — R3F's `state.camera` type and the app's
  `@types/three` `Camera` type had diverged (newer three fields like
  `reversedDepth`/`static`/`pivot` weren't on R3F's copy), so `tsc` should
  reject the assignment. It passed in this repo's own CI (`pnpm typecheck` +
  `pnpm build`, both on a `--frozen-lockfile` install) but failed a
  contributor's local `wails dev`, which ran a fresh non-frozen `pnpm install`
  that resolved a node_modules tree where the two `Camera` types diverge.
  First patched at the call site with the same cast the sibling file in the
  same merge already uses (`WorldsScene.tsx`'s `state.camera as unknown as
  THREE.PerspectiveCamera` precedent) — kept as belt-and-suspenders, but that
  alone left the underlying tree still capable of producing more of these.
- ✅ **Root cause found and removed.** The tree carried **two** `@types/three`/
  `three` copies: the app's own `@types/three@0.184.1`/`three@0.184.0`, and
  `@types/three@0.156.0`/`three@0.156.1` pinned by `skinview3d` (a dependency
  that was never imported anywhere under `frontend/src/` — see "P2 — Repo
  hygiene" below). Depending on how a given `pnpm install` laid out
  `node_modules`, R3F's camera type could bind to either copy; the
  0.156.0-era `Camera` predates the fields 0.184.1 added, producing the
  mismatch. CI and prior sandbox installs happened to dedupe to 0.184.1, so
  this was invisible there — only a fresh install on the reporting
  contributor's machine resolved the conflicting layout. Removed `skinview3d`
  (`pnpm remove skinview3d` in `frontend/`); confirmed via `pnpm-lock.yaml`
  that exactly one `@types/three@0.184.1` and one `three@0.184.0` remain in
  the tree. `pnpm typecheck`/`pnpm build`/`pnpm lint` (0 errors)/`pnpm test`
  (165/165) all re-verified green after the removal.

### P1 — Auto-updater: check, release pipeline, and in-place install all shipped
- ✅ **In-app update check shipped.** `version.go` (package `main`) is the
  single source of the app's version (`var Version = "0.1.0-dev"`), also
  mirrored in `wails.json`'s `info.productVersion` for the built binary's
  file metadata — the app previously had **no version anywhere** (confirmed
  via grep before this work; `wails.json` had no `info` block, frontend
  `package.json` sits at the placeholder `0.0.0`, the About pane showed
  nothing). `backend/services/update.go`'s `UpdateService` queries
  `GET /repos/sandrogekeler/Konnekt/releases/latest` on the GitHub REST API —
  **GitHub Releases *is* the version database**, no separate backend needed;
  each release is a git tag with per-platform binaries attached as assets.
  `baseURL` is constructor-injected (unlike `modrinth.go`'s hardcoded
  `modrinthBase`, a gap `update_test.go` deliberately avoids repeating) so
  `CheckForUpdates` is fully covered by `httptest.Server`-backed tests:
  update-available, up-to-date, 404-no-releases-yet (treated as "up to
  date", not an error — the correct state until the first release is cut),
  malformed JSON, and HTTP 500. `compareVersions` (semver-ish, `v`-prefix
  tolerant, prerelease-sorts-lower) has its own table-driven test.
  `GetAppVersion`/`CheckForUpdates` bound on `App` (`app.go`); Settings →
  About shows the version + a "Check for updates" button (idle → checking →
  up to date / update-available-with-Download-button / error); Settings →
  General adds a "Check for updates on startup" toggle
  (`AppSettings.CheckUpdatesOnStartup`, defaults `true` in
  `config.go`'s `GetAppSettings()`). The startup path is a **one-shot check**
  (`frontend/src/hooks/useUpdateCheck.ts`, tested with the established
  `vi.mock('.../wailsjs/go/main/App')` + `renderHook` pattern), not a poll,
  wired into `App.tsx` alongside the other one-shot startup effects — it
  **no-ops when `Version` contains `-dev`** (a dev/`wails dev` build has no
  installable artifact to update to), and failures (offline, no releases)
  are silent by design since it's a background check, not a user action.
- ✅ **Release pipeline shipped, now with a Linux leg.**
  `.github/workflows/release.yml` triggers on a `v*` tag push and runs four
  jobs: `build-windows` (unchanged, `windows-latest`, `-ldflags "-X
  main.Version=$TAG"`), `build-linux` (in an `ubuntu:22.04` **container** —
  pins glibc 2.35 + webkit2gtk-4.1 independently of the `ubuntu-22.04` runner
  image's own deprecation schedule — with `wails build -tags webkit2_41`),
  `package-rpm` (in a `rockylinux/rockylinux:10` container, packages the
  Linux binary built above into an `.rpm` with a `.desktop` entry and
  hand-declared `Requires: webkit2gtk4.1, gtk3` since `AutoReqProv: no` is set
  — see `build/linux/konnekt.spec`), and `publish` (aggregates
  `konnekt-windows-amd64.exe`, `konnekt-linux-amd64`, and the `.rpm` into one
  `checksums.txt` and a single `gh release create`). Rocky/RHEL **9** is
  deliberately not covered: EL9 never shipped webkit2gtk-4.1 and EL10 dropped
  4.0, so one binary can't span both — see the README's Platform support
  section. macOS is still not built in CI — a documented follow-up, not
  built.
- ✅ **In-place install shipped, Windows + Linux.** Settings → About's
  "Download & Install" button (previously just opened the release page) now
  calls `App.DownloadAndInstallUpdate()`, which re-checks the latest release,
  picks the asset matching the running platform (`platformAssetNameFor`
  covers `windows` and `linux`; other platforms — and an RPM install's
  root-owned `/usr/bin`, caught generically by `selfupdate`'s
  `CheckPermissions` — get a clear error instead of a silent failure or a
  guessed name nothing publishes), downloads `checksums.txt`, streams
  the binary while verifying its SHA256 against it, and replaces the running
  executable in place via `github.com/minio/selfupdate` — which owns the
  Windows "can't overwrite a running exe" rename dance and auto-rolls-back on
  a failed write (recorded in `DEPENDENCIES.md`). On success the app spawns
  the replaced binary and quits via `runtime.Quit`; on failure (offline
  mid-download, a Program-Files install without write permission, a bad
  checksum) the frontend falls back to the original "open release page"
  button rather than silently failing. Progress streams over the existing
  `EventBus` (`EventUpdateProgress` in `events.go`) to a Wails
  `EventsOn` listener in `SettingsModal.tsx`'s `AboutPane`, cleaned up on
  unmount — not `useEffect` polling, per `CLAUDE.md`'s rule. Dev builds
  (`Version` containing `-dev`) are rejected up front (in both `App.go` and
  the About pane's UI, which disables the button with a hint) since a `wails
  dev` process has no packaged binary to replace — this is also why the
  feature can only be exercised end-to-end against a real packaged build, not
  `wails dev`. Testable seams split out for this: `platformAssetNameFor` and
  `selectPlatformAssets` take `goos`/`goarch` as parameters rather than
  reading `runtime.GOOS`/`GOARCH` directly, and `downloadAndApply` takes a
  `TargetPath` override, so `update_test.go` exercises the real
  download+checksum-verify+`selfupdate.Apply` path (success, and a rejected
  checksum mismatch leaving the original file untouched) against a temp file
  instead of the actual running executable, all from a single (non-Windows)
  dev machine.
- Also done: `frontend/src/lib/changelog.ts`'s `CHANGELOG_URL` flipped from
  `/commits/main` to `/releases` now that the release pipeline exists.
- **Deferred, not built this pass:** code-signing/notarization for the
  published binaries (unsigned builds trigger Windows SmartScreen warnings —
  functional, just not polished); a macOS release leg and its self-update
  support (`platformAssetNameFor` is structured to add a case per platform,
  but no asset-naming convention or code-signing story exists for macOS yet);
  a second Linux leg for Rocky/RHEL 9 (webkit2gtk-4.0), which would need the
  updater to probe the host's installed webkit version rather than assume 4.1.
- Also fixed alongside the Linux release leg: on non-Windows, `killTree`
  previously killed only the direct Java PID, and the process was never put
  in its own process group at spawn — so a Konnekt crash orphaned the running
  Minecraft server instead of the OS reaping it (the Windows Job Object
  already handled this). `server.go` now calls a new `configureProcAttr(cmd)`
  hook immediately before `Start()`; `server_linux.go` sets
  `Setpgid: true, Pdeathsig: SIGKILL` (the closest Linux analogue to the Job
  Object, best-effort since `Pdeathsig` is scoped to the parent OS thread and
  Go can migrate goroutines across threads), `server_unix.go` (`!windows &&
  !linux`) sets `Setpgid` only, and `killTree` in `server_other.go` now
  signals the whole group via `syscall.Kill(-pid, ...)`.

### Done — Lint/format enforcement (frontend)
- ✅ Migrated `frontend/` from Tailwind v3 (barely used) to v4, mapped the
  existing CSS-variable token system into `@theme inline`
  (`frontend/src/style.css`) so `applySkin()` keeps working unchanged.
- ✅ Added a real ESLint flat config (`frontend/eslint.config.js`):
  `typescript-eslint` + classic `react-hooks` rules (`rules-of-hooks`,
  `exhaustive-deps`) + `react-refresh` + a `warn`-level `no-restricted-syntax`
  rule flagging inline `style={{}}` (see Clean pillar, item 6, and Milestone 2
  below). `pnpm lint` now runs and passes.
  - Deliberately **not** enabled: `eslint-plugin-react-hooks`'s
    `recommended`/`recommended-latest` configs, which bundle React Compiler
    readiness rules (`purity`, `refs`, `set-state-in-effect`, etc.). These flag
    ~60 findings, mostly in the react-three-fiber scene code
    (`frontend/src/tiles/worlds/scene/`) where imperative per-frame ref sync is
    the standard r3f pattern, not a bug. Revisit if the project adopts the
    React Compiler.
- ✅ Added Prettier + `prettier-plugin-tailwindcss`
  (`frontend/.prettierrc.json`). **Not** run as a one-time mass reformat —
  Prettier's opinionated formatter expands the codebase's condensed
  single-line block style (e.g. `catch { /* comment */ }`) across ~105 files,
  which would be a large, low-value diff. Applied incrementally instead, via
  the pre-commit hook below (format-on-touch).
- ✅ Added a pre-commit hook (`lefthook.yml`, root `package.json`) running
  Prettier + ESLint + `tsc --noEmit` on staged frontend files, and `gofmt` +
  `go vet` on staged Go files.
- ✅ Cleared the real debt the new tooling surfaced: empty catch blocks, unused
  vars/imports, ternary-as-statement, redundant boolean casts, a genuine
  conditional-hooks bug in `frontend/src/tiles/worlds/index.tsx` (hooks were
  declared after an early `return`), and 9 `any` usages down to 1 documented,
  justified exception (`frontend/src/tiles/worlds/scene/Sun.tsx` — a
  known `three`/`@react-three/fiber` cross-package type mismatch).

### P1 — Inline styles → Tailwind utilities (Milestone 2)
- ✅ First slice done: `frontend/src/components/ui/*` (5 files —
  `SettingRow`, `Toggle`, `Segmented` fully migrated; `ColorSwatch` and the
  animation-driven parts of `Popover` correctly stay inline as documented
  `eslint-disable-next-line no-restricted-syntax` exceptions — arbitrary hex
  colors and open/close-animation transforms aren't visible to Tailwind's
  static class scanner). Global warning count: 725 → 711. Ratcheted
  `no-restricted-syntax` from `warn` → `error` for `src/components/ui/**/*.tsx`
  in `frontend/eslint.config.js` (as a config object placed *after* the global
  rules block — flat-config applies later array entries' matching rules on
  top of earlier ones, opposite of what might be assumed). This is the
  reusable template for future per-directory passes. Confirmed green on
  `main`: https://github.com/sandrogekeler/Konnekt/actions/runs/28628543709
  - Two conversion rules established during this pass: (1) Tailwind v4's JIT
    scanner only sees literal class-name strings in source — a
    template-interpolated arbitrary class (e.g. `` `min-w-[${width}px]` ``) is
    invisible to it and produces no CSS, so prop/state-driven numeric values
    must stay inline; (2) a boolean ternary between two *static* values (e.g.
    `checked ? 'var(--accent)' : 'var(--border-hover)'`) is not "genuinely
    dynamic" — convert to a conditional `className`, reserving `style={{}}`
    for values that are actually computed/interpolated.
  - Verified in-browser via the Settings modal (gear icon — pure client
    state, no Wails backend needed): `Toggle`'s checked/unchecked colors and
    slide animation, `Segmented`'s Light/Dark/System pill, and `ColorSwatch`
    all confirmed pixel-correct via computed-style inspection (e.g. the
    selected pill's `background-color` resolved to `rgb(74, 222, 128)` =
    `#4ade80`, the accent color, exactly as expected from the `@theme inline`
    token mapping). `Popover` could not be live-verified the same way — its
    only real consumers are in the Mods tile (`BrowsePanel.tsx`,
    `InstalledPanel.tsx`), which calls `EventsOn` on mount and crashes without
    the Wails bridge (same pre-existing environment limitation as the
    performance-tile check in the prior session, unrelated to this change).
    Indirect confirmation instead: `Popover`'s `shadow-[...]` arbitrary-value
    syntax is identical in form to `Toggle`'s, which *was* verified live
    (`box-shadow` computed to `rgba(0,0,0,0.3) 0px 1px 3px 0px`, matching the
    class exactly).
- ✅ Second slice done: `frontend/src/tiles/TileWrapper/index.tsx` — the
  shared wrapper every tile renders inside (`CLAUDE.md`'s "Tile system"),
  same "shared primitive" philosophy as the `ui/*` slice. All 5 occurrences
  converted to Tailwind utilities; this is the **first directory in the
  migration to reach zero remaining inline styles** — no `eslint-disable`
  exceptions needed, unlike `ui/*`. Global warning count: 711 → 706. Added
  `src/tiles/TileWrapper/**/*.tsx` to the same ratcheted-`error` `files` glob
  in `frontend/eslint.config.js` as `ui/*` (merged into one config object
  rather than duplicating the rule block). Confirmed green on `main`:
  https://github.com/sandrogekeler/Konnekt/actions/runs/28630261474
  - ⚠️ **Regression this slice shipped, fixed later:** the commit dropped the
    leading space in the outer div's conditional class string
    (`` `relative h-full${maximized ? '' : ' tile-outer'}` `` →
    `...: 'tile-outer'`), fusing `h-full` and `tile-outer` into the invalid
    token `h-fulltile-outer` for every *non-maximized* tile. Since
    `.tile-wrapper` is `position:absolute; inset:0`, losing `h-full` on its
    parent collapsed all tiles to 0px height — the whole dashboard canvas
    rendered empty (only maximized tiles, which take the `''` branch, were
    fine). Fixed by moving the separator space *outside* the interpolation
    (`` `relative h-full ${maximized ? '' : 'tile-outer'}` ``). **Lesson for
    future className migrations:** conditional class strings with a
    leading/trailing space inside the conditional are fragile; keep the
    separating space outside the `${}`. And verify migrated tiles by their
    rendered *geometry* (non-zero `getBoundingClientRect().height`), not just
    computed `background-color` — a 0-height element still reports its color.
  - The three `onMouseEnter`/`onMouseLeave` pairs that imperatively set
    `e.currentTarget.style.borderColor`/`.style.color` were left untouched —
    not the JSX `style=` attribute the lint rule targets, and out of scope to
    redesign. Verified live that this doesn't change runtime behavior: the
    default border/text-color values now come from `className`, but the
    hover handlers still directly set an inline `style` override, which wins
    over `className` at the same specificity today exactly as it did before.
  - Verified live in-browser (default dashboard, no Wails backend needed —
    every visible tile uses this wrapper): computed styles matched exactly,
    including the unusual `backgroundImage:
    linear-gradient(var(--bg-surface),var(--bg-surface))` (a same-color-twice
    trick) which resolved to identical gradient stops before and after.
    Toggling a tile's maximize/restore confirmed the `cursor: maximized ?
    'default' : 'grab'` ternary → conditional `className` conversion is
    correct: querying all `.drag-handle` elements while one tile was
    maximized showed `cursor: grab` on the four background grid tiles and
    `cursor: default` on the maximized overlay's own handle. Confirmed the
    hover border-color swap still fires (inspected the element's `style`
    attribute directly: `border-color: var(--border-hover)` on hover,
    reverting to `var(--border-subtle)` on mouseleave).
- ✅ Third slice done: batched all five remaining small single-file tiles in
  one pass — `stats`, `notifications`, `quick-commands`, `performance`,
  `console` (40 occurrences total, exact count corrected from the earlier
  census, which missed the `style={cond ? {...} : {}}` ternary form).
  `notifications` fully converts to zero remaining inline styles (including a
  `KIND_COLOR` → `KIND_CLASS` static Tailwind-class lookup, replacing the
  removed CSS-var lookup — `NotifKind` is a closed string-literal union, so
  this is exactly as static as a boolean ternary). `stats`/`quick-commands`/
  `performance` each keep exactly one genuinely-computed exception (a
  percentage-width bar fill, and a floating dropdown's
  `getBoundingClientRect`-derived position). `console` keeps 4 documented
  exceptions, all `fontFamily: "'JetBrains Mono', monospace"` — see the new
  `--font-mono` token-gap entry below. The eslint ratchet's `files` glob also
  caught one leftover from the earlier code-split session:
  `performance/charts.tsx`'s recharts `<Legend>` label color (a ternary
  between two static `rgba()` values, converted the same way). Global warning
  count: 706 → 665.
  - `#f87171` in `quick-commands.tsx` turned out to be exactly Tailwind's
    default `red-400` — converted to named classes with opacity modifiers
    (`bg-red-400/15`, `border-red-400/30`, `text-red-400`) instead of
    arbitrary hex brackets.
  - Verified live: `stats`' status dot correctly shows `bg-red-500` with
    `box-shadow: none` in the offline state (computed style, confirming the
    ternary's false branch); `console`'s command input still resolves
    `font-family: "JetBrains Mono", monospace` exactly; the quick-commands
    kick/ban modal panel opened and its `background-color`/`border-color`
    matched the source arbitrary values exactly (`rgb(13,14,20)` = `#0d0e14`,
    `white/10` border). No new console errors beyond the same pre-existing
    `quick-commands` `window.go`-unavailable mount errors seen in prior
    sessions. Confirmed green on `main`:
    https://github.com/sandrogekeler/Konnekt/actions/runs/28631150720
- Missing `--font-mono` theme token found during this pass, tracked
  separately: see "P2 — Missing `--font-mono` theme token" below.
- ✅ Fourth slice done: the **mods tile** — the single largest remaining
  cluster, all 9 files (`frontend/src/tiles/mods/**`: `InstalledPanel.tsx`,
  `ModPreviewDialog.tsx`, `ContentDetailPanel.tsx`, `BrowsePanel.tsx`,
  `index.tsx`, `DependencyDialog.tsx`, `ContentCard.tsx`, `Pagination.tsx`,
  `ModAboutBody.tsx`). 176 → 7 remaining, all genuinely dynamic and documented
  with `eslint-disable-next-line no-restricted-syntax`: three live-percent
  progress-bar widths (`index.tsx` x2, `InstalledPanel.tsx`), two live
  user-controlled grid-column counts (`InstalledPanel.tsx`, `BrowsePanel.tsx`),
  and the resizable detail panel's live `panelWidth`-derived width/transform
  (`BrowsePanel.tsx` x2). Global warning count: 668 → 492. Added
  `src/tiles/mods/**/*.tsx` to the ratcheted-`error` `files` glob in
  `frontend/eslint.config.js`; `pnpm lint` passes with 0 errors, confirming
  every remaining inline style in the tile is a documented exception.
  - Static ternaries between two fixed values (color, background, opacity,
    border, font-weight) converted to conditional `className`s throughout,
    per the established rule — including several 3-way ternaries (e.g. a
    version-type color lookup keyed by a plain `string` field, mirrored the
    same way an already-existing ternary chain in `ModPreviewDialog.tsx`
    handled it, for consistency between the two files).
  - New conversion patterns established this pass, verified live via computed
    `getComputedStyle()` checks against a running `pnpm dev` server (not just
    typecheck/lint): `color-mix(in srgb, ...)` values as Tailwind arbitrary
    `bg-[...]`/`border-[...]` (verified the mixed color resolves correctly);
    `mask-image`/`-webkit-mask-image` gradients as arbitrary properties
    (`[mask-image:...]`); `line-clamp-2` replacing the manual
    `-webkit-box`/`-webkit-line-clamp` trick; `caret-accent` for `caretColor`;
    opacity ternaries mapped onto Tailwind's opacity scale exactly (`0.55` →
    `opacity-55`, `0.2` → `opacity-20`); a fixed-duration `transform`
    transition (`280ms cubic-bezier(0.4,0,0.2,1)`) converted to
    `duration-[280ms] ease-in-out` since Tailwind's `ease-in-out` *is* that
    exact bezier curve — the `PANEL_SLIDE_MS` constant that previously held
    this value was removed as dead code once inlined into the class, with a
    comment linking the two so a future duration change updates both;
    `calc(100vw-48px)`-style arbitrary values confirmed Tailwind auto-inserts
    the required operator spacing even without explicit underscores.
  - Not independently verified: the mods tile itself rendering end-to-end
    inside the app. `index.tsx`'s `useMods` hook calls `EventsOn` and
    `DetectServerLoader` on mount and crashes without the Wails bridge, so
    only the 8 pure-presentational child components could be exercised
    (verified via direct computed-style checks against a running Vite dev
    server, not a full component mount) — a full visual pass needs `wails dev`
    with a configured server, same limitation noted for backups/performance in
    prior sessions.
- ✅ **Fifth slice done: the backups tile** — the largest remaining cluster at
  the time (116 → 19, all 7 files: `index.tsx`, `SolarSystem.tsx`,
  `BackupCard.tsx`, `BackupCarousel.tsx`, `ServerInfoPanel.tsx`,
  `WorldInfoPanel.tsx`, `WireframeSphere.tsx`; `BackupsSummary.tsx` and
  `BackupRunningDialog.tsx` reach **zero** remaining inline styles). Every
  survivor carries a documented `eslint-disable-next-line` exception. Global
  frontend-wide count: 451 → 354. Added `src/tiles/backups/**/*.tsx` to the
  ratcheted-`error` `files` glob in `frontend/eslint.config.js`; `pnpm lint`
  passes with 0 errors.
  - Same "static ternary between two fixed values → conditional `className`"
    rule applied throughout (e.g. `BackupCard`'s `focused`-driven width/height/
    border/background, the dim-overlay's opacity/pointer-events/cursor triad).
    One refinement discovered this pass: a **CSS `rotate()`/grid-template-rows
    two-value ternary is also "two fixed values"**, not just color/border
    ternaries — `ServerInfoPanel.tsx`'s collapse-chevron `rotate(180deg)`/
    `rotate(0deg)` converted cleanly to Tailwind's native `rotate-180`/
    `rotate-0` utilities (the original plan for this file assumed these had to
    stay inline; they didn't).
  - **Multi-property/multi-easing `transition` strings don't fit one Tailwind
    utility** and were kept inline as a distinct, deliberate exception
    category (not "computed", just not expressible in one class): `BackupCard`
    mixes a 260ms custom-bezier (width/min-height) with a 200ms ease
    (padding/border-color/background) in one declaration; `SolarSystem.tsx`'s
    shared `FOCUS_TRANSITION` constant (imported from `focusLayout.ts`) mixes
    left/top at 380ms bezier with opacity at 250ms ease. Where a transition
    targets only *one* property at *one* duration/easing (e.g. the scaled-
    sphere's `transform 350ms cubic-bezier(...)`), it converts cleanly to
    `transition-transform duration-[350ms] ease-[cubic-bezier(...)]` — Tailwind
    arbitrary values pass the raw CSS timing-function through unchanged,
    including the literal `ease` keyword (`ease-[ease]`), which is **not**
    the same curve as Tailwind's own `ease-in-out` alias.
  - `SolarSystem.tsx` had more static wins than the original per-file plan
    assumed: `focusLayout.ts` was checked directly, confirming `FOCUS.left`/
    `FOCUS.top` are compile-time constants — so `SunNode`'s position ternary
    (`isFocused ? FOCUS.left : '50%'`) is between two *fixed* values (unlike
    `WorldNode`'s analogous ternary, which mixes that same constant with a
    genuinely per-world computed `${cfg.x}%`, and correctly stays inline).
    `SunNode`'s wrapper reduced to a single inline `style` holding only the
    shared `FOCUS_TRANSITION` constant.
  - `#f87171` confirmed to equal the `--danger` token exactly
    (`rgb(248 113 113)` in `style.css`'s `@theme inline` block) — converted
    every occurrence to `text-danger`/`border-danger`/`bg-[color-mix(in_srgb,var(--danger)_·%,transparent)]`
    instead of the literal hex, so these follow the theme (unlike the
    already-`red-400`-converted quick-commands case, `--danger` isn't
    Tailwind's stock `red-400` value, so the token, not a stock color name,
    is the correct target here). `#22c55e` (Tailwind's exact `green-500`)
    converted to the named class per the established quick-commands
    precedent.
  - Verified: `pnpm typecheck` (0 errors), `pnpm lint` (0 errors — one
    genuine bug caught and fixed by the lint gate itself: converting
    `SolarSystem.tsx`'s opacity ternaries to `opacity-35`/`opacity-100`
    classes left the `FOCUS_FADED_OPACITY` import unused, which
    `@typescript-eslint/no-unused-vars` flagged as an error and was removed),
    `pnpm test` (131/131, unchanged), `pnpm build` (entry chunk 490.77 KB →
    479.3 KB gzip — a net *decrease*, consistent with removing inline style
    objects rather than adding code), `pnpm check-bundle` (479.3 KB, well
    under the 550 KB budget).
  - Not independently verified: live rendering of the tile itself. Same
    environment limitation noted for every prior tile pass — `useBackups`/
    `useBackupWorlds` call the Wails bridge on mount, and this sandbox has no
    configured Minecraft server, so the sidebar's tile-activation guard
    no-ops for server-scoped tiles before the component even mounts (couldn't
    get as far as the mods/worlds passes, which at least reached
    Wails-bridge-crash on mount). The app shell and every already-mounted
    tile (Console, Stats, Commands, Players) rendered correctly throughout
    with no new console errors beyond the pre-existing `quick-commands`
    `window.go`-unavailable one. A full visual pass needs `wails dev` with a
    configured server, same as backups/worlds/performance previously.
- ✅ **Sixth slice done: the scheduler tile** (`frontend/src/tiles/scheduler/**`,
  a React Flow/xyflow visual node editor) — the next-largest remaining
  cluster. A recount against `pnpm lint`'s own output (not just `grep`) found
  99 real occurrences across 8 `.tsx` files, not the ~90 first estimated —
  `GraphEditor.tsx` (19, not 14), `NodeDataPanel.tsx` (13, not 11), and
  `QuickAddMenu.tsx` (15, not 14) were undercounted. All 8 files converge to
  **zero or a small, fully-documented set of exceptions**: `SchedulerSummary.tsx`,
  `BlockPalette.tsx`, `NodeConfigPanel.tsx`, and `NodeDataPanel.tsx` reach
  **zero** remaining inline styles; `GraphEditor.tsx` keeps 1 (the `MiniMap`
  position override — see below); `QuickAddMenu.tsx` keeps 2 (viewport-computed
  popup positions); `AnimatedEdge.tsx` keeps its original 3 (xyflow-provided
  style spreads + per-instance animation delay, unchanged in shape, now with
  disable comments); `BlockNode.tsx` keeps 10 (the most complex file — see
  below). Added `src/tiles/scheduler/**/*.tsx` to the ratcheted-`error` `files`
  glob in `frontend/eslint.config.js`; `pnpm lint` passes with 0 errors,
  global warning count 376 → 277 (all 99 scheduler occurrences resolved).
  - **Tailwind v4's default palette does not render pixel-identical to the
    classic hex values baked into this codebase** — verified by checking
    `frontend/src/style.css`'s tokens directly rather than assuming a v3-era
    hex-to-stock-color match: only `#22c55e`/`#f59e0b` matched existing tokens
    exactly (`--success`/`--warning`, converted to `text-success`/`border-warning`
    etc.); every other hardcoded hex in the tile (`#ef4444`, `#7c3aed`,
    `#60a5fa`, `#1e3a5f`, category colors) had no exact stock-Tailwind match
    and became arbitrary-value brackets (`text-[#ef4444]`) instead — this
    still converts the occurrence fully (it's a static literal either way),
    it just isn't a *named* class. A hardcoded hex needing an arbitrary
    bracket is not the same as a value needing to *stay inline* — several
    sites in `NodeConfigPanel.tsx`/`NodeDataPanel.tsx` initially assumed to
    need "stay inline" exceptions for their odd colors converted fully once
    this distinction was made.
  - **`GraphEditor.tsx`'s `btn()` inline-style factory → `btnClass()`
    className factory** was the single biggest win in the slice, clearing 7
    of 19 occurrences in one refactor (every toolbar button call site). Also
    fixed a miscategorization risk before it shipped: `opacity: saving ? 0.5
    : 1` is a plain two-fixed-value ternary (rule already established in
    prior slices), not a value that needs to stay inline — converted to a
    conditional `opacity-50` class. The `ReactFlow` component's `style={{
    background: 'var(--bg-base)' }}` prop turned out to be fully redundant
    dead code (`scheduler.css`'s `.react-flow` rule already sets that
    background) and was deleted outright rather than converted.
  - **New pattern: category-keyed lookup tables shared across files.** Block
    categories (`trigger/action/control/notify/data`) are a closed 5-value
    set already backing `CATEGORY_COLOR`/`CATEGORY_ICON` in `blockMeta.ts`.
    Added sibling `CATEGORY_TEXT_CLASS`/`CATEGORY_BORDER_CLASS` maps in the
    same file, consumed by `BlockPalette.tsx` and `QuickAddMenu.tsx` (both
    the search-result and category-browse list items) — the same "N-way
    ternary keyed by a closed string union → className lookup" rule used for
    `KIND_CLASS` in the notifications slice, just with the lookup shared
    across files instead of local to one.
  - **`BlockNode.tsx` needed the most careful splitting of any file this
    session**: its wrapper mixed a genuinely per-node computed `height`
    (from port count) with a run-state border/shadow that's actually a
    *closed set of 4 states* (running/success/failed/cycle) — treating the
    whole multi-property style object as one atomic "stays inline" unit
    would have missed that the run-state part is static. Split into a local
    `RUN_STATE_CLASS` lookup (converts) plus a much smaller inline object
    holding only `height` and, in the default/selected case, the per-category
    `borderColor` (stays, since `CATEGORY_COLOR` values vary per block).
    `@xyflow/react`'s `Handle` component was confirmed (via its exported
    types and compiled source) to forward and merge both `className` and
    `style` independently, so the Handle's static size/shape/background
    converted to `className`, leaving only its per-port computed `top`
    inline — narrower than assumed possible going in.
  - Verified: `pnpm typecheck` (0 errors), `pnpm lint` (0 errors, 376 → 277
    warnings), `pnpm test` (131/131 unchanged, including
    `AnimatedEdge.test.tsx`'s 10 tests which assert on literal `style`
    attribute strings — confirmed they still pass verbatim since that file's
    styles stayed inline), `pnpm build` (entry chunk ~479 KB gzip per
    `check-bundle`'s own measurement, flat/consistent with the trend from
    every prior slice), `pnpm check-bundle` (well under the 550 KB budget).
  - Not independently verified: live rendering of the tile's canvas/editor
    itself. Confirmed via a running dev server that the Scheduler sidebar
    button no-ops without a configured server (same server-scoped-tile guard
    documented in every prior slice) and produces no *new* console errors
    beyond the pre-existing `quick-commands` `window.go`-unavailable ones —
    but the node editor, drag/connect interactions, and run-state glow
    colors need `wails dev` with a real server to see rendered, same
    limitation as backups/mods/worlds/performance previously.
- ✅ **Seventh slice done: the config tile** (`frontend/src/tiles/config/**`,
  the server.properties/config-file editor built on CodeMirror + a
  generated form UI) — the next-largest remaining cluster. Confirmed count:
  80 occurrences across 6 files. This tile converted more cleanly than
  scheduler — **4 of 6 files reach zero remaining inline styles**
  (`ConfigSummary.tsx`, `FileList.tsx`, `form/ConfigForm.tsx`, plus
  `index.tsx`'s resize handle, leaving only its drag-computed sidebar
  width). `EditorPanel.tsx` keeps 1 (CodeMirror's own `style` prop —
  library-API requirement, same treatment as xyflow's `Handle`/`MiniMap` in
  the scheduler slice). `form/widgets.tsx` (39 → 3) keeps the fewest
  exceptions of any large file yet: vendor-prefix spinner suppression
  (`MozAppearance`/`WebkitAppearance`, no Tailwind utility target), the
  `MC_COLORS` swatch buttons' per-swatch `background`/conditional
  `boxShadow` (16 literal colors from a data table), and
  `MotdPreviewLine`'s per-segment rich-text styling (parsed from Minecraft
  MOTD formatting codes, continuously variable). Added
  `src/tiles/config/**/*.tsx` to the ratcheted-`error` `files` glob in
  `frontend/eslint.config.js`; `pnpm lint` passes with 0 errors, global
  warning count 277 → 194.
  - **`#000`/`#000000` confirmed to match Tailwind's `black` keyword class
    exactly** — unlike the mid-tone swatches that broke hex assumptions in
    the scheduler slice (OKLCH-interpolated), `black` is a fixed CSS
    keyword, not part of that interpolated scale. Used throughout
    (`EditorPanel.tsx`'s view-toggle/save-button active text, `widgets.tsx`'s
    `Toggle` on-state knob, `Select`'s active-option text).
  - **Found and flagged a dead CSS variable**: `widgets.tsx`'s `Select`
    dropdown used `background: 'var(--panel-bg, #0e1117)'` — `--panel-bg` is
    never defined anywhere else in the repo (confirmed via a repo-wide
    grep), so it always fell through to the literal `#0e1117` fallback,
    which doesn't match `--bg-base` or `--bg-elevated` or any other token.
    Converted to `bg-[#0e1117]` (preserving the actual rendered color
    exactly, not "fixing" the dead variable — that's a separate cleanup,
    tracked below) rather than inventing a replacement token.
  - **De-duplication beyond the mechanical conversion**: `form/widgets.tsx`
    had the `background: 'var(--hover-surface)', color: 'var(--text-primary)',
    border: '1px solid var(--border-subtle)'` triple repeated near-verbatim
    across `TextInput`, `TextArea`, `Select`'s trigger, and `ChipList`'s
    chips/input — introduced a file-local `FIELD_INPUT_CLASS` constant
    (mirroring how `FORMAT_COLORS` is already file-local rather than
    centralized) reused across all four. `NumberInput`'s `btnStyle` object
    became a similar local `spinnerBtnClass` string. `FORMAT_BUTTONS`' small
    closed lookup table had its optional `style?` field converted to
    `className?` (`'font-bold'`/`'italic'`/`'underline'`/`'line-through'`),
    the same "N-way lookup → className field" pattern used for
    `CATEGORY_TEXT_CLASS` in the scheduler slice.
  - `calc(100% + 4px)` (the `Select` dropdown's position) is a **static**
    literal expression, not runtime-computed — converted to
    `top-[calc(100%+4px)]` rather than staying inline, same precedent as
    the mods slice's `calc(100vw-48px)`.
  - A `style={{}}` ternary of the odd form
    `style={selected ? undefined : { color: ... }}` (`FileList.tsx`'s
    `FileRow`) folded into the existing conditional-className template
    literal rather than needing special-case handling.
  - Verified: `pnpm typecheck` (0 errors), `pnpm lint` (0 errors, 277 → 194
    warnings), `pnpm test` (131/131 unchanged — no existing tests target
    `tiles/config/**`), `pnpm build` (entry chunk ~479 KB gzip, flat vs. the
    prior slice), `pnpm check-bundle` (479.0 KB, well under the 550 KB
    budget).
  - Not independently verified: live rendering of the file browser/editor
    with real data. Both `ConfigSummary.tsx` (non-maximized view) and
    `FileList.tsx`/`EditorPanel.tsx` (maximized, via `useConfigEditor`) call
    real Wails bindings unconditionally on mount, so neither renders past
    that point without a configured server — confirmed live via a running
    dev server: clicking the sidebar's Config tile produced no *new*
    console errors beyond the pre-existing `quick-commands` one. A full
    visual pass (editing a real `server.properties`, the MOTD builder, the
    toggle/select/chip widgets with live data) needs `wails dev` with a
    configured server, same limitation as every prior slice.
- ✅ **Eighth slice done: `frontend/src/components/` (non-`ui/`)** — the
  largest remaining cluster (confirmed count: 64 occurrences across 8 files).
  Uniquely, this is the first slice fully live-verifiable in the headless
  preview: the app-shell modals render on pure client state, no Wails bridge
  needed (unlike every prior server-scoped tile slice). **5 of 8 files reach
  zero remaining inline styles**: `LayoutPresets.tsx`, `EulaModal.tsx`,
  `ServerSelector.tsx`, `TileCrate.tsx`, `ErrorBoundary.tsx`.
  `SettingsModal.tsx` (35 → 3) keeps `ColorField`'s live-hex swatch background/
  outline and `SkinCard`'s per-`previewColors`-entry background — genuine
  runtime colors, not tokens. `Dashboard.tsx` (3 → 3, same count but now all
  documented) keeps the drag-placeholder/wireframe `...dragVisual` position
  spreads (react-grid-layout computed geometry, CLAUDE.md's sanctioned
  exception) and the canvas dot-grid's `backgroundSize`/`backgroundPosition`
  (tracks live `colStep`/`rowStep`, canvas-width-dependent).
  `ActiveProcesses.tsx` (5 → 1) keeps only the live percent-width progress
  bar fill. Added `src/components/*.tsx` (single star — top-level only, since
  `ui/**` was already in the glob) to the ratcheted-`error` `files` glob in
  `frontend/eslint.config.js`; `pnpm lint` passes with 0 errors, global
  warning count 194 → 130.
  - Same "static two-value ternary → conditional `className`" rule applied
    throughout (nav active/inactive color+background in `SettingsModal`,
    preset active/inactive in `LayoutPresets`, `onCanvas` color+background in
    `TileCrate`). One extension confirmed this pass: **a static
    `maxHeight`/`rotate()` ternary is "two fixed values" too** (matching the
    scheduler slice's `rotate(180deg)`/`rotate(0deg)` precedent) —
    `LayoutPresets`' collapse-chevron `rotate(-90deg)`/`rotate(0deg)` and its
    accordion wrapper's `maxHeight: '0px'`/`'2000px'` both converted cleanly
    to `-rotate-90`/`rotate-0` and `max-h-0`/`max-h-[2000px]`.
  - **Tailwind v4 renders `rotate`/`scale`/`translate` via native standalone
    CSS properties, not the legacy `transform` shorthand** — confirmed live:
    `getComputedStyle(el).transform` reads `"none"` even when `-rotate-90` is
    applied and visibly rotates the element; the utility's effect only shows
    up under `getComputedStyle(el).rotate` (`"-90deg"`). Worth remembering for
    any future computed-style verification of rotate/scale/translate
    utilities — checking `.transform` alone gives a false negative.
  - **A stacked `outline` + `outline-[1.5px]` + `outline-offset-2` utility
    combo silently rendered `outline-width: 1px` instead of `1.5px`**
    (verified live via computed style) — the bare `outline` utility's own
    width declaration won the cascade over the arbitrary-width utility.
    Fixed by switching to a single arbitrary-property class,
    `[outline:1.5px_solid_var(--border-hover)] [outline-offset:2px]`, which
    verified correctly afterwards. Lesson for future conversions: don't split
    an `outline` shorthand across `outline`/`outline-[width]`/`outline-{color}`
    utility classes — collapse it into one arbitrary-property declaration.
  - `rgb(var(--accent-rgb) / 0.1)`-style tokens confirmed to convert to
    Tailwind's opacity-modifier syntax exactly (`bg-accent/10`, `/8`, `/6`,
    per the exact percentage) since `--color-accent` is a real registered
    color in `@theme inline` — same technique already used elsewhere in the
    codebase (`ServerSelector.tsx`'s pre-existing `bg-accent/10`), now
    extended to every remaining `--accent-rgb` site in this cluster.
  - Verified: `pnpm typecheck` (0 errors), `pnpm lint` (0 errors, 194 → 130
    warnings), `pnpm test` (131/131 unchanged — no existing tests target
    `components/*`), `pnpm build` (entry chunk 478.7 KB gzip, flat vs. the
    prior slice), `pnpm check-bundle` (478.7 KB, well under the 550 KB
    budget).
  - **Live-verified in-browser** (first slice able to do this beyond
    typecheck/lint/test): started `pnpm dev` directly via `pnpm --dir frontend
    exec vite --port <port> --strictPort` (`.claude/launch.json`'s prior
    `pnpm run dev` + auto-port form silently forwarded a literal `"--"` token
    to Vite instead of stripping it as pnpm's arg separator, and separately
    the auto-assigned proxy port didn't match the port Vite actually bound —
    fixed by calling `vite` directly via `pnpm exec` with an explicit
    `--strictPort`). Opened Settings (gear icon): confirmed the modal's
    `640×480` size, `bg-canvas` background (`rgb(5, 6, 10)` = `--bg-base`),
    and `shadow-[0_24px_64px_rgba(0,0,0,0.5)]` via computed style; confirmed
    the active nav item's `text-accent`/`bg-accent/10` (`rgb(74, 222, 128)`,
    exact accent green) versus inactive items' `text-text-secondary`
    (`rgba(255, 255, 255, 0.6)`); confirmed the accent-color swatch's
    `background-color` reflects the live `settings.accentColor` value with a
    correctly-colored static outline. Confirmed a mounted tile's geometry is
    non-zero (`Console` tile: 664px height) per the `TileWrapper` slice's
    0-height-regression lesson. No new console errors beyond the pre-existing
    `quick-commands` `window.go`-unavailable ones (React 19 dev-mode
    double-invokes effects, which doubles each log line — a tooling
    artifact, not a regression). `EulaModal`/`LayoutPresets` are also
    client-renderable but not independently screenshotted this pass (the
    screenshot tool itself timed out repeatedly in this environment;
    `preview_inspect`/computed-style checks were used instead, per the
    verification skill's own guidance to prefer them for style checks).
- ✅ **Ninth slice done: the players tile** — all 32 occurrences across its
  four components, reaching **zero** remaining inline styles with no
  `eslint-disable` exceptions (nothing in the tile was genuinely computed).
  `src/tiles/players/**/*.tsx` added to the ratcheted-`error` `files` glob in
  `frontend/eslint.config.js`; `pnpm lint` passes with 0 errors. Global count
  144 → 112, warnings 129 → 97 (exactly the 32 removed).
  - The literal colours turned out to be tokens: `#4ade80` is exactly `--accent`
    (`rgb(74 222 128)`) and `rgba(248,113,113,·)` is `--danger`, so the online
    dots and the ban button now follow the theme instead of pinning dark-theme
    values. `rgba(250,204,21,·)` is Tailwind's own `yellow-400`.
  - **Refinement of the TileWrapper precedent on imperative hover handlers.**
    That slice deliberately left `onMouseEnter`/`onMouseLeave` pairs alone —
    they aren't the JSX `style` attribute the lint rule targets. Here the four
    pairs in `PlayerDetailPopup.tsx` wrote *the very colours being converted*,
    so leaving them would have left an inline style overriding the new
    `className` from the first hover onward — the class would be dead code
    that still looked right. Converted 1:1 to `hover:` utilities (same
    properties, same values, same trigger). The distinction worth carrying
    forward: leave imperative handlers when they touch properties nothing else
    sets; convert them when they collide with the className you're introducing.
  - The popup panel carried both `w-88` and an inline `width: '22rem'` — the
    same value stated twice. Dropped the inline one; measured 352px after.
  - **First server-scoped slice fully verifiable without `wails dev`**, because
    the preceding commit lifted data fetching into the tile root: `PlayerCard`/
    `PlayerGrid`/`PlayerRoster` became props-driven and render from a plain Vite
    dev server. Verified every utility against the value it replaced via
    computed styles in Chromium — `bg-accent` → `rgb(74, 222, 128)`,
    `bg-text-faint` → `rgba(255,255,255,0.25)`, `bg-elevated` →
    `rgba(18,20,30,0.82)`, `border-border-subtle` → `rgba(255,255,255,0.06)`,
    `bg-canvas` → `rgb(5,6,10)`, the shadow byte-identical — plus non-zero
    card (73.4×70) and row (1280×45) geometry per the TileWrapper 0-height
    lesson.
  - **Sub-pixel borders: verified equivalent, not assumed.** `border-[0.5px]`
    and `border-[1.5px]` both report `1px` from `getComputedStyle`, which looks
    like a regression against the old `0.5px`/`1.5px` inline values. An A/B in
    the same page (inline vs utility, same declared width) returns `1px` for
    both — it's Chrome's used-value rounding, identical before and after.
    Worth remembering before "fixing" a hairline that was never broken.
- ✅ **Tenth slice done: the worlds tile** (`frontend/src/tiles/worlds/**`) —
  `WorldHud.tsx` 51 → 0, `index.tsx` 15 → 0, `scene/WorldsScene.tsx` 8 → 1,
  `scene/Planet.tsx` 4 → 2, with `src/tiles/worlds/**/*.tsx` added to the
  ratcheted-`error` glob. **Every tile directory is now migrated.**
  - **This tile was booked at 44 and was really 78.** The 44 came from a
    `grep 'style={{'`, which cannot see the `style={SOME_CONST}` form — and
    `WorldHud.tsx` was built almost entirely from it (`CARD`, `ROW`, `LABEL`,
    and a `BTN(danger)` factory returning `React.CSSProperties`, applied 32
    times). ESLint's own `no-restricted-syntax` count is the honest number.
    **Count with `pnpm exec eslint src`, not grep.**
  - The `React.CSSProperties`-constant idiom converts cleanly to class strings
    (`const ROW = 'flex justify-between gap-2 py-0.5'`) with one trap: a factory
    that varied padding per call cannot be expressed by appending a second
    padding utility. `{...BTN(), padding: '1px 5px'}` relied on object-spread
    order; `${BTN()} px-[5px]` does not, because class-attribute order has no
    bearing on which of `px-[7px]`/`px-[5px]` wins the cascade. Split into a
    padding-less `BTN_BASE` plus explicit `BTN`/`BTN_CLOSE` variants.
  - **Colour rule applied both ways.** `#22c55e` *is* `--success`'s dark value,
    so it became `text-success`/`bg-success` — no change in the default theme,
    and it now follows the light theme's darker green instead of staying too
    pale. `#ef4444` is **not** `--danger`'s dark value (`#f87171`), so it stayed
    a literal `text-[#ef4444]`, matching every prior slice. Take the token when
    it is an exact match in the default theme; keep the literal when it is not,
    rather than quietly restyling inside a mechanical pass.
  - **Two third-party components write their own inline styles, and one of them
    wins.** r3f's `<Canvas>` renders its container with
    `style={{position:'relative', width, height, overflow, ...yourStyle}}`, so a
    `className` can never beat that inline `position` — the Canvas keeps its
    inline `style` behind a documented disable. drei's `<Html>` (non-`transform`
    mode) merges only `position`/`transform` and passes `className` straight
    through, so its `pointerEvents`/`userSelect` *did* convert. Check the
    library's render call before assuming either way.
  - `Planet.tsx`'s two label spans keep `style={{ color }}` (a per-world /
    per-dimension runtime colour) and nothing else. Their `opacity: 0` became
    `opacity-0`: it is only the first-frame value, since `useFrame` writes
    `labelSpanRef.style.opacity` every frame and inline still beats a class.
  - **Tailwind v4's `transition-transform` covers `translate`, not just
    `transform`** — verified live, `transitionProperty` computes to
    `"transform, translate, scale, rotate"`. This matters because
    `-translate-x-full` sets the standalone `translate` property (the same v4
    behaviour the eighth slice found for `-rotate-90`). Had the utility covered
    only `transform`, the HUD panel's slide-in would have become an instant jump
    with every test still green.
  - `font-mono` replaced `fontFamily: 'monospace'`, which **is** a visible
    change: this tile now renders in the app's registered stack like the other
    246 `font-mono` usages instead of the host's generic default. Deliberate —
    the inline value was the outlier.
  - First use of the `border-hairline` utility, which had existed since the token
    layer landed with **zero** callers (all 146 hairline borders are spelled as
    arbitrary values). Both compute identically — Chrome reports `1px` either
    way, since it rounds border widths to whole device pixels — so this is a
    readability change, not a rendering one.
  - **Not live-verifiable in the browser**, unlike the players slice: the tile
    only mounts when `GetActiveTiles` returns it, and that is a Wails IPC call.
    What *was* verified against the dev server instead: all 46 utility classes
    the converted markup relies on exist in the compiled stylesheet (a class
    Tailwind never generated would silently drop the style), and each computes to
    its inline predecessor's value — `text-1xs/2xs/3xs` → 11/10/9px,
    `text-text-faint` → `rgba(255,255,255,0.25)`, `w-1/3` → 33.33%,
    `duration-[250ms]` + `ease-[cubic-bezier(0.25,0,0.25,1)]` → exactly the old
    shorthand's timing.
  - Verified: `pnpm typecheck` (0 errors), `pnpm lint` (0 errors), `pnpm test`,
    `pnpm build` + `pnpm check-bundle` (well under budget), `prettier --check`
    clean on every file touched.
- 71 `style={{}}` remain across the tree, but only **6 are backlog** — all in
  `App.tsx`. The other 65 live in directories ratcheted to `error`, so each is a
  lint-enforced documented exception rather than unmigrated code.

### P1 — Modrinth client: HTTP paths are testable, and now tested
- ✅ **`ModrinthClient.baseURL` is injectable**, the same shape `UpdateService`
  has had all along. The production change is three lines — a field, a
  constructor assignment, `c.baseURL + path` in `doJSON` — and it is what the
  checklist's "needs an injectable base URL" item was waiting on. `update.go`'s
  doc comment used to cite `modrinth.go`'s hardcoded base as the counter-example;
  that sentence was true when written and is not now, so it was rewritten rather
  than left as a trap for the next reader.
- ✅ **`modrinth_test.go` goes from 7 tests to 28**, and `modrinth.go` from 2 of
  17 functions covered to **15 of 17** — the two left return a struct literal and
  a constant. `backend/services` coverage is now 29.7% of statements.
- What the tests pin down, beyond the two paths the backlog named:
  - **429 handling.** `Retry-After: 0` keeps them instant. Three separate facts:
    a 429 followed by a 200 succeeds; three consecutive 429s produce "exceeded
    retry limit"; and **`maxRetries` is a total attempt count, not
    retries-after-the-first** — the counter says 3, not 4. That is the kind of
    off-by-one a rewrite silently flips.
  - **The backoff respects context cancellation.** With no `Retry-After` the
    client waits its 2s default; the test cancels after 50ms and asserts a
    cancelled-context error in well under 2s. It deliberately does *not* time the
    2s default — asserting a wall-clock sleep buys a flaky test and nothing else.
  - **Search dedup** collapses a repeated `project_id`, keeps the *first*
    occurrence, and passes `total_hits`/`offset` through untouched.
  - **`GetProject`'s author resolution**: Owner role wins over an earlier
    Contributor; with no Owner the first member is the fallback; and a failing
    `/members` lookup leaves the project intact with an empty author rather than
    failing the call.
  - **`ResolveDependencies`**, the largest untested block in the file and only
    reachable over HTTP: `incompatible`/`embedded` skipped, `optional` returned
    with `Required: false`, the `installed` map setting `AlreadyInstalled`,
    transitive required deps followed breadth-first without re-resolving through
    a cycle, and an empty filtered version query falling back to the unfiltered
    one before giving up.
  - **Which file a version resolves to** — `primary: true` beats file order, and
    the first file is the fallback when nothing is marked primary. This decides
    the download URL and the sha512 that gets verified.
- **The tests were checked against broken code, not just passing code.**
  Disabling the 429 branch failed 3 tests; disabling the dedup check failed 1;
  dropping the `incompatible`/`embedded` skip failed 1. Each was restored and
  re-run green. A suite written after the fact proves nothing until it has been
  shown to fail.
- A small helper, `writeString(t, w, body)`, wraps the `w.Write` in every fake
  handler. CLAUDE.md's "no blank `_` error-ignores" rule does not stop at
  non-test code, and 30-odd unchecked `w.Write` calls would have been the largest
  cluster of them in the repo.

### P2 — React Compiler-readiness lint rules
- Revisit enabling `eslint-plugin-react-hooks`'s full `recommended`/
  `recommended-latest` rule set (`purity`, `refs`, `set-state-in-effect`,
  `immutability`, etc.) — currently scoped down to classic `rules-of-hooks` +
  `exhaustive-deps` only (see Lint/format enforcement above). The ~60 findings
  it currently surfaces are concentrated in the r3f scene code and would need
  a dedicated pass with test coverage in place first.

**P2 — Missing `--font-mono` theme token** ✅ **closed — overtaken by the
token rework**
- Closed on review 2026-08-15, resolved differently than the entry below
  planned. The token layer was rebuilt in the meantime (`frontend/src/styles/
  tokens.css`, generated from the vendored `tokens.source.json`), and it
  registers `--font-mono` as a deliberate **system** monospace stack
  (`ui-monospace, 'Cascadia Code', 'SF Mono', …`). `JetBrains` no longer
  appears anywhere under `frontend/src/`, and the console tile's four inline
  `fontFamily` exceptions are gone with it — that directory is at zero inline
  styles.
- So the gap this entry described no longer exists: bare `font-mono` now
  resolves through a registered token rather than falling through to Tailwind's
  default. Bundling JetBrains Mono as a webfont is now a **design** decision
  owned upstream in `kollektiv/design/tokens.json`, not a Konnekt health gap —
  if it's ever wanted, it changes there and arrives via `pnpm gen:tokens`.
- Original entry, kept for context:
- Found during the Milestone 2 third slice: `frontend/src/style.css`'s
  `@theme inline` block registers color tokens but has no `--font-mono`
  override, so the bare `font-mono` Tailwind utility (already used in several
  places across the codebase) resolves to Tailwind's *default* monospace
  stack, not the app's actual font (JetBrains Mono, per `CLAUDE.md`).
  Registering `--font-mono: 'JetBrains Mono', 'Fira Code', monospace;` (the
  exact stack already used in `style.css`'s `.mod-body code` rule) would let
  `console.tsx`'s 4 documented inline-style exceptions, and any similar sites
  found in future migration passes, convert to a plain `font-mono` class.
  Deliberately not fixed as part of the Milestone 2 pass — every *existing*
  bare `font-mono` usage project-wide needs auditing first, since some may
  currently be relying on Tailwind's default stack rather than an inline
  override masking the gap; flipping the token blind would be a wide,
  unverified visual change across the whole codebase.
- Follow-up finding (repo-hygiene pass): the audit turned up 246 `font-mono`
  usages across 39 files, all currently resolving to Tailwind's *default*
  monospace stack. More importantly, `frontend/src/style.css` has no
  `@font-face` for JetBrains Mono at all — the only bundled font is Satoshi
  (used for `sans`, not `mono`). So today's bare `font-mono` and a would-be
  `--font-mono: 'JetBrains Mono', ...` token both fall through to whatever
  monospace the OS provides; registering the token wouldn't visibly change
  anything until JetBrains Mono is actually bundled as a webfont. Still
  deferred — now blocked on "bundle the font" as a prerequisite, not just
  "audit existing usages."

### P1 — Test coverage + gate
- ✅ Stood up the frontend test harness: `vitest` (pinned to `^3` — `vitest@4`
  requires Vite 6+, this repo is still on `vite@^5.4.21`) + `jsdom` +
  `@testing-library/react`/`dom`, wired via a `test` block in
  `frontend/vite.config.ts` and a `pnpm test` script. Added to the CI
  `frontend` job (`.github/workflows/ci.yml`), after `pnpm lint`.
  Confirmed green on `main`:
  https://github.com/sandrogekeler/Konnekt/actions/runs/28620873038
- ✅ Frontend: 39 tests covering the pure/no-Wails-mocking logic —
  `lib/format.ts`, `lib/layout.ts` (`collapseEmptyRows`), and three stores'
  pure logic: `useConsoleStore` (`classifyLine` + buffer-cap eviction on
  `appendLine`/`batchAppend`), `useNotificationsStore` (200-item cap),
  `useProcessesStore` (state machine + the 3s auto-remove timer via
  `vi.useFakeTimers`).
- ✅ Backend: 21 new tests (up from 2 pre-existing) —
  `rcon_test.go` (packet marshal/unmarshal round-trip over `net.Pipe`, the
  10–4096 byte length-bounds guard, colour-code stripping),
  `backup_test.go` (`validateFilename`, zip create/restore round-trip, and
  the zip-slip extraction guard — confirmed this test actually fails when the
  guard is removed, then restored it),
  `config_editor_test.go` (the path-traversal `sandbox()` guard),
  `modrinth_test.go` (`buildFacets` facet-string assembly).
- ✅ **Scheduler backend engine — closed the critical gap.** A dedicated
  4-pillar audit of the scheduler (see the new backlog entry below) found the
  ~3,100-line execution engine essentially untested — only `scheduler_expr.go`
  and `scheduler_validate.go` had test files; `runGraph`/`executeNode`,
  triggers, cron/interval matching, next-run calc, and all block executors had
  zero coverage. Added:
  `scheduler_engine_test.go` (`runGraph` integration: control-flow ordering,
  data-flow through pure-data pull-eval + the data-over-config overlay,
  `onFailed` branching, the data-type-validation short-circuit, the
  control-cycle/`maxNodesPerRun` guard, the concurrency guard; plus direct
  `ExecContext` getter tests and `execConstant`/`execMathOp`/`execCondition`/
  `execDelay`/`execRandomNumber` executor tests — including pinning down two
  existing behaviors as tests, not fixes: `GetFloat` silently falls back to
  its default on an unparseable string, and `execCondition`'s `gt`/`lt` are
  lexicographic string comparisons, not numeric),
  `scheduler_triggers_test.go` (`cronMatches` field types incl. `*/n` steps/
  ranges/lists, `cooldownAllows`), `scheduler_nextrun_test.go` (`nextTimeOfDay`,
  `nextCron`, `nextInterval`, `findTriggerNode`). One production change: a
  nil-guard in `activeServerID()` so the engine is constructable without a
  full `ConfigService`, enabling headless tests (`EventBus.Emit` was already
  nil-context-safe). Verified the data-type-validation guard test actually
  fails when that guard is disabled, then restored it — same technique as the
  zip-slip test above.
- ✅ **Wails-mocked store tests — harness established, 4 stores + `useScheduler`
  covered.** Added the first `vi.mock('../../wailsjs/go/main/App')` pattern in
  the repo (a plain hoisted auto-mock — no `vite.config.ts` or setup-file
  changes needed): `useSettingsStore.test.ts` (7 tests — payload merge,
  invalid-value fallback per validated field, load-rejects-to-defaults),
  `useTileStore.test.ts` (6 — saved/empty/rejecting `loadTiles`, dedup on
  `addTile`, active↔crate moves), `useLayoutStore.test.ts` (13 — preset
  seeding, active-layout override, insert-vs-update `savePreset`, delete
  reassignment), `useServerConfigStore.test.ts` (13 — stale/missing-activeId
  fallback, insert-vs-update, delete reassignment), and
  `frontend/src/tiles/scheduler/useScheduler.test.ts` (4, via `renderHook` +
  `vi.useFakeTimers` — mount fetch, save/run refresh, the 30s next-run poll and
  its unmount cleanup), closing the second (frontend hook) half of the
  scheduler test-coverage backlog alongside the earlier `graphMapping.ts` pass.
  Frontend test count: 88 → 131.
  - **One real bug found and fixed, not just documented**: `useLayoutStore.ts`'s
    `deletePreset` computed the reassigned `activePresetName` from
    `s.presets[0]` — the *pre-filter* array — so deleting the active preset
    reassigned back to that same now-deleted name whenever it happened to be
    first in the list (the common case, since "Default" is always seeded
    first). `LayoutPresets.tsx` highlights the active preset by exact name
    match, so this silently left **no** preset shown as active after such a
    delete, and its save-fallback (`newName.trim() || activePresetName`) would
    have resurrected the deleted preset's name on the next save. Fixed by
    reading the *filtered* list's first entry instead — same
    write-test-first/find-real-bug technique as the earlier `RenameWorld` and
    zip-slip fixes. Verified the fix by first watching the un-fixed test fail,
    then confirming green after the source fix (plus a second, unrelated
    fault-injection check: temporarily dropped `useTileStore.addTile`'s dedup
    guard and confirmed its test fails, then restored it).
  - Still untested: the two custom hooks (`useWailsCall`, `usePopover`), and
    the binding-backed tile hooks (`useMods`, `useBackups`, `useWorlds`,
    `usePerformanceHistory`) — the harness above is now a documented,
    copy-pasteable pattern for covering them.
- Deferred follow-up — **Modrinth HTTP-path coverage**: `ModrinthClient`
  hardcodes `modrinthBase = "https://api.modrinth.com/v2"` with no injectable
  base URL, so the 429/`Retry-After` retry logic and search-hit dedup can't be
  driven by an `httptest.Server` yet. Needs a small constructor refactor
  (injectable base URL) before those paths are testable.
- Deferred follow-up — **coverage floor**: still no numeric threshold in CI;
  add one once a stable baseline is established across both suites.

### P1 — Code-split heavy tiles
- ✅ **Correction to this item's original premise**: exploration found the
  backups tile has no three.js dependency at all — its "planets" are pure
  SVG/CSS (`frontend/src/tiles/backups/WireframeSphere.tsx`,
  `SolarSystem.tsx`). three.js/@react-three only appear under
  `frontend/src/tiles/worlds/scene/`, already lazy-loaded. So recharts (only
  in the performance tile) was the sole remaining eager heavy dependency.
- ✅ Split recharts out of `frontend/src/tiles/performance/index.tsx` into a
  new `charts.tsx` (the tile's only `recharts` import), lazy-loaded via
  `React.lazy` + `Suspense` for both the compact `SparkChart` and the
  expanded `HistoryChart` — same pattern as Worlds. Shared pure helpers
  (`fmtTime`, `fmtTps`, `tpsColor`, `tpsStrokeColor`) moved to `helpers.ts` to
  avoid duplication between `index.tsx` and `charts.tsx`.
  Effect: entry chunk gzip dropped from 595.00 KB → 490.53 KB (Vite's own
  report); recharts now ships as its own ~103 KB gzip chunk, fetched only
  once real chart data exists (confirmed in a dev-mode network trace — the
  `charts.tsx` module is never requested while the history buffer is empty).
- ✅ Added `frontend/scripts/check-bundle-size.mjs` (no new dependency — uses
  `node:zlib`): gzips each `dist/assets/*.js`, asserts the entry
  (`index-*.js`) chunk stays under a 550 KB budget, prints a per-chunk table.
  Wired in as `pnpm check-bundle`, run in the CI `frontend` job right after
  `pnpm build`. Verified the gate actually fails when the budget is
  temporarily set below the real size, then restored it. Confirmed green on
  `main`: https://github.com/sandrogekeler/Konnekt/actions/runs/28622676087
- Not independently verified: live chart rendering with real streaming data
  in a browser. The Wails IPC bridge (`window.go`/`window.runtime`) only
  exists inside the native `wails dev` process — unreachable from the
  headless-Chrome preview tooling used for this pass, which can only run the
  bare Vite dev server (no backend). Confirmed the code-split mechanism
  itself is sound (chunk separation, on-demand fetch, all typecheck/lint/test
  gates green); a full data-driven visual check needs `wails dev` with a
  configured Minecraft server.
- Unused dependency found during this pass, tracked separately: see
  "P2 — Repo hygiene" below (`uplot` / `skinview3d`).

### P2 — Undocumented blank error-ignores
- ✅ Resolved. All 28 blank `_ = ` / `_, _ = ` sites across
  `backend/services/{backup,config_editor,players,modservice,scheduler_blocks,
  scheduler_engine,server,server_windows,server_other}.go` now carry a
  `//nolint:errcheck // <reason>` comment (no `golangci-lint` config exists in
  this repo — `//nolint` is a human-readable documentation convention here,
  not machine-enforced). 27 were genuinely safe best-effort/fire-and-forget
  code (rollback cleanup, progress-estimate walks, best-effort manifest/meta
  persistence, RCON save-flush during backup, OS-handle-close/process-kill
  teardown) — verified individually by reading each call site in context, not
  assumed.
  - One real bug found and fixed, not just documented: `worlds.go`'s
    `RenameWorld` renamed a world's folder on disk, then discarded the error
    from writing the new name into `server.properties`'s `level-name`. A
    failed write there would have left `RenameWorld` returning success while
    the server's config pointed at a folder that no longer existed — the
    server would fail to find its world on next start. Now propagates the
    error (`fmt.Errorf("world folder renamed but level-name update failed: %w", err)`),
    a safe, backward-compatible fix since the function already returns
    `error` and no caller needed to change.
  - Verification: `gofmt -l .` clean, `go vet ./...` + `go test ./... -count=1`
    + `go build ./...` green, and the audit grep
    (`grep -rn "_ = \|_, _ = " backend --include="*.go" | grep -v "_test.go" | grep -v "nolint"`)
    returns nothing. Confirmed green on `main`:
    https://github.com/sandrogekeler/Konnekt/actions/runs/28629364439

### P2 — Structured logging
- Replace ad-hoc `fmt.Errorf`-only error reporting on the backend with
  `log/slog` for diagnosable runtime logs, keeping the existing `EventBus`
  emissions for UI-facing notifications.

### P2 — Repo hygiene
- ✅ `*.syso` added to `.gitignore` (`konnekt-res.syso` was untracked and
  uncovered).
- ✅ Created `agent_docs/DEPENDENCIES.md` — policy + rationale table for every
  direct Go and npm dependency, referenced from `CLAUDE.md`.
- ✅ Triaged the root-level `scheduler-blocks-rework.md` design doc: promoted
  to `agent_docs/scheduler-blocks-rework.md` rather than deleted — it's the
  spec base for the scheduler's block/node system (triggers, attributes,
  math, data-type→color legend, which stays fixed) and remains useful input
  for the node-system rework tracked below.
- ✅ Removed the unused `uplot` npm dependency (confirmed unimported anywhere
  under `frontend/src/` — the performance tile's charts use `recharts`
  exclusively).
- ✅ **Reversal:** `skinview3d` — previously kept intentionally as reserved
  for the not-yet-built Beta "player skin preview" tile — has since been
  **removed**. It pinned its own `@types/three@0.156.0`/`three@0.156.1`, a
  second copy alongside the app's `0.184.x` line that caused an
  install-layout-dependent type mismatch in the Worlds tile's R3F camera
  code (see "P1 — CI blind spot" above for the full incident). Re-add,
  pinned to `0.184.x`, when the skin-preview tile is actually built —
  tracked in `agent_docs/DEPENDENCIES.md`'s "Removed" section.
- ✅ Deleted the stale root-level `Roadmap.md` — a status log fully superseded
  by `agent_docs/ROADMAP.md` (which it already deferred to for feature scope)
  and out of date (e.g. still listed "Split the JS bundle" as planned
  Infrastructure work, done in the code-split pass above). Root now has no
  `.md` files besides `README.md`.
- Found during the config-tile Milestone 2 pass, not yet fixed:
  `frontend/src/tiles/config/form/widgets.tsx`'s `Select` component
  references `var(--panel-bg, #0e1117)` — `--panel-bg` is never defined
  anywhere else in the codebase, so it always falls through to the literal
  `#0e1117` fallback (which matches neither `--bg-base` nor `--bg-elevated`
  nor any other token). Either register a real `--panel-bg` token in
  `style.css` or replace the reference with an existing token
  (`--bg-elevated` looks like the closest semantic match) — deferred as out
  of scope for a pure style-migration pass.

### P1 — Scheduler node-system deep analysis
- ✅ **Architecture confirmed sound.** Three parallel Explore agents mapped the
  xyflow editor, the Go engine, and the contract between them: it's a hybrid
  control-flow + data-flow graph interpreter — xyflow is a pure visual editor
  serializing losslessly to a shared `models.Graph`; the real node engine
  (BFS control-flow execution, lazy pull-eval of pure-data nodes, an
  attribute scope with expression parsing) lives in Go, as it must (blocks
  spawn Java, send RCON, write backups — CLAUDE.md: "Go owns all side
  effects"). Keeping xyflow over switching to `rete` was the right call —
  rete's value-add is its own JS-side execution engine, which this app can't
  use. The control-pin/data-pin split mirrors Unreal Blueprints and Blender's
  node graph — the right base structure.
- ✅ **Data-type flow enforcement shipped** (the one real gap found: ports
  declared a type but nothing checked it). New `frontend/.../portTypes.ts` +
  `backend/services/scheduler_validate.go` share a type-resolution model,
  enforced at authoring time (`isValidConnection` rejects incompatible drags)
  and run time (`runGraph` fails loudly instead of silently coercing). Also
  fixed `data.constant`'s output port (was hardcoded `"string"`, is now
  `"auto"`).
- ✅ **Connection-handle UX fixed**: the visible port dot was also the entire
  grab/drop hit area (too small); the `Handle`'s own box (xyflow's real hit
  area) is now an 18px zone with a small decorative dot inside it, plus a
  node-background/border-contrast fix.
- ✅ **Full 4-pillar Health Checklist audit performed** (3 parallel Explore
  agents + hand-verification of every load-bearing claim):
  - **Performant: PASS.** `BlockNode` is `React.memo`; context value +
    `defMap`/cycle-detection sets all `useMemo`'d; static `nodeTypes`/
    `edgeTypes`; 200-cap history ring; deliberate cadences (30s frontend
    countdown, 1-min backend ticker); 500-node/30-min/60s-per-node guards.
  - **Clean: was a GAP, now ✅ closed.** At the time of this audit, 89 inline
    `style={{}}` sat across 8 scheduler files, not yet in the ESLint
    error-ratchet glob. Resolved in the Milestone 2 sixth slice (see that
    section above) — recounted at 99 real occurrences, converted to 0-10
    documented exceptions per file, glob added, `pnpm lint` 0 errors.
  - **Scalable: 1 GAP remaining.** No `useSchedulerStore` — state lives in
    local `useState` inside `useScheduler.ts`, contradicting CLAUDE.md's
    one-Zustand-store-per-domain rule (confirmed drift, not just suspected).
    The other Scalable gap this audit found — `localStorage` used directly in
    `frontend/src/tiles/scheduler/editor/BlockPalette.tsx` for palette
    collapsed/closed state, a direct violation of CLAUDE.md's explicit "no
    `localStorage`/`sessionStorage`; persist via Go file I/O" rule — is now
    ✅ **fixed**: migrated onto `AppSettings.schedulerPaletteCollapsed` /
    `.schedulerPaletteClosedCategories`, persisted through the existing
    `GetAppSettings`/`SaveAppSettings` binding (no new Go methods, bindings
    regenerated via `wails generate module`). Verified live with a
    mocked-Wails-bridge preview: toggling the palette collapse and a category
    group calls `SaveAppSettings` with the new fields, and `localStorage`
    stays at 0 keys throughout.
  - **Stable: critical gap, now closed for the backend engine** (this
    session's main remediation — see the P1 test-coverage entry above for
    what shipped). Two smaller Stable gaps remain, not yet fixed: the 30s
    next-run poll in `useScheduler.ts` should be a Wails event instead
    (CLAUDE.md's no-`useEffect`-polling rule), and `useScheduler` swallows
    IPC failures silently (no offline/error state surfaced to the UI).
- ✅ **`graphMapping.ts` frontend test coverage added**: 26 tests in the new
  `frontend/src/tiles/scheduler/editor/graphMapping.test.ts` covering
  `graphToFlow`/`flowToGraph` (including a dedicated round-trip test),
  `isValidConnection`, `detectControlCycles`, `randId`, and `defaultConfig` —
  all pure logic, no Wails binding mocks needed, following the same
  `as unknown as models.X` stub convention as the sibling `portTypes.test.ts`.
  Verified the round-trip and cycle-detection tests actually fail when their
  underlying guards are disabled (the `data:`-prefix kind inference in
  `flowToGraph`, and the `reachableFrom` reachability check in
  `detectControlCycles`), then restored both — same technique as the backend
  zip-slip/data-type-validation tests. `pnpm test` (88 tests), `pnpm typecheck`,
  and `pnpm lint` all green.
- **Remaining scheduler backlog** (deferred, not fixed this session):
  the `useSchedulerStore` Zustand migration; the next-run poll → event
  switch; offline-error surfacing in `useScheduler`. (The `localStorage` →
  Go-file-I/O migration, `useScheduler`-hook test coverage, and the
  scheduler's inline-style Milestone-2 slice, all listed here previously,
  have since been completed.) **All three of those remaining items are now
  closed too — see "P1 — Scheduler tile convention gaps" below.**

### P1 — Scheduler tile convention gaps ✅ closed

All three sub-items lived in the same 95-line file
(`frontend/src/tiles/scheduler/useScheduler.ts`), so they were closed in one
pass rather than rewriting it three times.

- ✅ **`useSchedulerStore` shipped** (`frontend/src/stores/useSchedulerStore.ts`).
  The five local `useState`s moved into a plain `create<T>((set, get) => …)`
  store with no middleware, matching the other nine stores. `useScheduler.ts`
  survives as a ~65-line lifecycle wrapper (mount hydration + the event
  subscription) rather than being deleted: no store in this repo imports React
  or the Wails runtime, and putting `EventsOn` in the store would have needed
  module-level refcounting to unsubscribe. `index.tsx` and the
  tile-self-contained rule are undisturbed.
  - **Incidental bug fixed:** `Dashboard.tsx` renders the maximized tile *in
    addition to* the grid copy, so `useScheduler()` was running twice with two
    private copies of state — the minimized summary went stale while you edited
    in the maximized editor, and there were two 30s intervals. Sharing one store
    fixes that for free. `hydrate()` is idempotent via a
    `if (get().hydrated || get().loading) return` guard that's sound because the
    following `set` runs synchronously, before the first `await` — so two
    same-tick mounts and StrictMode's double-mount both collapse to one fetch.
    Covered by a "hydrates once across two concurrent mounts" test.
- ✅ **30s poll → `schedule:next-runs` event.** New Go constant in
  `backend/services/events.go` and a `emitNextRuns()` helper next to
  `NextRuns()` in `scheduler_nextrun.go`, emitted through `EventBus` (never
  `runtime.EventsEmit` directly) from four sites: `runTimeTicker`'s per-minute
  loop and the three graph mutators (`SaveGraph`/`DeleteGraph`/
  `SetGraphEnabled`). Deliberately **not** from run completion —
  `scheduler_engine.go` never touches `lastFired`, and `NextRuns` reads it only
  for `trigger.interval` nodes, whose sole writer is `maybeFireInterval` on the
  ticker path. The frontend keeps exactly one `GetScheduleNextRuns()` fetch for
  first paint (the ticker aligns to the next minute boundary, so the first push
  can be up to 60s out) and is push-driven thereafter.
  - **Payload shape is a bare `map[string]int64`**, unlike the other
    `schedule:*` events' `map[string]interface{}` objects, so it matches
    `GetScheduleNextRuns()` exactly and one frontend setter serves both paths.
  - **Locking hazard, documented at `emitNextRuns`:** `sync.RWMutex` is not
    reentrant, and `NextRuns` takes `s.mu.RLock` plus (via `nextInterval`)
    `s.cooldownMu`. Emits therefore go *after* each mutator's `Unlock`, and
    never inside `maybeFire*`/`cooldownAllows`. `TestGraphMutatorsEmitNextRuns`
    is the deadlock guard — a misplaced emit hangs it instead of production.
  - **Net cost is lower, not higher:** the recompute now runs once a minute
    instead of twice, and `formatNextRun` only has minute resolution anyway, so
    the old 30s cadence was rendering the same string twice.
  - The `nextRuns` setter **always** writes a fresh object — no deep-equality
    short-circuit. A `timeOfDay` graph's epoch is constant while its rendered
    countdown ("in 2h" → "in 1h") is not, and `SchedulerSummary` only re-renders
    on identity change, so an equality check would silently freeze the
    countdown. Locked in by a test that was verified to fail when the
    short-circuit is added back.
- ✅ **IPC failures surfaced.** The store carries `error: string | null` — the
  first store in the repo to do so, a deliberate departure from the
  swallow-with-a-comment pattern of the other nine, because a dead bridge was
  otherwise indistinguishable from "no graphs configured". (CLAUDE.md nominates
  `useWailsCall()` for this; it's a React hook and can't be called inside a
  store — and it has no other callers in the tree.) Read paths record the error
  and keep last-good state; write paths record it **and rethrow**, which is what
  lets `GraphEditor` revert optimistic UI. `previewNode` deliberately stays a
  bare pass-through — `NodeDataPanel` already shows preview errors next to the
  node they belong to, and they shouldn't raise a tile-wide banner.
  - Surfaced minimized as a `text-danger` "scheduler unavailable" footer (with
    the full message on hover) beside the still-rendered cached graph list, and
    maximized as a click-to-dismiss chip in `GraphEditor`'s existing transient
    status slot — no restructuring of that 900-line file.
  - **`GraphEditor`'s four handlers gained catches.** The notable one:
    `handleToggleEnabled` flipped `setGraphEnabled(next)` *before* awaiting the
    IPC with no catch, so a failed toggle left the switch lying — it now
    reverts. `handleSave` returns `string | null` so `handleRun` can't act on a
    phantom id, and `handleDelete` no longer resets the editor when the delete
    failed.
- ✅ **Dead frontend surface removed.** `history` and `loading` were returned by
  the hook and consumed by nobody — run history was fetched on mount *and* after
  every run but never rendered. `GetScheduleRunHistory` is gone from the
  frontend (two IPC round trips saved); Go still persists history and the
  binding stays for a future run-log panel. `loading` was kept and finally given
  a consumer: the summary now says `loading…` rather than
  `maximize to add graphs` during first hydration. Hook surface: 11 keys, all
  consumed, down from 12 with 4 unconsumed.
- **Verification:** `go vet ./...`, `gofmt -l`, `go test -race ./backend/...`
  (new: `TestNextRuns`, `TestEmitNextRuns`, `TestGraphMutatorsEmitNextRuns`,
  `TestScheduleNextRunsEventName`), `pnpm typecheck`, `pnpm lint` (0 errors),
  `pnpm test` (205 tests — 20 new in `useSchedulerStore.test.ts`, and
  `useScheduler.test.ts` rewritten from a data test into a lifecycle test whose
  "never polls next-runs on a timer" case is the regression guard on the deleted
  interval), `pnpm build` + `pnpm check-bundle` (484.7 KB gzip entry, budget
  550 KB). The `schedule:next-runs` string is asserted literally on **both**
  sides — the `events.go` ↔ `constants.ts` mirror is hand-kept with no codegen
  and a typo fails silently (no push, and the initial fetch still paints, so it
  looks like it works). `wails generate module` was not needed: no bound-method
  or `backend/models/` changes, and event names aren't codegen'd.
  `frontend/src/lib/constants.ts` shows a large formatting-only diff — the
  lefthook policy is format-on-touch, and Prettier collapsed that file's
  long-standing manual column alignment.

### P2 — Memoization pass
- Add `React.memo` to the most expensive tile components (3D scenes, chart
  tiles) identified during a profiling pass.

### P3 — Bound method missing `(T, error)` return
- ✅ Found during the 2026-07-18 convention audit (`agent_docs/CONVENTION_AUDIT.md`):
  `GetAppVersion() string` (`app.go:151`) was the only method bound on the Wails
  `App` struct that didn't return `(T, error)` — the concrete instance of the
  Stable-pillar item "All Go methods bound to the Wails `App` struct return
  `(T, error)`". Changed to `func (a *App) GetAppVersion() (string, error)`,
  returning `Version, nil`. No binding regeneration or caller changes were
  needed: Wails' generated JS/TS for a `(T, error)`-returning method is
  identical in shape to a bare-`T`-returning one (`Promise<T>`; the error
  surfaces as a promise rejection, not a second tuple value), confirmed by
  diffing against another `(T, error)` method's generated binding (e.g.
  `GetAppSettings`). Both callers (`frontend/src/hooks/useUpdateCheck.ts:26`,
  `frontend/src/components/SettingsModal.tsx:512`) already `await`/`.catch()`
  the call, so a rejected promise is handled the same as today's resolved
  value.

### P1 — Tile grid: two parallel systems collapsed into one
- ✅ **Root cause: `react-grid-layout` was a dependency but wasn't actually
  driving the grid.** `Dashboard.tsx` consumed it through the v1-compat
  `react-grid-layout/legacy` wrapper with `compactType={null}` +
  `preventCollision` — a combination that disables every dynamic-readjustment
  feature the library has, so tiles never pushed each other or floated up to
  fill gaps. Adding a tile from the crate ran on a **second, hand-rolled
  system entirely**: window-level `mousemove`/`mouseup` listeners driving two
  manually-positioned placeholder/wireframe divs, bypassing RGL's own
  animated placeholder (`.react-grid-placeholder { transition-duration: 100ms
  }`) — which is why the crate-drop hover felt like "an entirely different
  system" from moving an existing tile, and why a dropped tile never resized
  to fit the space it landed in.
- ✅ **Migrated onto RGL v2's modern (non-`/legacy`) API.** `Dashboard.tsx`
  now uses `GridLayout` + `useContainerWidth` + `verticalCompactor` directly.
  Deleted the hand-rolled `findBestPosition`/`resolveDropCell` collision
  search (new-tile placement now follows RGL's own convention: drop at
  `bottom(layout)`, let the compactor pull it into a gap) and the manual
  `ResizeObserver`/`colWidth` math (`useContainerWidth`/`calcGridColWidth`
  instead).
- ✅ **Crate-drop unified with real-tile dragging via a "ghost item".** While
  a tile is dragged from the crate, a `{ i: '__ghost__', static: true, ... }`
  entry is appended to the *same* `layout` array real tiles render from (with
  a matching ghost child keyed `__ghost__`) rather than driving a separate
  placeholder/wireframe pair. RGL's own `synchronizeLayoutWithChildren` effect
  then compacts around it exactly as it would for any other item, so
  neighbours push and float using the library's own CSS-transition timing —
  smooth *by construction*, not by hand-replicating RGL's easing. Confirmed by
  reading `chunk-WGL5FSZH.mjs`: a `layout` prop change (not a native
  drag/resize) still runs `compactor.compact` via the prop-sync effect as
  long as no native `activeDrag`/`droppingDOMNode` is in progress, which the
  crate-drag gesture never triggers.
- ✅ **Unified S/M/L size vocabulary.** `TileDefinition.defaultW/defaultH/
  minW/minH` (loose per-tile numbers) replaced with `sizes: { sm, md, lg }`,
  each drawn from a shared `ALLOWED_W = [1,2,3,4,6]` / `ALLOWED_H =
  [3,4,6,8,12]` vocabulary (`lib/gridSizing.ts`) and required non-decreasing
  sm→md→lg on both axes (`registry.test.ts`, 34 assertions across all 11
  tiles). `sm` doubles as the resize floor. A sanctioned, one-time exception
  to "extend `registry.ts`, never restructure" — see `CLAUDE.md`'s Tile
  system section and the Do-not list. `lib/gridSizing.ts`'s `fitBucket()`
  picks the largest bucket that fits the free run at the hovered cell
  (lg→md→sm), which is what makes a dropped tile size itself to available
  space — it reads the real tiles' resting positions, not any transient
  in-flight compaction RGL applies while the ghost hovers, a deliberate
  approximation rather than a live readout of mid-drag animation state.
- ✅ **Crate made reorderable.** `useTileStore.crateTileIds` — maintained and
  tested but never actually read (`TileCrate` always rendered `TILE_REGISTRY`
  order directly) — deleted outright rather than repurposed. Reordering lives
  in `useSettingsStore.settings.crateOrder` instead (persisted via the
  existing `GetAppSettings`/`SaveAppSettings` bindings, the same path the
  scheduler palette prefs took — no new Go binding pair, just one added
  `CrateOrder []string` field + `wails generate module`). One gesture, two
  zones: dragging within the crate's own bounds live-reorders a local preview
  (not persisted per pointer frame — only on the reorder→canvas mode
  transition and on mouseup, so a continuous drag isn't an IPC call per
  pixel); crossing into canvas territory hands off to the existing
  ghost-drop path and the reorder that happened so far is frozen/persisted.
  Reordering only ever permutes within a tile's own utility/module group
  (`lib/crateOrder.ts`'s `reorderWithinGroup`, which leaves every other
  group's slots untouched regardless of interleaving) so that grouping
  survives. `normalizeCrateOrder` drops stale ids and appends newly-added
  registry tiles on every `load()` — including the reject/no-bridge path,
  not just the success path, since a stale empty array would otherwise
  silently drop tiles from the very first reorder after a failed load.
- ✅ **Fixed a latent circular-import crash `registry.test.ts` exposed.**
  `registry.ts` transitively imports every tile component; `tiles/backups`
  imports `useTileStore`, which (before this) read
  `TILE_REGISTRY.map(...)` at module top level. Whichever module happened to
  be the *first* to import `registry.ts` determined whether the cycle
  resolved cleanly — `Dashboard.tsx` imports `useTileStore` before
  `registry`, so the shipped app never hit it, but a test importing
  `registry.ts` directly did (`TILE_REGISTRY` reads as `undefined` mid-cycle).
  Fixed by deferring the read into a function called only from inside actions
  (`loadTiles`), which by definition run after the module graph has fully
  resolved, regardless of import order. Not a regression from this work —
  latent since `useTileStore` and `registry.ts` first both existed — just
  never triggered until a test imported `registry.ts` as the entry point.
- ✅ **Layouts compact once on load, not just after the first drag.**
  `useLayoutStore.loadPresets()`/`loadPreset()` now run the loaded layout
  through `verticalCompactor` before setting state (`compacted()` — dropping
  the compactor's own `cloneLayoutItem` noise fields like `static`/`moved`
  back down to the core `i/x/y/w/h`, so persisted JSON stays minimal; entries
  with a non-finite `y`, i.e. corrupt/legacy data, pass through unchanged).
  Otherwise a saved layout authored under the old free-placement renderer
  (or one of the 4 presets, all of which had deliberate gaps) would visually
  snap into its compacted form on first render while the *persisted* value
  stayed gapped until the user's next drag/resize wrote it back — a one-time
  surprise reflow the moment compaction was turned on.
- ✅ **All 4 presets re-authored onto bucket sizes; `mods` was missing from
  three of them.** `Default`/`Console Focus`/`Compact` now include all 11
  registered tiles (`constants.test.ts` asserts this — 21 tests covering
  bucket-size matching, no overlaps, no out-of-bounds placement, no duplicate
  ids across all 4 presets). `Essentials` stays a deliberately small curated
  subset (6 tiles) — that asymmetry is the preset's entire point, not the
  inconsistency the other three had.
- ✅ **Grid motion joined the shared `--duration-*`/`--ease-*` vocabulary.**
  RGL's own stylesheet hardcodes `200ms ease` (items) / `100ms` (placeholder).
  Overridden in `style.css` to `var(--duration-fast)`/`var(--ease-standard)`
  — `!important` on the `transition-duration`/`transition-timing-function`
  longhands only, never the `transition` shorthand or `transition-property`,
  so RGL's own `.resizing`/`.react-draggable-dragging` states (which disable
  animation via `transition-property: none`) are untouched and active
  drags/resizes stay instant as intended; only the settle-animation *rate*
  changes. `!important` is necessary because `style.css` loads before
  `react-grid-layout/css/styles.css` in the bundle (`main.tsx` imports
  `style.css` before `App`, which is what eventually pulls in `Dashboard.tsx`
  → RGL's stylesheet), so an equal-specificity override without it would
  lose to the later-loaded rule.
- **Deliberate scope decisions:**
  - Kept the existing CSS radial-gradient dot background (now sized off
    `calcGridColWidth`) rather than switching to RGL v2's new
    `GridBackground` (`react-grid-layout/extras`) — `GridBackground` renders
    a finite-row SVG sized to an explicit `rows`/`height`, which doesn't
    naturally track a scrollable canvas whose content height grows as tiles
    are added; the existing CSS `background-size` tiling approach handles
    that for free.
  - No `TileCrate.tsx` component test — no component-test precedent exists
    anywhere in this repo (only store/lib/hook tests), and the DOM-gesture
    wiring is comparatively thin glue around logic that *is* fully unit
    tested (`crateOrder.test.ts`, `gridSizing.test.ts`). Verified manually
    instead via `wails dev`.
- **Verification:** `pnpm typecheck`, `pnpm lint` (0 errors; the pre-existing
  130 warnings are all in `players`/`worlds` tiles, tracked separately under
  this checklist's Milestone 2 inline-style backlog — none touched by this
  work), `pnpm test` (new: `gridSizing.test.ts` 11, `registry.test.ts` 34,
  `crateOrder.test.ts` 8, `constants.test.ts` 21; updated:
  `useTileStore.test.ts`, `useSettingsStore.test.ts`, `useLayoutStore.test.ts`
  for the new store shapes/behavior), `pnpm build` + `pnpm check-bundle`
  (484.9 KB gzip entry chunk, budget 550 KB — RGL v2's modern API didn't move
  the needle meaningfully), `go vet ./...`, `wails generate module` (only
  `wailsjs/go/models.ts` changed — `CrateOrder []string` on `AppSettings`).
  Manual `wails dev` walkthrough: dragging an existing tile pushes/floats
  neighbours; dragging a crate tile over the canvas shows the identical
  animated ghost, sized to the space it's hovering over; releasing outside
  the canvas cancels; reordering within the navbar persists across restart;
  dragging an already-active tile only reorders (no ghost); removing a tile
  closes the gap; resizing respects the `sm`-bucket floor; all 4 presets load
  correctly; maximize/restore and the flash-ring both still work unchanged.

### P1 — Tile grid: crate-drag placement fixed (the above shipped broken)
- The previous entry's manual walkthrough claimed dragging a crate tile shows
  a smooth animated ghost that sizes to the space it's hovering over. In
  practice: the hover rectangle jumped around, usually snapping to the very
  bottom of the grid or back to wherever it was previously, and it almost
  never resized to fit — reported directly against a `wails dev` session,
  contradicting that walkthrough. Four real causes, one design constraint
  that was simply the wrong choice:
  1. ✅ **`static: true` on the ghost poisoned `verticalCompactor`.**
     `compact()` seeds its scan with `maxY = bottom(getStatics(layout))`;
     with no statics that's correctly `0`. The static ghost made it
     `ghost.y + ghost.h`, so on *every* pointer-move frame the entire board
     got yanked to a ceiling that moved with the cursor — the violent
     jumping. RGL's own external-drop code pointedly sets `static: false` on
     its dropping item; the previous session missed that.
  2. ✅ **`fitBucket` collapsed to `sm` over any occupied cell.**
     `freeRunAt` returns `0` when the start cell is occupied, no bucket
     matched, and it fell through to the `sm` floor — and most of a
     populated board *is* occupied, hence "never resizes".
  3. ✅ **Three geometry sources that could disagree.** The preview measured
     `mergedLayout`, the screen showed RGL's internally-recompacted layout,
     and the drop recomputed a third time from `currentLayout` at the
     `mouseup` coordinates (which can differ, even if only by a subpixel,
     from the last `mousemove`'s).
  4. ✅ **No cursor-following element.** Native RGL always pairs a dragged
     item (pixel-positioned under the pointer) with a snapped placeholder at
     the landing spot. Only the snapped ghost survived the previous session;
     with nothing tracking the cursor, a ghost that snapped far away read as
     disconnected from the drag entirely.
  - **The design constraint, not a bug:** under `verticalCompactor`, a
    dragged tile can never rest on an arbitrary cell — it always floats to
    the topmost free row. That's what "only snaps to a specific view" was:
    the compaction model working as designed, just fixed to be honest about
    it. Confirmed with the user this wasn't the wanted behavior at all.
- ✅ **Switched the grid to free placement + push.** `gridSizing.ts` exports
  `GRID_COMPACTOR = noCompactor` (`type: null`); `Dashboard.tsx`'s
  `<GridLayout>` uses it directly. A tile now stays exactly where it's
  dropped or dragged; react-grid-layout's own `moveElementAwayFromCollision`
  has an explicit `compactType === null` branch that pushes a collider down
  rather than blocking the move, confirmed by direct probing with a small
  throwaway Node script against the installed package (not just reading the
  source — see below for why that mattered here). Removing a tile no longer
  relies on compaction to close its hole, so `lib/layout.ts`'s
  `collapseEmptyRows` (deleted in the prior session as apparently
  superseded) came back from git history, wired into `Dashboard.tsx`'s new
  `handleRemoveTile` — conservative by design: only fully-empty rows
  collapse, nothing repacks sideways. A newly-active tile with no saved
  position (click-add, shift-click) now needs an actual free-slot search
  (`gridSizing.ts`'s new `findFreeSlot`, effectively the `findBestPosition`
  deleted the same session) since there's no compactor left to rescue a bad
  placement afterward.
- ✅ **`lib/dropPreview.ts` (new): a hand-rolled cascade-push resolver,
  deliberately not `moveElement`.** The plan going in was to seed the ghost
  below everything and call react-grid-layout's own `moveElement` to move it
  to the target, reusing the library's own collision resolution. Empirically
  probed three cases against the installed package before writing this:
  `moveElement` handles a single collision and two *simultaneous* collisions
  correctly (ghost stays at target, colliders pushed below it) — but a
  **cascaded** collision (pushing item A down into item C, which needed to
  move too) left A and C overlapping, because `moveElement`'s collision list
  is computed once up front and not everywhere re-verified after a push.
  Also independently confirmed the seed-at-target trap the plan called out:
  `moveElement` early-returns with no collision resolution at all when the
  item is already at `(x, y)`. Given a real cascade bug, `previewDrop()` is a
  ~20-line self-contained resolver instead: place the ghost, then walk items
  sorted top-to-bottom pushing each one below anything already-settled it
  collides with (ghost included) — terminates because a pushed item's `y`
  only ever increases, bounded by the settled set's max bottom edge.
  `dropPreview.test.ts` (12 tests) locks in the specific case `moveElement`
  got wrong (a 2-level cascade) alongside the simpler ones, plus
  no-mutation and clamping. This is why the empirical probe mattered more
  than reading react-grid-layout's source here: a plausible-looking branch
  (`if (collisionNorth && compactType === null)`) does the right thing for
  the simple case and silently doesn't cascade — reading the code predicted
  the opposite of what it actually does once mutation order is accounted
  for.
- ✅ **One source of truth for the drop, actually enforced.** `Dashboard.tsx`
  now mirrors the live-render's `dropCell`/`previewLayout` into a ref on
  every render; `onUp` commits that ref's layout verbatim (renaming the
  ghost's `i` to the real tile id) instead of recomputing `pointerToCell`
  from the `mouseup` event's own coordinates. The preview shown and the
  layout committed are now the same array, not two separately-computed ones
  that happen to usually agree.
- ✅ **Geometry now measures the actual grid, not the scroll wrapper.**
  `pointerToCell` used to hand-correct for `canvasRef.scrollTop` against the
  *scrollable viewport's* rect. Replaced with `GridLayout`'s `innerRef`
  pointed at the real `.react-grid-layout` container and matched RGL's own
  `handleDragOver` approach: measure against the grid container's own rect,
  which already moves with scroll, so the manual `scrollTop` arithmetic (a
  latent source of drift) is gone. The scrollable viewport (`canvasRef`) is
  now used only for the "is the pointer over the visible canvas" hit-test,
  which needs the *clipped* viewport, not the full (possibly scrolled-off)
  grid extent.
- ✅ **Two-pass sizing, with an explicit occupied-cell fallback.**
  `fitBucket` gained a `fallback: SizeBucket` parameter (default `'md'`):
  when the hovered cell is already occupied — the common case — it returns
  the tile's own default bucket instead of collapsing through lg→md→sm to
  the smallest size, since free placement pushes the occupant aside
  regardless. `pointerToCell` computes a provisional cell anchored on the
  tile's default bucket, asks `fitBucket` what actually fits there, then
  recomputes the cell centered for the *chosen* bucket's real dimensions
  (a bigger or smaller box centers differently under the cursor than the
  anchor did).
- ✅ **Restored the cursor-following wireframe** alongside the snapped
  ghost/placeholder — deleted in the prior session on the theory that the
  in-layout ghost alone was sufficient. It wasn't: when the snapped ghost
  jumps to a distant cell there needs to be something under the pointer
  connecting the drag to the hand doing it. Restyled the ghost/placeholder
  itself to match `.react-grid-placeholder` (`--hover-surface` fill,
  hairline `--border-subtle`, 10px radius) rather than the accent-highlight
  styling it had, so a crate-drag and a real tile-drag read as the same
  system, which was the point of this feature from the start.
- ✅ **Undid the previous session's load-time compaction.** `useLayoutStore`'s
  `compacted()` helper — added so a gapped saved layout would match a
  compacting renderer — now actively destroys user layouts under free
  placement, which preserves gaps by design. Removed, along with its two
  tests; replaced with one asserting a gapped layout loads **unchanged**.
- ✅ **`Default` preset had a 3×8 empty void that used to be invisible.**
  `server-config` (w3) followed by `mods` stacked below it (w4) left a
  24-cell rectangular gap that `verticalCompactor` silently closed on every
  render — real under free placement, since nothing pulls tiles up anymore.
  Re-authored `mods` to sit beside `server-config` (sm bucket, matching the
  pattern `Console Focus` already used), matching `constants.ts`'s own
  updated header comment: presets render exactly as authored now, so a
  large unfilled block is a real visual defect, not something to leave for
  the compactor.
- **Verification:** `pnpm typecheck`, `pnpm lint` (0 errors; same
  pre-existing warning set as the prior entry), `pnpm test` (new:
  `dropPreview.test.ts` 12; extended: `gridSizing.test.ts` to 18 for the
  fallback + `findFreeSlot`, `layout.test.ts` restored at 7; updated:
  `useLayoutStore.test.ts` for the free-placement load behavior;
  `constants.test.ts`'s existing 21 re-verified against the tightened
  `Default` preset), `go vet ./...`. Manual verification used synthetic
  mouse events dispatched against a bare `pnpm dev` session (this sandbox
  can't drive `wails dev`'s native window) with `window.go.main.App` stubbed
  so the Wails-less `.catch()` paths don't swallow the drop — confirmed the
  ghost tracks the pointer continuously without jumping, lands where shown,
  sizes correctly across free/occupied/tight space, and a low-row drop
  no longer floats to the top.

### P1 — Tile grid: crate-drag placement, rebuilt (the above shipped broken too)
- The previous entry's manual verification — synthetic mouse events against a
  bare `pnpm dev` session — passed clean. Real `wails dev` usage (screenshots
  attached directly to the report) showed it wasn't: tiles created whitespace
  that never closed, tiles landed on top of each other, and a dragged-in
  tile's size jumped between fitting/original/biggest with no clear pattern.
  Worth being honest about why the sandboxed pass missed this rather than
  papering over it: synthetic-event testing confirmed the mechanics worked in
  the specific scenarios it tried, but a bare Vite session has no Wails
  bridge and can't reproduce whatever the real native-window interaction
  pattern hit. That gap is a real limit of that testing approach, not
  something this fix changes — flagging it so a future session doesn't trust
  a clean sandboxed pass alone again either.
- ✅ **Root cause: `compactType: null` (free placement) is a known-bad mode of
  react-grid-layout itself**, not one more bug to patch. Confirmed against
  the upstream issue tracker, matching the symptoms verbatim:
  - [#1982](https://github.com/react-grid-layout/react-grid-layout/issues/1982) —
    "with `compactType={null}`, if one item is dragged on top of another, the
    second item gets pushed down vertically way too far and there is a large
    gap." The whitespace-that-never-closes symptom, exactly.
  - [#2161](https://github.com/react-grid-layout/react-grid-layout/issues/2161) —
    a newly-added item in `null` compactType "incorrectly appears at position
    x:0, y:0 and overlaps existing widgets." The overlap symptom, exactly.
  - [#2131](https://github.com/react-grid-layout/react-grid-layout/issues/2131) —
    unexpected Y-axis movement specifically in `compactType={null}`.
  Reading `moveElementAwayFromCollision` explains why: its
  `compactType === null` branch resolves a collision by reassigning positions
  directly, with **no recursive re-verification** — confirmed empirically the
  previous session (a 2-level cascade left two items overlapping), which is
  exactly why that session's `dropPreview.ts` existed at all, hand-rolling a
  cascade-push resolver to route *around* the bug for the crate-drop path
  only. Its own docstring says as much. What it didn't say: native
  drag/resize of an *existing* tile was never routed through that
  workaround — it went straight through the same buggy stock `moveElement`
  path the whole time. That's the overlap bug the screenshots showed for
  plain tile-to-tile dragging, not just crate-drops.
  `compactType === 'vertical'`'s equivalent branch, by contrast, recurses
  back into `moveElement`, so a cascaded collision actually resolves.
- ✅ **Switched the grid to `verticalCompactor`** — react-grid-layout's
  default and by far its most-used, best-tested mode — via
  `gridSizing.ts`'s `GRID_COMPACTOR`, imported everywhere a compactor is
  needed (the grid itself, `useLayoutStore`'s load-time normalization) so
  there's exactly one place that decides it. The accepted trade, made
  explicitly this time rather than assumed: a dragged tile always floats to
  the topmost open row now: it can't rest at an arbitrary row the way free
  placement could. Given free placement is proven buggy at the library
  level, this is the right trade — and paired with the next change, "floats
  to the top" costs much less than it would have with wildly different tile
  sizes.
- ✅ **Every tile is now one uniform size** (`gridSizing.ts`'s
  `TILE_SIZE`/`TILE_MIN`/`TILE_MAX`), replacing the `sm`/`md`/`lg`
  per-tile bucket system entirely — not just a preference, it deletes an
  entire class of code that was actively wrong. That system existed solely
  to answer "what size should this dragged tile become at this spot?", and
  `fitBucket` (the function answering it) was evaluated against the
  *resting* layout, not the live mid-drag preview — so as other tiles
  visually shifted under the cursor, the bucket choice flickered against a
  base that no longer matched the screen. That's the "jumps between sizes"
  symptom. Uniform sizing makes the question moot: there is no bucket to
  pick.
  - Deleted outright, all now genuinely dead rather than merely
    superseded: `lib/dropPreview.ts` + its test (the free-placement
    workaround, moot once the grid isn't in that mode), `lib/gridSizing.ts`'s
    `SizeBucket`/`BUCKET_ORDER`/`ALLOWED_W`/`ALLOWED_H`/`TileSizes`/
    `isColFree`/`freeRunAt`/`fitBucket`/`findFreeSlot`, and — for the second
    time, this time with the reasoning actually verified rather than
    assumed — `lib/layout.ts`'s `collapseEmptyRows` (traced
    `compactItemVertical`'s sweep: vertical compaction repacks the *entire*
    layout upward on every layout-prop change, including a tile's removal,
    so a manual gap-closer is redundant by construction, not by
    assumption).
  - `types/index.ts`'s `TileDefinition` and every entry in `registry.ts`
    dropped `sizes`/`defaultBucket` — a tile declaration is now just
    `{ id, label, icon, maximizable?, component }`, simpler than before the
    bucket system ever existed and with no sizing decision left to make.
  - `Dashboard.tsx`'s `pointerToCell` lost its `tile` parameter and the
    two-pass bucket-fitting dance (anchor on default bucket → `fitBucket` →
    recenter on the chosen bucket): there's one size now, so it's a single
    `cellAt()` call. It's also no longer a `useCallback` at all — since it's
    only ever invoked synchronously during render (not from the stable
    window-listener effect), it can just be a plain function closing over
    the current render's `positionParams` directly, which also removed the
    `geomRef` ref-mirroring it existed for.
  - The crate-drag ghost still lives in the same layout array real tiles
    render from (kept from the free-placement round) and is still explicitly
    `static: false` — the flag that poisoned `verticalCompactor`'s scan the
    *first* time this grid used compaction, two sessions ago
    (`maxY = bottom(getStatics(layout))` gets corrupted by a static item).
    New this round: the combined array is compacted **in `Dashboard.tsx`'s
    own code** via `GRID_COMPACTOR.compact()` before being handed to
    `<GridLayout>`, rather than trusting react-grid-layout's internal
    (invisible-to-us) sync effect alone — `compact()` is a pure function of
    its input, so compacting twice (once here, once again internally for
    display) is idempotent, and it's what lets the ref mirroring "what was
    just previewed" for the on-drop commit hold the *actual* landing
    positions instead of a pre-compaction shape that only looked right once
    react-grid-layout's own internal state caught up.
- ✅ **Presets re-authored around uniform sizing.** Hand-placing 44 `x/y/w/h`
  values stopped making sense once every tile is the same size — replaced
  with a `tileGrid()` generator (row-major, wraps at `COLS`) driven by an
  ordered id list and a size, relying on load-time compaction to settle the
  result. `Compact` now legitimately authors at `TILE_MIN` instead of
  `TILE_SIZE`, demonstrating the shared resize range does something, rather
  than being a second copy of `Default`. `Essentials` keeps its deliberately
  small 6-tile subset.
- ✅ **Load-time compaction restored** in `useLayoutStore` (`compacted()`,
  removed the previous session when the grid was on free placement) —
  correct again now that the renderer compacts; a saved layout with gaps
  needs to match on load, not just after the user's next drag.
- **Verification:** `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test`.
  `gridSizing.test.ts` shrank to sanity checks on the size constants
  (min ≤ default ≤ max, default fits within `COLS`) now that there's no
  fitting algorithm left to test; `registry.test.ts` shrank to a
  no-duplicate-ids check; `dropPreview.test.ts` deleted with its subject;
  `useLayoutStore.test.ts` restored its two compaction-on-load cases;
  `constants.test.ts` updated for the regenerated presets (uniform-size
  membership instead of bucket membership, plus the existing
  overlap/in-bounds/no-duplicate-ids/full-coverage checks). Manual
  verification: synthetic-event pass (same technique as before, still
  useful for catching gross breakage) extended to assert no overlaps and no
  uncollapsed gaps in code rather than "it looked right" — plus dragging
  *existing* tiles around the board (the path that was never fixed the
  previous round), removing tiles, resizing at both ends of the min–max
  range, and switching between all 4 presets. Given the sandboxed pass's
  track record so far, this round's fix is not considered closed until
  confirmed against a real `wails dev` session.

### P1 — Tile grid: right-hand cells unreachable from the crate

Reported against the rebuild above, from a real `wails dev` session: a tile
dragged in from the crate refused to land on the right-hand side of a row. The
green cursor wireframe sat over the top-right cell while the grey snapped
placeholder dropped to the row *below*, "underneath whatever tile is in the
way". Dragging an already-placed tile onto that same cell worked fine.

- **Root cause — an asymmetry between the two drop paths, not the geometry.**
  The pointer→cell math was correct throughout: the screenshot's grid measured
  exactly `COLS = 6`, `ROW_HEIGHT = 40`, 3×8 tiles (594×404 px, 202 px column
  step), and the pointer at the far right resolved to `x = 3` as it should.
  What differed was collision resolution. A native tile drag routes through
  react-grid-layout's `moveElement`, which pushes the *occupant* out of the
  way. The crate ghost was instead appended to the layout and the whole array
  handed to `compact()` — and compaction resolves contention by sort order
  (y, then x), so the ghost lost to anything above or to its left and was the
  one shoved down. In the reported board a tile sat at `x = 1`, straddling
  columns 1–3; the ghost's only legal rightmost position is `x = 3`
  (`calcXY` clamps to `cols - w`), which overlaps at column 3 — so every
  attempt at the top-right was pushed to `y = 8`. Columns 4–5 alone are two
  wide and can never hold a 3-wide tile, which is why the right-hand side felt
  unreachable rather than merely awkward.
- ✅ **Fixed in `lib/gridSizing.ts`'s new `withGhost()`**, which Dashboard's
  `previewLayout` now calls: items the ghost overlaps are moved below it
  *before* compacting. That only flips the sort order; the compactor still
  performs all the actual collision resolution and pulls the displaced tiles
  back up as far as they legitimately fit. The ghost is the item under the
  user's hand, so it takes the cell and the occupants yield — the same
  semantics a native drag already had.
- **Rejected: reusing `moveElement` directly** for the ghost, which would have
  been the more library-native fix. Its push heuristic depends on the small
  frame-to-frame deltas of a real drag; entering the ghost at the bottom of the
  layout and moving it to the hovered cell in one jump makes the item and its
  collider ping-pong a row at a time, and the ghost loses. Measured over 4000
  random boards it placed the ghost correctly in only ~29% of cases, against
  100% for the ordering fix.
- **Verification:** `pnpm typecheck`, `pnpm lint` (0 errors, 129 pre-existing
  inline-style warnings), `pnpm test` (249 passing). `gridSizing.test.ts` gained
  the regression case (a straddling tile no longer blocks the top-right cell),
  displacement, free-cell, column-preservation and second-compaction-is-a-no-op
  cases; `constants.test.ts` dropped its private overlap predicate in favour of
  the now-shared `collides`. Property-checked over 5000 random boards: no
  overlaps, the ghost always keeps the hovered column, and it is never sunk
  below the hovered row. Browser pass drove the real crate-drag path
  end-to-end (plain window listeners, no react-draggable synthesis) and
  confirmed for every drop that the committed position equals the previewed
  one, with zero overlaps and zero gap rows — including the reported board
  shape, a tile deliberately straddling columns 1–3 and then a drop onto the
  top-right cell.
- **Note on the harness, not the app:** with `window.go` absent (a bare `vite`
  session), `persistActiveLayout`'s binding call throws *synchronously*, so its
  `.catch()` never attaches and the throw escapes react-grid-layout's
  `onDragStop`, leaving `setActiveDrag(null)`/`setLayout()` unrun — a stuck
  placeholder and a visibly overlapping board. Not reachable in the packaged
  app, where the bridge always exists; noted so the symptom isn't mistaken for
  a grid bug next time. Tracked as a robustness follow-up.

---

### 2026-08-15 — Checklist re-baseline after an unpaused stretch of app work

The checklist had not been touched for 25 commits (last at `a85f235`), while
NeoForge/Forge support, tile-crate drag reordering, a rebuilt token layer, two
new CI checks and an entire `website/` sub-project all landed. This pass
audited the checklist's own claims before doing any work against it, on the
principle that a stale yardstick measures nothing.

**Claims that had gone stale, now corrected in the checklist:**
- The Clean pillar pointed `--duration-*`/`--ease-*` at
  `frontend/src/style.css`'s `@theme inline` block. Those tokens live in
  `frontend/src/styles/tokens.css` now, and — more importantly — the whole
  token layer is *generated*, so the gate is "reuse a token", never "edit one".
- The "canonical local commands" block listed 5 commands. The real gate set is
  the 7 in `.claude/suite.json` plus its generated-file check, run together by
  `/suite-kit:health`.
- The CI item predated the `backend-linux` job and the token-sync check.
- The `--font-mono` backlog item was overtaken outright (closed above).

**Claims re-verified as still true** (no action needed): zero
`localStorage`/`sessionStorage` under `frontend/src`; no committed build
artifacts; poll cadences unchanged (150ms console flush, 15s TPS, 10s stats,
1min scheduler); Wails bindings exactly in sync at 83 bound methods ↔ 83
declarations; and the inline-style census, which read 144/37 against a recorded
"143 across 35" — close enough to trust.

**New gaps the audit surfaced** (all now tracked in the checklist backlog):
`pnpm format:check` is red on 33 files *and* absent from CI, so nothing catches
it; `website/` has no lint, formatter or CI job at all; the generated
`border-hairline`/`border-thick` utilities are used nowhere while every
migrated file writes `border-[0.5px]`; and the dead `--panel-bg` item turned
out to be a live light-theme bug rather than hygiene.

**P1 — Players tile: 3s poll replaced with the events that already
existed** ✅
- `PlayerGrid.tsx` and `PlayerRoster.tsx` each ran `setInterval(poll, 3000)` —
  the tightest cadence in the app by 5× (next is the 10s stats tick), and a
  direct violation of `CLAUDE.md`'s "do not use `useEffect` for data that should
  come from a Wails event listener".
- The plumbing was already there and simply unused: `server.go` emits
  `player:joined`/`player:left`, and it updates its live player map *before*
  emitting, so a refresh triggered by either event always observes post-change
  state. Added `tiles/players/usePlayers.ts` on the established per-tile hook
  convention (`useWorlds`/`useBackups`/`useMods`): one `GetPlayerRoster` fetch
  per server, then refetch on `player:joined`, `player:left`, `server:started`
  and `server:stopped`, every listener released on unmount. Covered by
  `usePlayers.test.ts` (9 tests) including an explicit "does not poll on an
  interval" assertion under fake timers, so the regression can't come back
  quietly.
- The hook sits in the tile root because `index.tsx` renders Grid *or* Roster on
  the `maximized` ternary — one fetch feeds whichever is mounted. The useful
  side effect: `PlayerCard`/`PlayerGrid`/`PlayerRoster` became props-driven,
  which is what let the style slice above be verified in a plain Vite server
  instead of needing `wails dev`. Worth copying for the three remaining 10s
  polls — lifting the fetch out is what makes a tile testable.
- Kick/ban/pardon refresh through the hook: a kick does emit `player:left`, but
  banning an *offline* player and pardoning only rewrite `banned-players.json`,
  which no event covers.

**P1 — `[object Object]` in player join/leave notifications** ✅
- `server.go:275/282` emit `map[string]string{"name":…, "ip":…}`, so the
  Wails payload is an object. `App.tsx`'s two handlers typed it as a bare
  `(name: string)` and interpolated it straight into the message — every join
  and leave toast read "[object Object] joined the game".
- Found by diffing emit shapes against handler signatures across the whole
  codebase: all ~35 other `EventsOn` handlers already destructure an object,
  and these two were the only outliers. That sweep is cheap and worth repeating
  whenever an event payload changes — the mismatch is invisible to `tsc`,
  because Wails' generated `EventsOn` types its callback args as `any`.
- Not reproducible outside a real server: it needs a live join. Fixed by
  retyping both handlers to `(d?: { name?: string })` with an empty-payload
  guard, so a malformed payload can't produce "undefined joined the game"
  either. The *rendering* path is unchanged and already covered by
  `useNotificationsStore.test.ts`.

**P1 — `pnpm format:check`: 33 files red, gate absent from CI** ✅ **closed**
- ⚠️ **Correction to how the previous entry framed this.** It was recorded
  as drift that "nothing catches", implying neglect. It wasn't: `lefthook.yml`
  documented a deliberate strategy — the repo had a formatting style predating
  Prettier, so it was cleaned *on touch* rather than reformatted wholesale. The
  33 files were the unfinished remainder of that migration, not rot.
- The strategy had two gaps that guaranteed it would never finish. The hook's
  glob is `*.{ts,tsx,css}`, so `index.html`, both `tsconfig`s,
  `scripts/check-bundle-size.mjs` and `package.json` could never be reached by
  touching source files. And because the tree could therefore never go green,
  `pnpm format:check` could never be added to CI — which is precisely what let
  it sit unnoticed. Format-on-touch cannot converge on its own.
- **`pnpm-lock.yaml` was 3,309 of the ~5,700 lines** Prettier wanted to change,
  more than every source file combined. Added to `.prettierignore` rather than
  formatted: pnpm owns its layout and rewrites it on any dependency change, so
  the pass would be undone the next time anyone adds a package — the same
  failure mode the file's existing comment already described for the generated
  token layer. This is worth checking first in any future formatting sweep; the
  headline file count was misleading until the tool-owned file was separated
  out.
- Then one formatting-only commit over the remaining 32 files (1,555+/836−),
  and `pnpm format:check` added to the CI `frontend` job between `lint` and
  `test`.
- The worlds tile was included deliberately even though it's the next Milestone
  2 slice. The instinct is to skip it to avoid churn-on-churn, but that's
  backwards: leaving it unformatted means committing that slice trips lefthook,
  so the slice arrives with formatting mixed into the migration. Formatting it
  in its own commit first is what keeps that diff a pure migration.
- **Verification worth reusing for any formatting-only change.** All three
  Rollup chunk content hashes came out unchanged from the pre-format build
  (`index--70hraTC.js`, `WorldsScene-CZWTdovg.js`, `charts-gPBNn07t.js`), and
  the entry chunk was byte-identical at 1,639,435 bytes. Rollup derives those
  hashes from compiled output, and JSX text-node whitespace — the one thing
  Prettier can legitimately change that alters rendering — compiles into that
  output. So identical hashes prove no rendering-visible whitespace moved in
  **any** of the 32 files. That's strictly stronger than the browser
  computed-style spot-check originally planned, which would have covered one
  file; the harness was skipped as redundant. Alongside: typecheck clean, lint
  unchanged at 0 errors / 97 warnings (formatting cannot add or remove an
  inline style, so any movement there would have meant something real changed),
  271/271 tests, token layer in sync.

---

### 2026-08-17 — Milestone 2 closed: App.tsx's last inline styles

`App.tsx` was the one file the previous re-baseline (2026-08-15) had already
identified as the sole remaining backlog: 6 `style={{}}` attributes, all
static, against 65 more across the tree that were already documented
exceptions in ratcheted directories.

**Why it wasn't a straight swap.** Four of the six are directional hairline
borders (`borderRight`, `borderBottom` ×2, `borderTop`). The generated token
layer only ever emitted the all-sides `border-hairline`/`border-thick`
utilities — the exact gap the checklist's P2 "used nowhere" item had been
tracking. So the last file in the migration and that backlog item were the
same piece of work: App.tsx couldn't move to Tailwind utilities without the
generator emitting a directional form first.

- ✅ **`frontend/scripts/gen-tokens.mjs`**: added a `BORDER_SIDES = { t: 'top',
  r: 'right', b: 'bottom', l: 'left' }` map and a second emission loop, so each
  entry in `src.border.scale` now also gets `border-t-<name>`, `border-r-<name>`,
  `border-b-<name>`, `border-l-<name>` alongside the existing all-sides rule.
  Four sides, not `x`/`y` — a grep across the tree found 47 `-b`, 15 `-t`, 7
  `-l`, 6 `-r` literal call sites and zero `-x`/`-y` ones, so axis utilities
  would have recreated the same generated-but-unused problem this change was
  closing. Unused combinations (e.g. `border-l-thick`, which nothing calls yet)
  cost nothing: Tailwind v4 only emits a utility into the build when a scan
  finds it in source.
- **No upstream `kollektiv/design/tokens.json` edit was needed.** The `hairline`
  (0.5) and `thick` (1.5) values already existed there; this only changed how
  Konnekt's generator surfaces them as utilities. Ran `pnpm gen:tokens` and
  confirmed a second run produced a byte-identical `tokens.css`/`tokens.ts` —
  the generated-file check `.claude/suite.json` declares.
- ✅ **`App.tsx`**: `border-r-hairline`, two `border-b-hairline`, and
  `border-t-hairline` (all paired with `border-border-subtle`) replaced the
  four inline borders. The accent wordmark's `color`/`fontFamily`/`fontWeight`
  became `text-accent font-display font-black` (`--font-display` already
  existed in the generated `@theme` block as `'Satoshi', var(--font-sans)`,
  matching the literal exactly). The settings button's `color` plus two
  `onMouseEnter`/`onMouseLeave` handlers that imperatively mutated
  `style.color` became `text-text-muted hover:text-text-primary` — removing
  imperative DOM style mutation, not just an attribute, since
  `transition-colors` was already present on the element.
- ✅ **`eslint.config.js`, inverted rather than extended.** The first pass simply
  added `'src/App.tsx'` to the ratchet allowlist. A verification pass caught that
  this left the migration enforced by an *opt-in* list: the global rule was still
  `warn`, and `eslint --print-config` measured `src/main.tsx` at severity `1`
  against `App.tsx`'s `2`. 78 of 79 `.tsx` files were covered, and — the part that
  actually matters — every **new** file or tile directory would have defaulted to
  `warn` until someone remembered to extend the list. An allowlist is the right
  shape while ratcheting tile by tile and the wrong shape the moment it is
  complete.
- So the global block became `'error'` and the allowlist config object was
  deleted outright. **Proven safe before the edit** by simulating the end state
  with `eslint src --rule '{"no-restricted-syntax":["error",…]}'`, which forces
  the rule on for every file: 0 errors. That works because each remaining
  justified exception already carries a documented `eslint-disable-next-line`.
  After the change all four spot-checked files (`App.tsx`, `main.tsx`,
  `Dashboard.tsx`, `WorldHud.tsx`) measure severity `2`, and `eslint src` is
  0 errors / 13 pre-existing unrelated `react-hooks/exhaustive-deps` warnings.
  Milestone 2 is complete *and* self-maintaining, not a snapshot that decays
  the next time a tile is added.
- **Correction to how the P2 hairline item was framed.** It previously read
  "used nowhere," which had already gone stale: the worlds slice
  (`WorldHud.tsx`, `WorldsScene.tsx`) uses the all-sides `border-hairline` 4
  times. The real disagreement was sharper than "nowhere" suggested — **166
  literal `border-[0.5px]` occurrences, across 164 lines in 41 files**, against
  those 4 — and the directional gap described above was the part actually
  blocking further adoption. Restated in the checklist with today's numbers.
  Note the occurrence/line split, because a first pass at this entry quoted 164
  next to a per-side breakdown that summed to 166: `grep -c` counts *lines* and
  `grep -o` counts *matches*, and two lines
  (`tiles/mods/InstalledPanel.tsx:161` and `:313`) carry two each. Worth
  stating the basis explicitly so the eventual sweep can check its own
  arithmetic.
- **Verification:** `pnpm exec eslint src` dropped from 6 `no-restricted-syntax`
  warnings to 0, with 0 errors before, after, and under the forced-`error`
  simulation (only the 13 pre-existing unrelated `react-hooks/exhaustive-deps`
  warnings remain). `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean;
  `pnpm test` 271/271; `pnpm build` then `pnpm check-bundle` at 487.2 KB gzip
  entry chunk (550 KB budget); `go vet ./...` and `go test ./...` clean from the
  repo root.
- **`pnpm format:check` does not cover this file.** It runs `prettier --check .`
  from `frontend/`, so nothing under `agent_docs/` is reached — the committed
  markdown here has never been Prettier-clean and is deliberately outside its
  remit. Recorded because a first pass at this entry cited a passing
  `format:check` as evidence the docs were fine, and then shipped a `###`
  heading wrapped onto a second line, which renders as a heading plus a stray
  paragraph. Prose in `agent_docs/` is checked by reading it, not by a gate.
- **Browser pass**, plain `vite` dev server (no Wails bridge, so the
  `stats:snapshot`-listener console errors from `GetServerStatus` calls were
  present and expected — the documented harness caveat from the tile-grid
  entry above, unrelated to this change). Confirmed via computed styles rather
  than a screenshot (the pane's compositor wasn't available in this session):
  `--border-hairline` resolves to exactly `0.5px`; `border-right-width` etc.
  report `1px` under `getComputedStyle` at `devicePixelRatio: 1`, which an
  existing pre-migration `border-b-[0.5px]` literal elsewhere in the same page
  does too — confirmed as Chrome's standing sub-pixel-border rounding, not a
  regression, before trusting the rest of the pass. All four App.tsx dividers
  landed on the correct edge (`border-r-hairline` on `<aside>`,
  `border-b-hairline` on the header and the `ServerSelector` wrapper,
  `border-t-hairline` above `LayoutPresets`). Toggled `data-theme="light"` and
  confirmed the border color re-themed (`rgba(0,0,0,0.09)` vs. the dark theme's
  white-based value) while `--accent` held constant, the same theme-dependent
  check that caught the neighbouring `--panel-bg` bug.

---

### 2026-08-17 — Last three data polls closed, and a checklist claim that was wrong

Closes **P1 — Remaining `useEffect` polls that have events available**. Two of the
three were what the checklist described. The third was not, and acting on the
description as written would have shipped a visible bug.

**⚠️ The checklist was wrong about the stats tile.** It read: `tiles/stats/index.tsx`
"polls `GetServerStatus` while `stats:snapshot` is pushed by a 10s Go ticker — **a
straight duplicate**". Three things falsify that, each independently sufficient:

- `models.StatsSnapshot` carries Timestamp/TPS/RAM/CPU/Players. It has **no**
  `Running`, `Uptime` or `MaxPlayers` — and the tile renders all three (the
  online/offline dot, the uptime readout, `players / maxPlayers`).
- `stats.go`'s ticker opened with `if !s.server.IsRunning() { continue }`, so
  `stats:snapshot` **never fires while the server is stopped**. An event that is
  silent precisely when the server goes down cannot be the thing that tells the UI
  the server went down.
- `setStatus` had exactly one caller in the whole tree — that poll. It was the sole
  writer of `useServerStore.status`, not a redundant second one.

Deleting the poll as described would have frozen the tile on its last-known Online
state forever. Worth stating plainly because the item had sat in the backlog reading
as a quick win: **the claim was checked before it was acted on, and it did not
survive the check.** The two-minute grep that found it (`setStatus` call sites, then
the two struct definitions side by side) is the cheap habit worth repeating.

- ✅ **New `server:status` event** (`events.go`, `stats.go`). Emitted every tick from
  the existing ticker, above the running guard, carrying the full
  `models.ServerStatus` built from the same seven accessors `GetServerStatus()` uses
  — so the pushed payload and the fetched one cannot drift. History recording stays
  gated below the guard, unchanged.
- **Why a new event instead of extending `stats:snapshot`.** Ungating the existing
  emit was the smaller diff and was rejected: `usePerformanceHistory.ts` would start
  charting zero rows while offline, `GetStatsHistory`'s 1-hour buffer would fill with
  them, and `scheduler_triggers.go:64` subscribes to that event — an ungated emit
  could fire scheduler triggers against a stopped server. A separate event costs a
  dozen lines and touches none of it. Same shape as `EventScheduleNextRuns`, which
  replaced the 30s next-run poll.
- ✅ **`tiles/stats/useServerStatus.ts`** on the `usePlayers.ts` convention: one fetch
  on mount, then `server:status` for the push and `server:started`/`server:stopped`
  for an immediate refetch so a transition shows at once rather than up to a tick
  later. `index.tsx` lost its `poll` callback and interval; rendering is untouched.
- ✅ **`useBackups.ts` and `useMods.ts`**: polls deleted. These two *were* the
  safety-net duplicates the checklist described — verified by tracing every backend
  mutation path (`backup.go` 307/373/459, including the scheduler's
  `Backup().CreateBackup`; `modservice.go` 261/499/540/781/791 covering install,
  enable/disable and uninstall). The mount fetch already covered the remount case
  their comments cited. `useMods` also shed a now-unused `useRef` import.
  **Named cost:** a `.zip` or `.jar` dropped into the folder from outside the app is
  no longer picked up within 10s. Both hooks still return `refresh`.
- ✅ **Dead `GetPlayers` binding removed** (P2). It was byte-identical to
  `GetPlayerRoster` and unreferenced outside generated bindings. Unblocked by noticing
  the `wails` CLI *is* installed locally (v2.12.0) — the checklist had recorded it as
  unavailable, which was a cloud-sandbox limitation generalised too far. `wails
  generate module` produced exactly the one removal across `App.d.ts`/`App.js`,
  confirming the 83/83 sync the checklist claimed.

**Verification.** `stats.go`'s loop body was split into `tick()` so the 10s ticker is
not in the way of testing it, and `backend/services/stats_test.go` now pins the
behaviour the wrong claim would have broken: `server:status` fires while stopped with
`Running: false`, `Uptime: "0s"` and a non-zero `MaxPlayers`; `stats:snapshot` and the
history stay empty while stopped; both fire while running; and the pushed struct
equals a field-for-field rebuild of what `GetServerStatus()` returns, so adding a
field to only one side fails the test.

**These tests were mutation-checked rather than trusted.** Moving the running guard
back above the status emit — reproducing exactly the regression the checklist's
framing invited — turns
`TestTickEmitsServerStatusWhileStopped` red with "want 1 server:status while stopped,
got 0". A test for a subtle ordering property is worth nothing until it has been seen
to fail for the right reason.

Rest: `pnpm test` 280/280 across 27 files (9 new in `useServerStatus.test.ts`,
including a fake-timer `does not poll on an interval` assertion), typecheck, lint 0
errors, `format:check`, `check-bundle` 487.1 KB gzip against the 550 KB budget,
`gofmt`, `go vet`, `go test`, and a clean second `gen:tokens`. A repo-wide
`setInterval` grep leaves only `App.tsx:89`'s 150ms console-log batcher, which is
render batching rather than data fetching and was always out of scope.

**Not verified end to end against a live server.** A `wails dev` run came up against a
pre-existing dev instance already holding port 34115, so the bridge on offer was an
older build (83 bound methods, `GetPlayers` still present) — spotted before drawing
any conclusion from it. Rather than fight for the port, the behaviour went into the Go
tests above, which pin it harder than a manual poke would. What remains genuinely
unproven is the full offline → online → offline cycle against a real Minecraft server,
which needs a server jar and a JRE.

---

### 2026-08-17 — Backend test coverage, and a CI floor to hold it

Closes **P1 — Test-coverage follow-ups**, the last P1 on the checklist. Unlike the
polling item, this one's claims held up under checking: `go tool cover -func`
confirmed backup.go at 4/29 functions, config_editor.go at 1/11 and rcon.go at 4/6
exactly as recorded.

- ✅ **`backup_test.go`** — a `newBackupFixture` helper (temp dataDir, seeded
  `ConfigService`, zero-value `ServerService`) and seven tests over the
  orchestration: a full create → corrupt → restore round trip, a missing working
  directory, the refusal to restore while running, a traversing filename reaching
  `RestoreBackup`, world-vs-server resolution through `ListBackups`, the meta.json
  round trip including tag sanitising, and delete. **4/29 → 17/29.**
- ✅ **`config_editor_test.go`** — read/write round trip, the guard on both entry
  points, invalid JSON rejected *without* touching the file, non-JSON formats
  skipping validation, backup-on-overwrite versus none-for-new-file, and
  `pruneBackups` keeping exactly `backupKeep`. **1/11 → 6/11.**
- ✅ **`rcon_test.go`** — a `fakeRconServer` on an ephemeral loopback port speaking
  the real protocol via the existing `writePacket`/`readPacket` helpers, covering
  the happy path with colour stripping, a rejected password, a dead port, and a
  hang-up mid-auth. **4/6 → 6/6, the file is complete.**
- `config.go` picked up 0/11 → 5/11 for free, exercised by the fixtures.
- **Package coverage 31.2% → 36.7%.**

**Every load-bearing assertion was mutation-checked** rather than trusted, and one
of the four mutations found a bad test rather than confirming a good one:

| Mutation | Result |
|---|---|
| `sandbox`'s prefix check removed | caught |
| `WriteConfigFile`'s JSON validation skipped | caught |
| `RestoreBackup`'s running check removed | caught |
| `pruneBackups` off-by-one (keeps 4, not 3) | caught |

The first mutation exposed that `TestConfigFileGuardAppliesOnBothPaths` was passing
for the wrong reason: it aimed the traversal at a path that did not exist, so
`ReadConfigFile` errored from `os.ReadFile` whether or not the guard ran. Rewritten
to point at a file that genuinely exists outside the working directory and to assert
the file is still intact afterwards, it now fails on all three counts when the guard
goes. **A test that has never been seen to fail is a guess** — this is the second
time in two changes that running the mutation has paid for itself.

- ✅ **Coverage floor in CI**, `backend` job, set to **35%** — a little under the
  36.7% measured so an unrelated refactor does not redden the build, and commented
  as a ratchet. Scoped to `backend/services` rather than `./...` because the repo
  root and `backend/models` have no test files and would dilute the figure with
  packages the floor is not about.
- **The floor step nearly shipped broken, in a way that would have looked
  unrelated.** PowerShell splits an unquoted native-command argument on `=`, so
  `go tool cover -func=coverage.out` came back "too many arguments" and
  `go test -coverprofile=coverage.out` silently wrote its profile to a file named
  `coverage`. Both arguments are now quoted, with a comment saying why so nobody
  tidies the quotes away. Verified by running the step's script directly: exit 0
  at the 35% floor, exit 1 with the intended message at an impossible 95% floor —
  the gate is known to bite, not assumed to.

**Two findings recorded on the backlog rather than fixed here.** `sandbox` is a
purely lexical guard, so a symlink inside the working directory still resolves
outside it — left open by decision, since the user already owns the filesystem on a
local-first app, and noted with what a real fix would need. And config-editor
backups collide within a second: the `20060102_150405` stamp plus a truncating
`os.Create` means two saves in the same second leave one backup. That collision is
also why `pruneBackups` is driven directly in its test instead of through repeated
`WriteConfigFile` calls, which would have needed a sleep per copy.

**Verification:** `go test ./backend/services/ -count=2` (twice, to catch order
dependence between tests sharing temp dirs), `gofmt`, `go vet`, `go build`, and the
frontend gates unchanged at 280/280 with typecheck, lint and format clean.
**`-race` was not run**: it requires cgo and no gcc is present on this machine, and
no CI job runs it either. The RCON fake-server goroutines are the only new
concurrency, each bounded by `t.Cleanup` closing the listener, but that is an
argument for low risk rather than evidence of none.

---

### 2026-08-17 — The coverage floor, rebuilt to match the repo's own gate shape

A verification pass over the entry above found the floor was the right idea in the
wrong shape, and fixing it turned up a Go API that does not do what its name
suggests.

**The floor did not run where the repo says done is measured.** It had been written
as an inline PowerShell step in `ci.yml`, so it lived only in CI. But
`agent_docs/CLAUDE.md` names `/suite-kit:health` the definition of done and the
checklist calls `.claude/suite.json`'s set canonical — and the floor was in neither.
The whole local gate set could pass green while CI reddened. The repo already had a
precedent for exactly this kind of gate and it had not been followed:
`pnpm check-bundle` is a *script* owning a documented constant, named in
`suite.json` **and** CI. That is what a threshold gate looks like here.

**The obvious fix does not work, and the reason is worth writing down.** The first
attempt enforced the floor from a `TestMain` using `testing.Coverage()`, which would
have ridden the existing `go test` gate with no new command at all. It reported
**33.5%** where `go test -cover` reported **36.7%** for the same run. Not a rounding
difference: `testing.Coverage()` predates the Go 1.20 coverage redesign, and its own
doc comment says it "is not a replacement for the reports generated by
'go test -cover' and 'go tool cover'". A floor has to be measured the way the number
people quote is measured, or the gate and the docs disagree forever. Approach
abandoned before it was committed, on the strength of one comparison that took a
minute to run.

- ✅ **`scripts/coverage-floor/main.go`** now owns the threshold and the reasoning,
  mirroring `check-bundle-size.mjs`. It shells out to `go test -cover`, parses the
  authoritative `coverage: NN.N% of statements` line, and fails below 35%.
- ✅ Declared in **`.claude/suite.json`** as `coverage floor` and called from CI as
  `go run ./scripts/coverage-floor`. One implementation, both gates.
- The 33-line PowerShell step is gone, and with it the `=`-splitting hazard that had
  needed a comment telling people not to remove its quotes: PowerShell splits an
  unquoted native argument on `=`, so `go tool cover -func=x` answered "too many
  arguments" and `go test -coverprofile=x` wrote to a file called `coverage`. That
  step was also never testable here, because `pwsh` is not installed on this machine
  and only Windows PowerShell 5.1 was available. A Go program has no such gap.

**Verification.** The tool reports 36.7%, matching `go test -cover` exactly — the
comparison the `TestMain` approach failed. Raising the constant to 95% fails with
the intended message and exit 1; restoring it passes. With a test deliberately
broken, the output leads with `--- FAIL: TestExecuteHappyPath` and the tool says
"tests failed, coverage not judged" rather than rendering a coverage verdict, so a
red package never becomes ambiguous between a broken test and a dipped number.
`gofmt`, `go vet ./...`, `go build ./...` clean; `ci.yml` and `suite.json` both
parse and the new command matches `healthCommand` in the suite schema.
`scripts/validate-schemas.sh` could not run — `check-jsonschema` is not installed —
so that is a skip, not a pass.

### 2026-08-17 — The border-token sweep, and the invariant that now holds it

**Closed:** the `Open backlog` entry tracking `border-hairline`/`border-thick`
adoption, which had sat there recording a measurement instead of the work.

**What it said.** 8 token call sites (4 in the worlds tile, 4 in `App.tsx`)
against 166 literal `border-[0.5px]` occurrences over 164 lines in 41 files —
91 all-sides, 47 `-b`, 15 `-t`, 7 `-l`, 6 `-r`. The entry carried a note about
occurrences-vs-lines (two lines in `tiles/mods/InstalledPanel.tsx` carried two
each, so `grep -c` read 164 and `grep -o` read 166) so a re-measure would quote
the same basis.

**What is true now.** Zero literals, 181 token call sites. Measured the same way:

```bash
grep -roE "border(-[a-z]+)?-\[0\.5px\]" src --include=*.tsx --include=*.ts | wc -l   # 0
grep -roE "border(-[trbl])?-(hairline|thick)" src --include=*.tsx --include=*.ts | wc -l  # 181
```

The sweep landed in `9ad697a` ("Adopt the hairline and thick border tokens across
the UI"). It was a find-and-replace, as the entry predicted — the directional
utilities added when Milestone 2 closed were the thing that had blocked it.

**Why the entry survived the work.** `3037182` ("Fail the health check on a new
literal border width") added the `no literal border widths` invariant to
`.claude/suite.json`, so a new literal is now caught mechanically rather than by
someone re-reading the checklist. The backlog entry was then describing work that
was both done and guarded, and its numbers had inverted — 166 literals against 8
token call sites had become 0 against 181. This is the failure mode the checklist's
own header warns about: it is a target, not a snapshot, and a precise measurement
inside it goes stale the moment the work lands. Measurements belong here.

The invariant is deliberately scoped to borders. `text-[Npx]`, `rounded-[Npx]` and
the remaining arbitrary sizing literals are separate sweeps that have not run —
118 hex literals and 183 arbitrary px values across 48 files under
`frontend/src/components` and `frontend/src/tiles` as of this entry — so a broader
pattern would have been red on arrival and would have taught everyone to ignore it.

**Verification.** The two greps above, run from `frontend/`. The invariant itself
is declared in `.claude/suite.json` and read by `/suite-kit:health`; note that
until the runner is vendored and wired into CI, nothing runs it automatically —
tracked in kollektiv's `docs/roadmap.md` § Enforcement.

### 2026-08-18 — The dead `--panel-bg`, and why the recorded fix was wrong

**Closed:** the `Open backlog` entry for `tiles/config/form/widgets.tsx`'s
`Select` dropdown, which painted itself with a literal `bg-[#0e1117]` — the
always-used fallback of a `--panel-bg` variable defined nowhere in the repo.
Under the **light** skin that rendered a near-black panel behind near-black text.

**The recorded remediation was wrong, and checking it is what showed that.** The
entry said to repoint the dropdown at `bg-elevated`. But `bg-elevated` carries
`alpha: 0.82` in *both* skins, so the dropdown would have gone translucent over
the form it exists to cover — a different bug, and a subtler one. Every surface
token in the set was either translucent or the page background itself, so there
was nothing correct to point at. This was a token to add, not a call site to
repair.

**What landed.** `bg-overlay` was added upstream in `kollektiv/design/tokens.json`
— the opaque surface *of* a floating layer, not the dimming scrim *behind* a
modal. Its values are derived rather than picked: `bg-elevated` composited over
`bg-base`, which is the colour an elevated panel already resolves to when it sits
on the app background. Dark `#10111a`, light `#eeeff6`. The shipping `#0e1117`
sat `(-2, 0, -3)` from the computed dark value, which is simultaneously evidence
the literal always meant "opaque elevated surface" and the reason not to enshrine
it: nobody could re-derive that number.

Three things were needed here beyond vendoring it:

- `frontend/scripts/gen-tokens.mjs` gained a `UTILITY_ALIAS` entry. Without it
  `bg-overlay` fell through to its raw name and generated `--color-bg-overlay`,
  so the utility would have been `bg-bg-overlay` while every sibling reads
  `bg-elevated`, `bg-canvas`, `bg-surface`. The alias map is where a token name
  becomes a Tailwind utility name, and a new token is not automatically in it.
- The dropdown now uses `bg-overlay`.
- `tiles/performance/charts.tsx` carried the **same** literal twice, in recharts
  `contentStyle` props, alongside a hardcoded `rgba(255,255,255,0.12)` border and
  `#fff` text. Same defect, same skin breakage, and not named in the backlog
  entry — found by grepping for the literal rather than for the file. Those are
  inline styles because recharts takes CSS objects, not classes, so they now read
  `var(--bg-overlay)`, `var(--border-hover)` and `var(--text-primary)` and follow
  the skin like everything else.

**Verification.** `grep -rn "0e1117" frontend/src` returns nothing. `pnpm
gen:tokens` leaves a clean diff, so the generated layer matches the vendored
source. Full gate set green.

---

### 2026-08-18 — The website stops hand-copying the token layer

**Closed:** not a checklist item. Found while scoping `P2 — website/ has no gates
at all`, and worth fixing first because it is a correctness bug, not a missing gate.

**What was there.** `website/styles.css` opened with a `:root` block of 21 design
tokens under this comment:

> Design tokens — mirrors `frontend/src/style.css`'s dark theme + motion vocabulary
> exactly, so the site reads as the same product.

Two things wrong with that. `frontend/src/style.css` has not held tokens since the
generated layer landed, so the comment pointed at a file whose values had moved.
And "exactly" was already false: the site's `--font-mono` read

    ui-monospace, 'Cascadia Code', 'SF Mono', 'Segoe UI Mono', Consolas, monospace

while `tokens.source.json` carries `Liberation Mono` between `Consolas` and
`monospace`. **The mirror had drifted, silently, in the one direction nothing in
the repo was watching.** `.claude/suite.json`'s `tokens.paths` is
`frontend/src/components/**` + `frontend/src/tiles/**`, and its `generated` entry
diffed only the two frontend outputs, so nothing noticed that a third consumer of
the same token set existed at all. Two colours were hand-copied a second time
further down the sheet: `.btn-primary`'s `color: #05060a` and `.wf-star`'s
`color: #ffffff`.

kollektiv's rule is that a design value is defined in one place. The marketing site
was a third, unsynchronised consumer inside a repo that declares
`tokens.role: "consumer"`.

**What landed.** `frontend/scripts/gen-tokens.mjs` gained a third output,
`website/tokens.css`, linked by all six pages ahead of `/styles.css`. The trimmed
`:root` in `styles.css` now holds only what is genuinely not a token —
`--max-width`, `--nav-h`, `--section-y`. The two stray literals became
`var(--bg-base)` and `var(--text-primary)`.

**The surprise: no new emit shape was needed.** The website wants space-separated
channel triplets so `rgb(var(--accent-rgb) / 0.3)` can vary alpha from one token —
and `emitCss`'s `emitTheme` already writes exactly `--accent-rgb: 74 222 128;` plus
the `rgb(var())` alias. `channels()`, `css()`, `scalar()`, `fontStack()` and
`BANNER()` all produced the right shapes untouched. `emitWebsiteCss` is
`emitTheme(':root', 'dark')` minus the `@theme`/`@utility` scaffolding. Writing a
separate root-level generator would have meant duplicating six helpers and
`validate()` — recreating the hand-mirroring problem one level up.

Three deliberate limits, stated in a comment on the function so they are decisions
rather than omissions:

- **Dark only.** Nothing on the site sets `data-theme` and there is no switcher, so
  a `[data-theme='light']` block would be dead CSS that reads as if light mode
  worked. Adding one is a change to the generator, not a hand edit downstream.
- **Colours, font stacks and motion only.** Type sizes, radius, space and border
  widths are Tailwind-scale concerns the sheet has no vocabulary for; emitting them
  invites a call site to reach for a token the site does not otherwise speak.
- **`--bg-overlay`, `--success` and `--warning` are emitted despite being unused.**
  The generator emits the vocabulary, not an allowlist of today's usage — otherwise
  "which tokens?" becomes a second thing that can drift.

**`<link>`, not `@import`.** An `@import url('/tokens.css')` would be impossible to
forget on a new page, which is a real advantage. It was rejected anyway: the
preload scanner does not look inside CSS, so `tokens.css` would only be discovered
after `styles.css` (64 KB) had been fetched and parsed — an extra round trip
blocking first paint on every page of a marketing site. The failure mode `@import`
prevents is catchable mechanically; the round trip is not recoverable. Generating
into `styles.css` between markers was also rejected: a hand-edited file with a
generated region makes `git status --porcelain -- website/styles.css` flag every
legitimate hand edit as a generator failure.

`BANNER`'s closing line changed from ``then `pnpm gen:tokens` here`` to ``then
`pnpm gen:tokens` from `frontend/` `` — "here" is ambiguous in a banner that now
also heads a file under `website/`. That is the only diff in the two frontend
outputs.

**Verification.** The site was served from a clean checkout of `HEAD` and from the
working tree side by side, and every custom property resolved on
`document.documentElement` was compared across the two:

- **28 identical, 0 removed.**
- **5 added**, all unused vocabulary: `--bg-overlay`, `--success`, `--success-rgb`,
  `--warning`, `--warning-rgb`.
- **4 changed, all font stacks.** `--font-mono` gained `'Liberation Mono'` — the
  drift, corrected. The other three differ only in that `Roboto`, `Arial` and
  `Consolas` are now quoted, which is identical CSS: a quoted `<string>` family
  name and an unquoted `<custom-ident>` resolve to the same family.

So the one real change on the deployed site is a Linux-only monospace fallback
sitting behind five higher-priority families. `.btn-primary` still computes
`rgb(5, 6, 10)` and `.wf-star` still computes `rgb(255, 255, 255)`. All six pages
serve both sheets in order. `grep -nE '#[0-9a-fA-F]{6}' website/styles.css` returns
only the `#000` mask/compositing literals in `linear-gradient(#000 0 0)` and the two
`mask-image` fades, which are compositing black rather than a theme colour.

A whole-document computed-style diff was attempted first and abandoned: `backdrop.js`
generates a random number of star elements per load (46 in one run), so element
counts do not match between two loads of the *same* build. The custom-property table
is the honest comparison, because it is the complete surface of what changed.

**Accepted exception.** `<meta name="theme-color" content="#05060a">` in all six
`<head>`s stays a literal. A meta attribute cannot read a CSS variable.

**Held by.** `.claude/suite.json`'s existing `generated` entry gained
`website/tokens.css` rather than getting a second entry — same generator, same
command, one definition of "the token layer is in sync". CI's `invariants` job picks
that up for free through `--section generated`; the `frontend` job's explicit
`git diff --exit-code` step was extended with `../website/tokens.css` to match.

---

### 2026-08-18 — website/ gets its first gates

**Closes:** `P2 — website/ has no gates at all`, the largest un-gated surface in
the repo.

**What it said, and what it actually meant.** The entry recorded ~4,600 lines of
HTML/CSS/JS with no lint, no formatter and no CI job. It is now 6,028 lines, and
"no gates" was exact rather than approximate. Every existing check missed it *by
construction*, not by oversight:

- `pnpm format:check` is `prettier --check .`, and every call site — CI's
  `working-directory: frontend`, `suite.json`'s `"cwd": "frontend"`, lefthook's
  `root: "frontend/"` — resolves `.` to `frontend/`. `website/` is a sibling.
- `pnpm lint` is `eslint src`, and `eslint.config.js` globs `**/*.{ts,tsx}`. The
  site's six modules are plain `.js`, so they would match zero config blocks even
  if the script were pointed at them.
- No workflow had a `website` job, and none had a `paths:` filter either, so a
  website-only PR ran four jobs that never opened one of its files.

**The question the entry demanded be answered first**, quoted: *"Decide first
whether it belongs in this repo's CI at all, or in the Pages deploy — don't bolt
a job on without that call."*

Answer: **this repo's CI.** Cloudflare Pages watches the branch and is configured
outside this repo — there is no deploy workflow here, no `wrangler.toml`, no
`_headers`, nothing to hang a check off on the deploy side. Three separate files
already state this in prose (`.github/release.yml`, `.github/scripts/release-notes.py`
twice, and the checklist entry itself). So a pre-merge job is not the second-best
place for the gate; it is the only place one can exist. It cannot block a bad deploy
directly, but everything lands via PR, which makes it a real gate in practice.

**Prettier: one version, two configs.** `website/.prettierrc.json` is byte-identical
to `frontend/.prettierrc.json` except that it drops
`"plugins": ["prettier-plugin-tailwindcss"]`. That one-line delta is the whole
statement — same house style, no `class` sorting, because the site is not Tailwind
and the plugin would reorder its `class` attributes against a config it cannot find.
Prettier resolves config by walking up from each file, so `website/.prettierrc.json`
is the nearest ancestor for every site file and the frontend's is never consulted;
confirmed with `--find-config-path`.

Prettier itself stays a `frontend` devDependency and is invoked as
`prettier --check ../website` from there. Two behaviours were verified rather than
assumed, and both shape the command:

- **The target must be the bare directory, never a brace glob.** A glob naming
  `*.xml` makes Prettier exit non-zero on `sitemap.xml` with
  `No parser could be inferred`; a directory makes it silently skip every extension
  it has no parser for (`.xml`, `.txt`, `.woff2`, `.png`, `.svg`).
- **`--ignore-path ../website/.prettierignore` is mandatory, not tidiness.** Ignore
  patterns resolve relative to the ignore file's own directory, so without the flag
  Prettier reads `frontend/.prettierignore`, whose entries match nothing under
  `website/`, and the generated `website/tokens.css` is reported dirty. With the
  flag the file count drops from 9 to 8. The ignore entry exists because Prettier
  wants to rewrap that file's two long font stacks, which the next `gen:tokens` run
  would revert — the same reasoning as the token entries in
  `frontend/.prettierignore`.

**The reformat, measured.** 8 of 13 formattable files, **238 insertions and 234
deletions**; `changelog.js`, `download.js`, `main.js`, `markdown.js` and `release.js`
were already clean. `index.html` accounts for 198/197 of it. An earlier estimate of
488 lines was taken before `0a5b519` landed and is not what this PR carries.

It is provably whitespace-only. For each of the six pages, the tag sequence, the
full attribute set and the visible text were extracted before and after and
compared: **identical on all three, on all six pages** (730 tags and 906 attributes
in `index.html` alone). The only two non-HTML changes are a line-join in
`backdrop.js` — evidence that file had previously been formatted at width 80 — and
one stray blank line before a closing brace in `styles.css`.

**The link checker.** `scripts/check-website-links.mjs`, zero dependencies, no
network, following `scripts/coverage-floor`'s precedent of a self-contained
root-level script declared in `suite.json` and called from CI. Five rules: internal
`href`/`src` (plus the `og:`/`twitter:` meta URLs) resolve to a file; `#fragments`
resolve to an `id` on the page they point at; CSS `url()` resolves; `sitemap.xml`
resolves in both directions; and every page links both required stylesheets.

**It parses `.html`, `.css` and `sitemap.xml` only — never a `.js` file.** That one
decision is what makes the href rule safe: `markdown.js` builds its anchor tags by
string concatenation and `download.js` assembles release asset URLs from the GitHub
API, so a JS-aware pass would have to guess which string fragments compose into a
URL and would be wrong in both directions. It does not look. `<!-- -->` comments and
`<script>` bodies are stripped before scanning, which removes that class of false
positive permanently rather than relying on today's markup.

The sitemap's reverse direction is the valuable half — it catches a page that
shipped without anyone touching `sitemap.xml`. A page opts out by declaring
`<meta name="robots" content="noindex">`, derived from the page itself rather than
a hardcoded allowlist, so the exemption cannot go stale. `404.html` is the only page
that uses it, and it does so correctly.

Not checked, stated in the file header so each reads as a decision rather than an
omission: anything a `.js` file builds at runtime, external URLs (fetching makes a
flaky job, and a dead third-party link is not a build failure), unreferenced assets,
duplicate ids, orphan pages, and whether a page renders.

**Verification.** The checker is green on arrival: 6 pages, 176 internal references,
3 CSS assets, sitemap in sync. Green on arrival is worth little on its own, so each
rule was then broken in turn and the tree restored — a bad `href`, a bad
`#fragment`, a renamed `woff2`, a page dropped from the sitemap, a `<loc>` pointing
at a missing page, and a page missing `/tokens.css`. All six exit 1 with a message
naming the file and the reference. Full gate set green afterwards, zero skips.

**Wiring.** `suite.json` gains `website format` and `website links` under `commands`.
The first declares `pnpm` with `cwd: frontend`, so `suite-check.py`'s `runnable()`
probe finds `frontend/package.json` immediately and an absent `node_modules` becomes
an honest SKIP rather than a failure. The second has no `cwd` and is spelled
`node scripts/...` rather than `./scripts/...`: `node` is not in `PROJECT_MANIFESTS`,
so it gets a PATH probe only, and the path form would take the `os.path.isfile`
branch and need a shebang plus an exec bit Windows does not carry.

CI gets a named `website` job rather than two steps bolted onto `frontend`. The
backlog item is literally "no CI job", so a `website` entry in the PR status list is
the visible closure, and a site failure should not surface as "frontend failed". No
`paths:` filter: no job in this workflow has one, and path-filtered required checks
are the classic stuck-pending trap. lefthook gets a matching `website format` job so
the site is fixed locally the way `frontend/` is; it calls
`node ../frontend/node_modules/prettier/bin/prettier.cjs` directly because the repo
root has only lefthook in `node_modules`, and `pnpm --dir frontend exec` would change
cwd and break `{staged_files}`.

**Also corrected here.** The Stable pillar's CI item listed `frontend`, `backend` and
`backend-linux` and had never mentioned the `invariants` job added in `f06ee2c`. It
now names all five.

---

### 2026-08-18 — Backup filenames that were not unique, and an id that was not random

**Closes:** the `Config-editor backups collide within a second` bullet under
`P2 — Cleanups`. The larger half of this entry was not on the checklist at all: it
was found by chasing a CI failure.

**How it surfaced.** The `backend` job on windows-latest failed on PR #85, a
website-only change that touches no Go:

```
--- FAIL: TestWorldAndServerBackupsResolveSeparately
    backup_test.go:248: world backup = {Kind:"server" World:""}, want {world, world}
```

A server backup and a world backup had collapsed onto one filename, so the map keyed
by filename held the server backup under both names. The obvious reading is a flaky
test. It was not.

**The defect.** `shortID()` built a fresh `rand.Source` on every call:

```go
src := rand.NewSource(time.Now().UnixNano())
r := rand.New(src) //nolint:gosec
return fmt.Sprintf("%05d", r.Intn(100000))
```

Windows' clock granularity is coarse enough that two consecutive calls read the
identical `UnixNano`, and two generators seeded identically return the identical first
number. Measured on Windows 11 over 100,000 back-to-back pairs: **99.01% identical
ids, against 0.001% expected by chance**, with the identical-seed rate matching at
99.01%. The id was not random. It was a function of the clock, which is the one thing
it needed not to be, because the rest of the filename is a one-second timestamp.

The regression test states it in-repo rather than in prose: against the old
implementation, 1,000 draws produced **24 distinct ids and 976 consecutive repeats**.

**Why it is data loss, not a flaky test.** Backup filenames are
`{5-digit-id}_{DD_MM_YY_HHMMSS}.zip`, and `zipDirWithProgress` opened the destination
with `os.Create`, which truncates. Two backups taken in the same second with the same
id therefore produced one file: the second archive silently overwrote the first. Take
a server backup and then a world backup, and the server backup is gone. The failing
CI test was that scenario, caught by accident.

**What landed.** Two independent layers, because the first one alone is a probability
and the consequence is losing a user's backup.

- `shortID()` now uses `math/rand/v2`'s top-level `rand.IntN`, which the runtime seeds
  and which is safe for concurrent use. There is no seed left for a coarse clock to
  poison. The `//nolint:gosec` went with it.
- `reserveBackupFile` creates the archive with `O_CREATE|O_EXCL` and retries with a
  fresh id if the name is taken, so a collision costs a loop iteration instead of a
  backup. `zipDirWithProgress` now takes that already-open `*os.File` rather than a
  path, which is what makes reserving the name and writing to it race-free.

Both callers also now close the file before `os.Stat`, so the recorded size is the
finished archive's, and a close error fails the backup instead of being dropped: a
close error on a zip means a missing central directory, which is a corrupt archive.
A failed zip removes the partial file rather than leaving it to be listed.

**The sibling defect, fixed with it.** The checklist already recorded that
`ConfigEditorService.backup()` had the same shape: a `{escaped}.{20060102_150405}.bak`
stamp at one-second resolution written with `os.Create`. Four rapid saves left **one**
backup rather than three, which the new test reproduces against the old code exactly.
It now stamps milliseconds and creates with `O_EXCL`.

The millisecond field is joined with an underscore rather than a dot, and that detail
is load-bearing. `pruneBackups` deletes the lexicographically first name, relying on
the stamp sorting in chronological order. `'.'` is 0x2E and `'_'` is 0x5F, so a legacy
`…150405.bak` still sorts before a new `…150405_123.bak` from the same second and is
still pruned first. Had it been `.123`, the new name would have sorted *first* and
pruning would have started deleting the newest backups. There is a test pinning that
ordering, since it is invisible in review.

**A bug in the fix, caught by its own test.** The first attempt spelled the stamp
`time.Now().Format("20060102_150405_000")`. Go's fractional-second layout is `.000` or
`,000`; a `_000` is not a directive and formats as the literal text `000`. So every
name inside a second was identical, `O_EXCL` rejected all 100 attempts, and the save
failed outright. `TestRapidSavesEachKeepTheirOwnBackup` caught it immediately. The
milliseconds are now appended by hand, and the reason is recorded next to the code.

**Verification.** Every new test was run against the pre-fix implementation and
observed to fail:

| test | against the old code |
|---|---|
| `TestShortIDDoesNotRepeatOnConsecutiveCalls` | 976 repeats in 1,000 draws, 24 distinct ids |
| `TestReserveBackupFileNeverTruncatesAnExistingFile` | returned the same name twice |
| `TestRapidSavesEachKeepTheirOwnBackup` | four saves left 1 backup, want 3 |

Worth recording honestly: `TestWorldAndServerBackupsResolveSeparately`, the test that
actually failed in CI, still passes locally against the old code, 40 runs in a row. The
zip work between the two `shortID()` calls lets the clock advance on this machine,
while CI's smaller fixture fits both calls inside one timer tick. That is exactly why
the new tests target `shortID` and `reserveBackupFile` directly instead: an end-to-end
test of this defect is only as reliable as the host's timer, and the unit-level ones
fail deterministically everywhere.

Full gate set green, zero skips.

---

### 2026-08-18 — The three error-ignores at the repo root, and the one directory everything persisted through

**Closes:** `P2 — Undocumented blank error-ignores`. Two of the three sites were
documentation. The third was not, and chasing why it was safe is most of this entry.

**Where the three were.** The 2026 sweep documented 28 blank `_ =` sites across
`backend/services` and reported clean, because its audit grep was scoped to
`backend --include="*.go"`. `app.go` and the other repo-root files were never in
range. Re-running it as the checklist now spells it — `grep -rn "_ = "
--include=*.go app.go backend/ | grep -v nolint` — left exactly three:

| site | verdict |
|---|---|
| `beforeClose`: `_ = a.serverService.Stop()` | safe, documented |
| `startup`: `_ = os.MkdirAll(a.dataDir, 0755)` | **not safe as written** |
| `DownloadAndInstallUpdate`: `_ = exec.Command(exePath).Start()` | safe, documented |

`Stop()` has exactly one error return, `"server not running"`, and the call site
already guards on `IsRunning()`. A race there can only make that error true, which is
the benign direction; every failure that actually matters — the process ignoring the
RCON `stop` — is handled *inside* `Stop` by the 8-second timeout and `killTree`, not
reported back. The post-update relaunch is a convenience: the new binary is already
on disk, this process has to exit either way for the swap to take effect, and the
frontend is a moment from being torn down by the `runtime.Quit` on the next line, so
there is nobody left to tell. Both now carry the reason in a `//nolint:errcheck`
comment.

**The third one was load-bearing.** `startup` creates the Wails app data directory
and drops the error. Ten files are then written straight into that directory by five
different owners:

- `ConfigService` — `servers.json`, `active_server.json`, `app_settings.json`
- `SchedulerService` — `scheduler.json`, `scheduler-history.json`
- `App` itself — `layout_presets.json`, `active_tiles.json`, `active_layout.json`,
  `custom_commands.json`, `command_buttons.json`

Every one used a bare `os.WriteFile`, and **none** of them created the directory.
That single discarded `MkdirAll` was the only thing standing between the app and an
`ENOENT` on the server list, the active server, app settings, the tile layout and its
presets, custom commands, command buttons, and the whole scheduler. The
services that write *per-server* data — `backup.go`, `config_editor.go`,
`modservice.go` — already `MkdirAll` their own destination before writing. The
app-data writers were the ones that never did.

Worth being precise about the failure, because "MkdirAll can fail" sounds theoretical.
`os.UserConfigDir()` has already succeeded by that line, so the parent exists; what is
left is a permissions failure, a full disk, or something non-directory sitting at
`konnekt`. In any of those the app comes up looking *normal* — the reads return
`os.IsNotExist` and each getter answers with its empty/default value, so the user sees
a fresh install with their servers gone — and then every save fails with an error
naming a file rather than the directory that is actually missing.

**What landed.** One helper, `services.WriteDataFile(dir, name, data)`, now owns every
write into the app data directory. It creates the directory first, so each writer is
self-sufficient in the way the per-server ones already were, and it wraps both
failures with context so the error names the directory it could not create rather
than the file it could not open. That is what makes the startup `MkdirAll`'s new
`//nolint` reason *true* rather than wishful: it is a warm-up so the directory exists
before the user goes looking for it, and a failure there costs nothing a later save
would not report better.

The helper also refuses an empty `dir` instead of joining onto it. `filepath.Join("",
name)` is a **relative** path, so the old code silently wrote the file into the
process's working directory — in the shipped app, wherever the user launched Konnekt
from. `scheduler_nextrun_test.go` already knew: it set a temp `dataDir` with the
comment *"Without this, writeGraphs joins onto `""` and litters scheduler.json into
the package directory."* A per-test workaround for a hazard that belonged in the
writer. That comment now records the behaviour instead of the workaround.

**Tests.** `ConfigService` had no test file at all, despite owning the server list and
app settings. It has one now, and both new files were run against the pre-fix
implementation:

| test | against the old code |
|---|---|
| `TestWriteDataFileCreatesAMissingDataDir` | `ENOENT` on `servers.json` |
| `TestWriteDataFileCreatesNestedParents` | `ENOENT` on `app_settings.json` |
| `TestWriteDataFileRejectsAnUnsetDataDir` | no error, and `scheduler.json` in the cwd |
| `TestServerConfigsRoundTripThroughAMissingDataDir` | `ENOENT` on save |
| `TestSaveServerConfigUpsertsByID` | `ENOENT` on save |
| `TestDeleteServerConfigLeavesTheOthers` | `ENOENT` on save |
| `TestActiveServerIDRoundTripsThroughAMissingDataDir` | `ENOENT` on save |
| `TestAppSettingsFallBackToDefaultsThenRoundTrip` | `ENOENT` on save |
| `TestAppSettingsFillGapsInAnOlderFileWithDefaults` | `ENOENT` on setup |

Recorded honestly: two of the new cases pass against the old code as well.
`TestWriteDataFileOverwritesAnExistingFile` pins behaviour the change deliberately
did not alter, and `TestWriteDataFileErrorNamesTheDirectoryItCouldNotCreate` passes
either way because `os.WriteFile`'s `ENOTDIR` happens to contain the directory as a
path prefix. They earn their place as regression pins, not as proof of the fix.

`TestAppSettingsFillGapsInAnOlderFileWithDefaults` is the one unrelated to the data
directory: `GetAppSettings` unmarshals *onto* a populated defaults struct, so a
settings file written by an older build gets defaults for the keys it lacks rather
than Go zero values. A zero `ConsoleBufferLines` would hand the console tile a
0-line buffer. That behaviour was untested and is easy to break by refactoring the
function into a plain `json.Unmarshal`.

**Coverage.** `backend/services` moved 36.7% → **38.0%**, and the floor ratchets
35% → **36%** to hold it. The floor's comment now carries the measurement history
rather than a single stale figure.

**Verification.** Full `/suite-kit:health` gate set green, 12/12, zero skips.

---

### 2026-08-19 — The dead code the per-file grep could never find

**Closed:** the Clean pillar's "No obviously dead code (unused exports,
unreachable branches, orphaned files) left behind after refactors", plus the
Clean pillar's `frontend/wailsjs/` hand-edit check, which had simply never been
run.

**Why it had stayed open.** The item prescribed its own blind spot: *"for each
file the last refactor touched, `grep -rn "<exported name>" src`."* That finds
what you already suspect. It cannot find a file whose name nobody remembers,
which is precisely what two of the ten findings were — `worlds/scene/WorldSystem.tsx`
and `worlds/scene/useParallax.ts`, each two lines long, each a comment announcing
its own supersession followed by `export {}`. Both carried an mtime months behind
every sibling in `scene/`. Nothing pointed at them, so nothing would ever grep
for them. The verify step is rewritten in the checklist to sweep the whole tree
from both ends instead.

**What the sweep actually was.** Go: `deadcode ./...` and
`staticcheck -checks=U1000 ./...`, each under both `GOOS=linux` and
`GOOS=windows` — either alone lies, because `staticcheck` on linux reports
`server.go:94: field job is unused` and `job` is read four times in
`server_windows.go`. Frontend: the import graph, listing files nothing imports,
plus a reference count for all 238 exports across all 154 files. That last number
needs care. 18 exports had zero references outside their own file, and 14 of them
are live — the props-interface-beside-its-component convention produces exactly
that signature. Dead means zero references *including* its own file. ESLint
already covers what it structurally can (`no-unreachable` and `no-unused-vars`
are on via `js.configs.recommended` and were clean), which is why every finding
here is a whole export or a whole file.

**The ten, and what each one cost.**

| Site | Verdict |
|---|---|
| `worlds/scene/WorldSystem.tsx` | tombstone, deleted |
| `worlds/scene/useParallax.ts` | tombstone, deleted |
| `hooks/useWailsCall.ts` | deleted, docs amended — see below |
| `lib/constants.ts` `DEFAULT_SERVER_ID` | one grep hit in the whole repo: its own declaration |
| `tiles/backups/focusLayout.ts` `FOCUS_FADED_OPACITY` | its import-removal is written down at HEALTH_LOG.md:451; the export outlived it |
| `styles/tokens.ts` `CONFIGURABLE_STATUS_ROLES` + `ConfigurableStatusRole` | generated — fixed at source |
| `backend/services/backup.go` `rootBackupDir` | unreachable per both analyzers, and its doc comment still named two callers |
| `backend/services/scheduler_triggers.go` `fireEventTriggers` | unreachable; its replacement's doc comment defined itself against it |
| `backend/services/update.go` `ErrUpdatePermission` | **not** dead — see below |

**`useWailsCall` was the only one with a decision attached.** It was not dead by
accident. `agent_docs/CLAUDE.md` named it the convention ("Handle errors in
frontend with a shared `useWailsCall()` hook") and `ROADMAP.md:46` marked it
shipped, but the codebase went somewhere else: fetching migrated into Zustand
stores and per-tile hooks, and a store cannot call a React hook — a constraint
`useSchedulerStore.ts:24` had already written down, while still deferring to
CLAUDE.md's nomination. So the primitive was built, the architecture moved, and
the docs kept describing the plan. Deleting 35 unused lines is the small half of
this; the real repair is that CLAUDE.md's IPC section now describes the
convention the code actually follows — per-store/per-hook `loading`/`error`
state, write actions rethrowing so an optimistic UI can revert — and names the
bare `catch {}` as the thing to avoid. `ROADMAP.md:46` is reworded rather than
unticked: typed IPC error handling did ship, just not in that shape.

**Two more documentation lies fell out of the same sweep.** `ROADMAP.md:130`
still described L0 of the worlds tile as "cursor parallax (useParallax lerps
group rotation from pointer)" — a behaviour whose implementation had been a
two-line tombstone for months; the per-planet proximity push in `Planet.tsx`'s
`useFrame` replaced it. And `useSchedulerStore.ts:24`'s comment pointed at a
CLAUDE.md line that no longer exists. Deleting code without reading what claims
it is live leaves the docs lying, so both were corrected in the same change.

**`ErrUpdatePermission` is the one that should not be deleted.** It looks dead —
produced at `update.go:261`, matched by no `errors.Is` anywhere — but its text is
interpolated into the error the user reads, so removing it removes a message.
The real defect is that its doc comment asserted a caller contract ("Callers
should fall back to opening the release page") that nothing implements, and
structurally cannot: the only consumer is the frontend, across the Wails IPC
boundary, where a Go sentinel arrives as a plain string. The comment now says
that, and closing the contract properly is tracked in the checklist as
"P2 — An error sentinel with no caller".

**The generated pair needed fixing at the generator.** `CONFIGURABLE_STATUS_ROLES`
and `ConfigurableStatusRole` live in `frontend/src/styles/tokens.ts`, which opens
`GENERATED FILE — DO NOT EDIT` and is diffed by the suite's `generated` gate, so a
hand edit would be reverted by the next `pnpm gen:tokens` *and* turn that gate
red. They came from a hardcoded template literal at `gen-tokens.mjs:373`/`:377`,
not from a value in `tokens.source.json`, so the fix landed here rather than
upstream: the two lines and the `configurable` filter that existed only to feed
them are gone, and the layer was regenerated. Worth recording why they can't be
adopted instead of removed: the four configurable roles are four separate
`accentColor`/`successColor`/`warningColor`/`dangerColor` fields on Go's
`AppSettings`, so a runtime array of role names has nothing to drive.

**The wailsjs box, closed by finally running it.** `wails generate module`
produced a byte-identical tree: 82/82 bound methods, every emitted struct. The
check needs the CLI version `go.mod` pins (v2.12.0) or the diff measures the
generator, not the repo — the checklist now says so. Running it also turned up a
gap the box does not cover, now tracked as "P2 — A Go model the bindings never
emit": `App.d.ts:94` references `models.ModUpdateInfo`, which `models.ts` never
declares, because Wails does not descend into a map value and `ModCheckUpdates`
is the only place that struct appears. `skipLibCheck` hides the dangling
reference and `useMods.ts:41-45` hand-copies the struct. Clean regeneration is
necessary, not sufficient.

**Verification.** `deadcode ./...` now prints nothing, and
`staticcheck -checks=U1000 ./...` prints only the known `job` false positive on
linux and nothing on windows. The frontend orphan sweep lists 27 test files,
`main.tsx` and `vite-env.d.ts` and nothing else; the export sweep is down to the
14 self-used exports described above. `backend/services` coverage moved 38.0% →
**38.1%** — deleting uncovered functions can only raise the ratio, so the floor
was left at 36%. Full gate set green, 12/12.

---

### 2026-08-19 — Another product's roadmap, and eight boxes nobody had ticked

**Closed:** the Clean pillar's docs-drift item, the Stable pillar's `EventsOn`
cleanup item, the Scalable pillar's dependency-currency item, and five more
whose verify commands had simply never been run. The checklist went from
15 ticked / 17 open to **28 ticked / 4 open**.

**`ROADMAP.md` was carrying a chunk of Kommands.** Its "Later" section listed
"More vanilla commands", `nbt_compound`/`block_state`/`loot_table` argument
types, "Version 2 support — likely 1.21.5, which flips three trait flags",
command import, permalinks and function-file export. Its "Explicitly out of
scope" section was Kommands' list entire, ending on:

> **Server integration.** Kommands generates text; it does not connect to a
> server.

in the roadmap of an application whose entire purpose is connecting to a
Minecraft server. Only the first bullet of "Later" (concurrent multi-server,
[#57](../../issues/57)) was Konnekt's.

This is worth naming as a *class* rather than a one-off. The suite shares a
design token source, a `suite.json` shape, a health-checklist format and a docs
layout across Konnekt and Kommands, and that sharing is mostly good. Prose
travelling with the structure is the cost. The checklist item said to read
CLAUDE.md's "Project structure" and its command table — both feature-adjacent
sections someone re-reads while shipping. The sections that actually rotted were
"Later", "Explicitly out of scope" and "Implementation notes", which nobody
opens during feature work. The verify step now says so.

"Later" keeps its one real item. "Explicitly out of scope" was rewritten to
record only decisions **already made elsewhere in this repo**, each with a
pointer — local-first with no cloud backend (`CLAUDE.md`), Rocky/RHEL 9
(`DEPENDENCIES.md` and the README), no second mobile frontend (the Remote access
section) — with a line saying the section records decisions rather than making
them. Inventing a scope boundary here would have been a worse failure than the
one being fixed.

Two smaller drifts in the same pass: CLAUDE.md's structure list named five
directories under `frontend/src/` and there are eight, omitting `styles/` — the
generated token layer, which the same file documents at length two sections
later. And `pnpm format:check` was undocumented despite being a canonical gate
in `.claude/suite.json`; `pnpm format` (the *write* variant) was listed in its
place, so a contributor reading CLAUDE.md would not have known the command CI
runs. ROADMAP's "Adding a tile" step 4c also said `backend/app.go`; `app.go` is
at the repo root.

**`EventsOn`: 25 registrations, 12 files, zero leaks.** Worth recording how the
check has to be written, because a naive one reports false leaks: three
spellings are in use — a single `let cleanup` handle, numbered `c1…c5` handles,
and an array drained in the cleanup, itself spelled two ways (`offs.push(...)`
in `ServerInstallModal.tsx`, an array literal in `useServerStatus.ts`). A first
pass here flagged both array sites purely because their `Array<() => void>` type
annotations broke the pattern matching the handle names. The property that
actually matters is that registration is synchronous inside every effect: no
`await` runs before a handle is captured, which is what rules out the
unmount-before-assignment leak. One asymmetry left alone and noted in the
checklist: `useServerStatus.ts` wraps its whole `forEach` in one `try`, so a
throwing first `off()` would skip the rest, where `ServerInstallModal.tsx` puts
the `try` inside the loop.

**Dependencies: nothing stale, two duplicates, both benign.** Everything is
behind by a patch or a minor, nothing by a major. `three`/`@types/three` are
single copies, so that incident stays closed. But `pnpm why` turns up **two
zustand versions** — 4.5.7 under `@xyflow/react` and under `tunnel-rat` (via
`@react-three/drei`), alongside the app's own 5.0.14 — and zustand is exactly
the library this project standardises on, so it reads alarming. It is not the
`three` failure. That one duplicated a *type* two packages had to agree on
structurally; these are private runtime stores nothing shares across the
boundary. Recorded in the checklist so the next reviewer re-confirms in a minute
instead of re-investigating. The dependency actually worth watching is
`wails/v2`, three minors behind at v2.12.0 — and note the `frontend/wailsjs/`
regeneration check has to run against whatever `go.mod` pins, or the diff
measures the generator rather than the repo.

**Five boxes were ticked purely by running what they already said to run:** 82/82
bound methods return `(T, error)`; the Job Object / RCON timeout / Modrinth
429-retry greps all still match; no store imports another store; all four direct
Go requires appear in `DEPENDENCIES.md`; `TileDefinition` is still
`{ id, label, icon, maximizable?, component }`; the 150ms console batcher is
still the only `setInterval` under `src/`; all five ring buffers still slice or
shift; the three Go tickers are still 10s, 60s and 15s. None of these needed
work. They needed someone to run the command, which is its own finding about how
the checklist gets used.

**The four left open, and why each is honestly open.** Motion tokens (real work,
re-scoped this session, partly gated on the upstream token source). The
`ModUpdateInfo` binding hole (filed as its own backlog entry). `ErrorBoundary`'s
offline-degradation half and the memoization profiling pass — both need a
running GUI, so a headless session cannot close them. Both now say so in the
checklist rather than sitting there looking merely neglected; the memoization
one in particular could be faked with a static "which subtrees lack
`React.memo`" list, and that would produce a list rather than the evidence the
item is asking for.

**Verification.** Full gate set green, 12/12.

### 2026-08-19 — The duration token Tailwind was never reading

**Closed:** most of the motion backlog entry. **Found on the way:** two defects
that were not in the backlog at all, and four claims in it that were wrong.

**`duration-fast` was a class that compiled to nothing.** The generated token
layer emits `--duration-fast`/`--duration-panel` into `tokens.css`'s `@theme`
block. Tailwind v4 does not read that namespace. Reading
`node_modules/tailwindcss/dist/lib.js` directly: `duration-*` resolves against
`--transition-duration-*` (then falls back to a bare integer, which is why
`duration-150` works), `delay-*` against `--transition-delay-*`, and `ease-*`
against `--ease-*`. Only the last one matches what the generator writes. So
`ease-standard` genuinely worked and its duration counterpart silently did not:
`.ease-standard{…}` was in the built CSS and `.duration-fast{` appeared nowhere
in it, even though `LayoutPresets.tsx:51` and `ConfigForm.tsx:33` both carry the
class and Tailwind had scanned both files.

Nothing looked broken, which is why this survived. Tailwind's own
`--default-transition-duration` is 150ms, exactly `--duration-fast`'s value, so
both sites animated at the right speed by coincidence, through a hardcoded
default rather than through the token. An upstream change to that value would
never have reached them.

The dangerous part was the checklist. It stated that "`duration-fast`/
`ease-standard` already work as utilities … so nothing new is needed", and on
that basis instructed the next session to convert `BrowsePanel.tsx`'s
`duration-[280ms]` to `duration-panel`. That conversion would have regressed the
panel from 280ms to 150ms, visibly, while reading as a cleanup. A wrong
checklist claim is worse than a missing one, because it is acted on.

**The fix is the shape `gen-tokens.mjs` already uses.** Border widths hit the
identical problem, and the generator's own comment says so: "Tailwind v4 has no
`--border-width-*` namespace, so these are plain custom properties surfaced as
utilities by the `@utility` rules below." Motion needed the same acknowledgement
in the form the duration API actually wants, so each duration is now emitted
twice from one source entry: `--duration-<name>` for hand-written CSS and inline
`transition:` strings, `--transition-duration-<name>` for Tailwind's utility
resolver. They cannot drift, because one loop writes both. `.duration-fast` and
`.duration-panel` are now in the built CSS, each reading its token. The
`--transition-delay-*` namespace is documented in the generated comment but not
emitted: nothing in the tree writes a `delay-*` utility, and `delay-fast` would
name a role ("delay by the fast duration") the source does not have.

**Then the adoptions that were finally safe.** Eight sites where the literal
already equalled a token, each verified by grepping the built CSS rather than by
eye: the mods panel slide and its resize handle, `TileWrapper`'s border fade,
`style.css`'s `.tile-outer` and resize handle, `Segmented.tsx`'s longhand copy of
`--ease-standard`, and two the previous analysis never found —
`scheduler.css:83`'s `150ms` node entrance and `:96`'s `280ms` edge draw-in,
which sat in plain hand CSS with nothing blocking them. The three
`duration-[220ms]` values in the backups tile became `duration-panel`, which is
the entry's own recommendation: they are one choreographed motion off a single
`panelOpen` flag, so the token keeps them in lockstep instead of three numbers
kept equal by hand. That is a real 220 → 280ms change and the only visual change
in the pass.

**The rest got decided rather than converted, which was the actual defect.** The
entry said as much itself — "undecided is the actual defect here" — about the
six `ease-[ease]` sites. They stay, with the reason written down: it is CSS's
plain `ease` keyword, `cubic-bezier(0.25, 0.1, 0.25, 1)`, a genuinely different
curve from `--ease-standard`, and Tailwind ships no bare `ease` utility, so the
escape hatch is the only spelling there is. `WorldsScene.tsx`'s 250ms HUD slide
also stays and now says why: it is hand-matched to the camera's exponential damp
(`MathUtils.damp` at lambda 4.5), which has no fixed duration to share a token
with, so rounding it to 280ms would desync the panel from the shot. Same for the
decorative sites — the springs, the float, the spin, the pulse, the splash.

**A fifth spelling, and why that keeps happening.** The previous session rewrote
this entry specifically to fix a one-grep undercount, and listed four spellings
as the complete set. There are five. `element.style.transition = '…'` has no
colon after the property name, so none of the four greps can see it, and it is
not obscure: `Dashboard.tsx` drives the entire tile maximise/minimise FLIP
through it across six lines, including a `cubic-bezier(0.4, 0, 1, 0.6)` that
appears nowhere else in the codebase and was undocumented until now. Two
consecutive "complete" grep sets have each missed one, so the checklist now says
to treat the list as a floor, and to chase symbolic constants to their literals —
`focusLayout.ts`'s `FOCUS_TRANSITION` hid a seventh site of the spring curve
behind a name, the same indirection the entry traced correctly for
`PANEL_DURATION` and not here.

**No invariant, deliberately.** A `suite.json` invariant is one regex that must
find nothing, with no judgement applied. That fits border widths, which have no
legitimate exceptions, and does not fit motion, where a decorative spin is
supposed to keep its literal forever. It would need a curated exclude list, and a
comment containing the matched text would be a permanent false failure. Red on
arrival is what the border invariant's own diagnosis warns against, so the
checklist records the preconditions instead of shipping a gate that fails.

**Two defects found that were not backlog items.** Both are recorded as P1 and
neither was touched here, because each is its own piece of work:

Four stores swallow a failed write and keep the optimistic update, against
CLAUDE.md's own IPC convention — `useServerConfigStore`, `useSettingsStore`,
`useLayoutStore`, `useTileStore`, while `useSchedulerStore` does it correctly and
its comment says the others do not. A failed `SaveServerConfig` shows the edit as
saved and it is gone on the next start. `useSettingsStore.test.ts:100` *asserts*
this behaviour, so the test encodes the bug and has to be fixed with the stores.

The console tile renders a literally empty panel when there are no lines, with
its command input still enabled and submissions failing into
`.catch(console.error)`. That is precisely the "blank panel" the Stable pillar's
`ErrorBoundary` item worries about, now pinned to a file. The players tile
renders an unreachable server identically to an empty one. And the assumption
that item carried — that closing it needs a GUI — is only half true: a jsdom
render against a rejecting mocked binding asserts the same thing, and the pattern
already exists in `useUpdateCheck.test.ts`.

**Four checklist claims corrected while the evidence was fresh.** The
`ErrUpdatePermission` entry named a swallow site on a path the sentinel cannot
reach; the real caller already renders a working "Open release page" fallback, so
the entry dropped to P3. The react-hooks entry said "~60 findings, mostly r3f
scene code"; measured, it is 50, and 47 of them are ordinary app logic — its
stated reason for deferring was backwards, and its gate ("once test coverage is
in place") cannot be met because the frontend has no coverage measurement at all.
The bindings entry proposed a `suite.json` invariant that cannot be one: it is a
set difference between two files, not a single-file regex, and it would be red on
arrival. And the `sandbox` entry gained the answer to the question it invites —
archive extraction is properly zip-slip guarded (`backup.go:879`), so the symlink
gap really is the lesser issue it was filed as.

`ROADMAP.md` claimed Tailwind v3 and "JetBrains Mono + Inter fonts". The repo is
on Tailwind v4 and ships Satoshi, Excon and Ranade with mono on the OS stack;
JetBrains Mono was the original plan and was never bundled. Two weekly
health-check issues (#18, #19) had both flagged the font line back in July and
neither was actioned, which is its own small lesson about proposals that land
somewhere nobody re-reads.

**Verification.** Full gate set green, 12/12, from a baseline that was also 12/12
before any change. `.duration-fast{--tw-duration:var(--transition-duration-fast)}`
and the `.duration-panel` equivalent confirmed present in `dist/assets/*.css`,
and every converted site grepped out of the built output rather than assumed.

### 2026-08-20 — Four stores that showed a refused write as saved

**Closed:** the checklist's "P1 — Four stores swallow a failed write and keep the
optimistic update".

**What was there.** `useServerConfigStore`, `useSettingsStore`, `useLayoutStore`
and `useTileStore` each caught a rejected Wails write with a
`/* best-effort */` comment and then applied the local update anyway.
`useSchedulerStore` was the only store in the folder that did not, and its own
header comment said so.

The severity ranks by what is lost, and the top of that list is worse than
"a preference did not stick". A `ServerConfig` carries the working directory,
the JVM args and the RCON credentials, and no other part of the app holds a
copy. A refused `SaveServerConfig` left the edit on screen, the editor closed as
though it had worked, and the whole thing was gone at the next start with
nothing written anywhere. `useSettingsStore` is second and different in kind:
`confirmBeforeStop` and `notifyOnCrash` are safety toggles, so a swallowed write
left the user believing a guard was armed for the rest of the session.

**The constraint that shaped the fix, which the backlog entry had not noticed.**
`.claude/launch.json` defines a `frontend-dev` preset: a browser-only Vite server
on port 5199 with no Go process behind it. The generated bindings dereference
`window.go` directly (`frontend/wailsjs/go/main/App.js`), so *every* call throws
there. Reverting on any rejection would have made that preview read-only — no
tile addable, no setting changeable, no layout saveable — which is why the write
paths were written the way they were. The swallow was not carelessness; it was
the only behaviour that kept both cases working, chosen without noticing it
broke the real one.

So the two cases are now separated rather than collapsed. New `lib/ipc.ts` holds
`hasWailsBridge()` (a presence check on `window.go`, never a call through it, so
the "bindings only" rule still holds) and `errMsg()`, which is
`useSchedulerStore`'s old private `msg` hoisted so there is one definition. No
bridge means nothing was ever going to persist and the user is not being misled,
so the optimistic value stands. A bridge present means a real failed write:
revert, record, rethrow.

**Both halves, because the store half alone is not a fix.** Every store gained
`error`/`clearError` and the rethrow. Then the callers: the server editor stays
open on a refused save with the message under it instead of closing as though it
worked; `addInstalledServer` keeps the install modal up, since it covers the
sidebar and dismissing it would hide both the error and the form that could
retry; the preset name survives a failed save so a retry does not have to be
retyped; and `Dashboard` now writes a tile's grid slot only after the tile write
has landed, in both directions, so `activeTileIds` and the persisted layout
cannot disagree about a tile that never arrived or never left.

Three call sites deliberately swallow, and each says why in a comment rather
than being left to look like the bug that was just removed:
`useSettingsStore.reorderCrate`, `TileCrate`'s order commit and `BlockPalette`'s
collapse toggles are all `void`-returning handlers driven by a mouse gesture,
and `update` has already reverted the state by the time the rejection lands.
`SettingsModal` wraps `update` once for all fourteen of its controls rather than
fourteen times, and renders `error` as a banner.

**The test that encoded the bug is split, not deleted.**
`useSettingsStore.test.ts` asserted "keeps the optimistic update even when
SaveAppSettings rejects", mocking a disk-full rejection and checking the toggle
stayed on. Under the fix that assertion is still correct — for the no-bridge
half, which is what jsdom is, since it has no `window.go`. So it became two
tests: the original body under an honest name, and a new one with `window.go`
stubbed that asserts the revert, the recorded message and the rethrow. The same
pair is now on all four stores, plus tests for `lib/ipc.ts` itself.

One thing worth writing down for the next person adding a store test here:
`vi.clearAllMocks()` resets recorded calls but *not* implementations, so a
`mockRejectedValue` armed by one test is still armed in the next.
`useLayoutStore.test.ts` already re-armed its resolved values in `beforeEach`;
the other three now do too, after a passing suite briefly hid a leak.

**What is deliberately not symmetric.** `useLayoutStore`'s `persistActiveLayout`
records the failure instead of rethrowing. Its callers are `loadPreset` and
`updateLayout`, both `void` because react-grid-layout drives them from a
drag/resize callback that cannot await, and there is nothing to revert into: the
layout on screen is what the user just arranged by hand, and snapping it back
under them would be worse than a stale file.

**Verification.** Full gate set green. 301 frontend tests across 28 files, up
from 280 across 27: 21 added, and the one that encoded the bug rewritten.

### 2026-08-20 — The status every tile trusted and one tile owned

**Closed:** the checklist's "P1 — Tiles that render an unreachable server as an
empty one", and the second half of the Stable pillar's `ErrorBoundary` item.
**Found on the way:** a third instance of the same defect that was not in the
backlog, and is the worst of the three.

**The two known cases.** `tiles/console/index.tsx` rendered an empty `<div>`
when it had no lines, so a stopped server, an unreachable backend and a server
that had simply not logged yet were the same blank panel. Its command input and
Send button stayed enabled throughout, and a rejected `SendCommand` went to
`.catch(console.error)` — invisible, so a command the server refused looked
exactly like one it accepted and did not reply to. The players tile had the same
shape: `usePlayers` swallowed the rejection, `players` stayed `[]`, and both
views said "No players online", which is also what a healthy, idle server says.

**The third case, found while looking for a signal to render.** Telling
"unreachable" from "stopped" needs a trustworthy `running` flag, and the one
that existed was not. `useServerStore` was written by exactly one place:
`tiles/stats/useServerStatus.ts`. `App.tsx` registers eleven `EventsOn`
listeners and `server:status` was not among them. Meanwhile five other
components read `status.running` from that store — `tiles/mods/index.tsx`,
`tiles/worlds/WorldHud.tsx`, `tiles/config/index.tsx`, `tiles/backups/index.tsx`
and `tiles/backups/BackupsSummary.tsx`.

Tiles are removable, and only four are active by default. Take Stats off the
canvas and every one of those five reads the store's default `running: false`
forever. The visible cost is not cosmetic: `BackupsSummary.handleCreateClick`
shows its "stop the server first" dialog *only* when `status.running`, so with
Stats removed it backs up a live world with no warning. That is a data-integrity
guard silently disarmed by an unrelated UI action, and no test or gate would
have caught it.

The subscription moved to `App`, next to the settings hydration and the eleven
listeners already there. The hook moved to `hooks/` with it, since a hook the
app mounts should not live inside one tile's folder, and it became write-only:
reading `status` there would have re-rendered the whole tree on every 10s tick.
The stats tile now selects from the store like every other consumer.

This is not a break with "tiles are self-contained". Server status is a shared
domain with six readers; the stats tile was never its owner, it was just the
first consumer and the hydration happened to end up there.

**A second flag, because `running` cannot answer the question.** A stopped
server answers and reports `running: false`; an unreachable backend reports
nothing and leaves the last known numbers standing. Those are different states
and the UI has to say different things about them, so `useServerStore` gained
`reachable` alongside `status`, set by the same sync hook, and `usePlayers`
tracks its own equivalent for the roster fetch. It starts optimistic so the UI
does not flash an error during the first fetch. The stats tile picked this up
too: it used to say "Offline" for an unreachable backend, which would have been
a fresh inconsistency to leave behind.

**The checklist was wrong about what this needed.** Both the `ErrorBoundary`
item and this backlog entry said the verification wanted a desk and a running
GUI. It wanted neither. `hooks/useUpdateCheck.test.ts` already showed the
pattern, and the new tests are ordinary jsdom renders against rejecting mocked
bindings: the console tile's three placeholder states, its disabled input, its
refusal to call `SendCommand` while the server is down, and the failure banner
with the command restored for a retry; plus both player views' empty-state
wording. The command input gained an `aria-label` so the test can find it by
role, which is a small accessibility improvement it should have had anyway.

One incidental for whoever writes the next component test here: vitest runs with
`globals: false`, so Testing Library cannot register its own auto-cleanup and
the previous test's DOM is still mounted. `Collapsible.test.tsx` sidesteps this
by scoping every query to its own `container`; the new files call `cleanup()` in
an explicit `afterEach`. A suite that renders the same component twice and
queries globally will otherwise fail with "found multiple elements", which reads
as a component bug and is not one.

**Still open after this.** The memoization item remains GUI-gated: it wants
re-render counts from the Profiler and a real WebGL context, which no headless
session can produce.

**Adjacent, and the same defect one pane over.** Settings > About's "Data
directory" row hard-coded `~/.config/konnekt`, which is only true on Linux. The
button beside it opened the right folder all along, so the label was the only
thing lying. A `GetDataDir` binding now backs it.

**Verification.** Full gate set green. 316 frontend tests across 30 files.

**Postscript, same day.** Re-baselining the checklist turned up one stale number
worth recording rather than quietly correcting. The Stable pillar's `EventsOn`
cleanup item claimed "25 registrations across 12 files". The real figure is
**47 across 13** — `App.tsx` alone holds 19 — and it was already wrong before
this session's changes, which moved a file without adding or removing a single
registration. Every one of the 47 is still clean, so the tick was right and only
the arithmetic was not; the line now carries the command that produces the
number, so the next reader re-derives it instead of trusting it.

### 2026-08-20 — A log a bug reporter can attach

**Closed:** the checklist's "P2 — Cleanups: structured logging".

**The count in the backlog was right, and worth restating because it is the
whole argument.** Across `app.go` and `backend/`: one `fmt.Printf`
(`scheduler.go:247`, a failed history write), one bare `println`
(`main.go:35`, `wails.Run` failing to start the window), zero `log.*`, zero
`runtime.LogXxx`, and 46 `EventBus` emissions. `main.go` set no `Logger` on
`options.App`. A packaged GUI build has no terminal attached, so both stdout
writes went nowhere, and the EventBus is UI-facing and lives only while the
window is open. Someone reporting a bug had nothing to send.

The backlog's framing — "the 'full sweep' framing is misleading, the work is
adding logging, not replacing it" — held exactly. There were two call sites to
move and a file to start writing.

`backend/services/logging.go` opens `konnekt.log` in the app data dir and points
`slog`'s default at it, writing to the file *and* stderr: the file is what a
user attaches, stderr is what a developer running `wails dev` watches. Wails'
own runtime logging joins through a small adapter on its `logger.Logger`
interface, so asset-server and IPC failures land in the same place.

**Three decisions worth keeping.** Opening the log is not allowed to be fatal:
a read-only data dir must still start the app, so `InitLogger` falls back to
stderr alone and *returns* the reason for `main` to log through that fallback,
rather than swallowing it — the same "record it, do not hide it" rule this
branch applied to the stores. Rotation is ten lines rather than a dependency
(one previous file, 2 MiB cap), and that call is recorded in
`DEPENDENCIES.md`'s "Considered and not added" so it gets revisited rather than
rediscovered. And call sites use the package-level `slog.Info`/`slog.Error`
rather than threading a logger through every constructor, which for a
single-process desktop app with one log is the smaller of the two costs.

**One thing the backlog did not mention.** `main()` needs the data dir before
`wails.Run`, and `app.startup` needs the same directory after. It was computed
inline in `startup` only. That is fine right up until a second caller has to
agree with it, so it became `services.DataDir()`.

**Adjacent, found while wiring the UI, then fixed.** Settings > About's "Data
directory" row hard-coded `~/.config/konnekt`, which is only true on Linux. It
was initially left alone as a separate concern, then folded in once it was clear
it is the same defect this branch spent its second commit on: UI stating
something it does not know to be true. `GetDataDir` joins `GetLogPath` and both
rows now render backend-supplied paths, truncated with the full value in a
`title`.

**Verification.** Full gate set green. Nine new Go tests; `backend/services`
coverage 38.6%, up from 38.1%, against the 36% floor.

### 2026-08-20 — The bound type TypeScript never saw

**Closed:** the checklist's "P2 — A Go model the bindings never emit", including
the related eight-redeclarations note. **Found on the way:** one claim in that
note that was wrong in a way that would have made things worse, and one tool
assumption that was wrong in a way that made things easier.

**The tooling first, because it changed what was possible.** Both this entry and
the last session assumed the `wails` CLI was unavailable, which is why the fix
kept being described as deferred work. It installs in one command
(`go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0`, matching `go.mod`),
and — the part worth recording — regenerating with **no** source change produces
a **zero-byte diff** against what is committed. So the committed bindings are
exactly reproducible, `wails generate module` really is clean as the entry
claimed, and regenerating is a safe step rather than a leap.

**The defect.** `ModCheckUpdates` returned `map[string]models.ModUpdateInfo`,
keyed by file name. Wails v2.12.0 walks a bound signature's parameter and return
types but does not descend into a **map value**, so `App.d.ts` referenced
`models.ModUpdateInfo` while `models.ts` never declared it. `tsconfig`'s
`skipLibCheck` kept the dangling reference from erroring, the return type
degraded to `any`, and `useMods.ts` held a hand-written copy of the Go struct
that a cast quietly reconciled.

`ModUpdateInfo` now carries its own `FileName` and the method returns a slice,
which the generator can see through. The hook indexes the list once by file
name, so the two lookup sites are untouched.

**Proved, not asserted.** With `latestVersionNumber` renamed to
`latestVersionNum` in `backend/models/mod.go` and the bindings regenerated,
`tsc` fails: *Property 'latestVersionNumber' does not exist on type
'ModUpdateInfo'*. Before the change, that same rename typechecked green,
linted green, and reached `ModPreviewDialog.tsx:270` and `InstalledPanel.tsx:439`
as `undefined`.

**The guard the backlog said could not exist.** It argued a check would have to
be a script diffing two generated files, would need its own `health.commands`
entry and a literal `ci.yml` step since that workflow runs `suite-check.py` with
`--section invariants --section generated` only, and would be red on arrival.
All true *of that approach*. Reflecting over the bound methods from Go needs
none of it: `bindings_test.go` walks `App`'s real type graph for a struct
reachable only through a map value. It rides the existing `go test ./...`, so no
new gate wiring; it catches a *future* method with the same shape rather than
only today's generated output; and it was confirmed to fail on the original
signature before being confirmed green. Maps of primitives stay allowed, which
is what `GetScheduleNextRuns` (`map[string]int64`) needs.

**The claim that was wrong.** The entry said all eight hand-written model
redeclarations "could be replaced with a one-line alias today". Measured field
by field, **six could and two could not**. `AppSettings` and `ConfigFile` narrow
Go `string`s to string-literal unions — `theme`, `backgroundStyle`, `category`,
`format` — and that narrowing is load-bearing: `useSettingsStore.load` validates
the value read off disk and casts to `AppSettings['backgroundStyle']`,
`lib/theme.ts:118` matches on it, the config tile switches on `format` to pick a
CodeMirror language and a parser, and `SettingsModal`'s `Segmented` controls are
typed against those members. Aliasing them would have widened all of it back to
`string` and deleted the exhaustiveness checks — a downgrade wearing a cleanup's
clothes, and one the entry actively recommended. Both now stay hand-written with
the reason written beside them.

The other six are aliases, and that half is proved too: adding a field to
`models.ServerStatus` and regenerating now fails `tsc` in three places. Before,
it failed in none — which is precisely the silent-added-field hole the entry
described.

**Verification.** Full gate set green, 16/16. 316 frontend tests, entry chunk
487.9 KB gzip against the 550 KB budget, `backend/services` coverage 38.6%
against the 36% floor.
## 2026-08-21 — Wings survey, triage, and adoption planning

Not a remediation session; recorded here because it produced the largest single
batch of verified findings since the checklist re-baseline, and because the
scheduler-deep-analysis precedent already established that analysis sessions
belong in this log.

**What was done.** A clean-room behavioral survey of Pterodactyl Wings (MIT, Go,
~20.5k LOC) was produced by three isolated source-reading subagents and written
to `survey/wings.md` under hard constraints: no Wings code, identifiers, layouts
or algorithms — only observable behavior, so later sessions can consume it
without contamination. Every surveyed feature was then argued both ways against
Konnekt's actual code and trust model (single trusted local owner, no tenancy)
in `survey/wings-triage.md`, grounded in a full backend sweep with file:line
verification. The owner returned the form 2026-08-21: all 15 recommended
adoptions accepted, all 21 rejections stood (revisit triggers preserved).

**Adoption verdict in one line.** Most of Wings is landlord machinery Konnekt
rightly rejects; what survived is mostly Konnekt bugs the comparison exposed,
plus two owner-chosen features (close-time choice with re-adoption, past-session
logs). The sweep also found four areas where Konnekt is already *ahead* of Wings:
staged restore with rollback, backup quiescing, comment-preserving config
editing, and event/getter parity.

**Filed.** Issues #108–#121 (14 new), each carrying its own verified pointers,
scope and acceptance; item 13 (per-server shaping) rides existing #57 rather
than duplicating it. Reconciliations recorded rather than left to collide:
#108 implements #101 and should close it; #99 became #117's prerequisite; #30's
core need is structurally met by the staged extract (zip CRC fails corrupt
archives before the swap touches the live dir), leaving only error surfacing —
narrowing or closing it is the owner's call; #26 covers the sibling-dimension
gap the sweep re-found. Cross-cutting constraints and sequencing:
`agent_docs/WINGS_ADOPTION.md`. Backlog entries added to the checklist: the
adoption set (P1/P2) and five P3 micro-findings from the sweep (stale RCON-stop
comment, silent panic swallowing in the event bus, restore's 0700 mode and
discarded aside copy, sticky MaxPlayers after stop, the "(+ siblings)" comment).

**Verification.** Docs-only session: no code changed, no gates run. Every code
claim in the triage, the issues and the backlog entries carries a file:line
pointer verified against the tree on 2026-08-21; implementing sessions are
instructed to re-verify before editing.

### 2026-08-22 — The console that died on one long line

**Closed: [#112](../../issues/112), the P1 that opens the Wings adoption set**
(Wave 1 per `agent_docs/WINGS_ADOPTION.md` — chosen first because a silently
dead console masks testing of everything else in the set).

**The bug.** `streamOutput` scanned the server's stdout/stderr with a bare
`bufio.NewScanner` and never checked `scanner.Err()`. The default 64 KiB token
cap meant one longer line — a stack trace, a mod dumping JSON — made `Scan()`
return false with `ErrTooLong` and the goroutine exit: console output stopped
for the rest of the session, with nothing on screen and nothing in
`konnekt.log`. Minecraft's habit of emitting stray mid-line `\r` (progress
output sized to an assumed terminal width) compounded the risk by welding many
logical lines into one enormous physical one, and made progress output render
wrong even under the cap.

**The fix** (`backend/services/consolescan.go` + three lines in
`streamOutput`). A stateful `bufio.SplitFunc` (`newConsoleSplitFunc`) that
treats `\n`, `\r\n` and bare `\r` all as line breaks, and — past
`maxConsoleLine` (64 KiB, the same bound the scanner previously enforced by
dying) — delivers the line truncated, discards the excess, and keeps
scanning. Wings' own contract (survey §9), which lets a delivered chunk carry
embedded newlines, was deliberately *not* adopted: the frontend batcher renders
one row per emitted payload, so the backend splits before emitting and no
frontend change was needed. Two design points worth keeping:

- **No "request more data" lookahead for a trailing `\r`.** The obvious CRLF
  lookahead (return `0, nil, nil` when `\r` is the last buffered byte)
  deadlocks into `ErrTooLong` when the buffer is full. Instead a `skipNextLF`
  flag consumes the `\r` immediately and swallows a leading `\n` on the next
  call. Because the func always advances once `maxConsoleLine` bytes are
  buffered without a terminator, the scanner's buffer never needs to grow past
  the cap and `ErrTooLong` is structurally unreachable.
- **`scanner.Err()` is now checked**, logged via the house slog idiom — except
  `os.ErrClosed`, because `waitForExit`'s concurrent `cmd.Wait()` can close the
  pipes before the readers drain, so that error is ordinary teardown on every
  stop, not a defect.

**Verification.** `backend/services/consolescan_test.go` runs every split case
twice, once through a plain reader and once through `iotest.OneByteReader` so
every terminator lands on a read boundary (that is what exercises
`skipNextLF`), plus the issue's acceptance case, a 3 MiB single line at the
real cap. `server_test.go` is the package's first — `streamOutput` fed directly
with an `io.Reader` on a `NewServerService()` + ctx-less `EventBus` fixture
(the `stats_test.go` idiom): streaming survives an overlong line, `\r` progress
arrives as individual lines, and the line matchers (player join with UUID/IP
accumulation, EULA detection, `expectedStop`) still fire on lines separated
only by `\r` — the contract #108's ready detection will ride on. All three
integration tests were run against the pre-fix `server.go` (via `git stash`)
and failed exactly as the bug predicts — zero events after the giant line —
then passed with the fix. Gates: `gofmt`/`go vet` clean, full `go test ./...`
green, `backend/services` coverage 38.0% → **40.1%**, floor ratcheted 36% →
**38%** per its own rule.

**Left as found.** The other unbuffered scanners (`serverlaunch.go:161,333`,
`properties.go`, `modjar.go`'s readers) parse bounded files or short-lived
install streams, not an unbounded live console; same pattern, different blast
radius, separate concern if ever worth fixing.

### 2026-08-22 — The half-written file a crash could leave

**Closed: [#116](../../issues/116)** (Wings adoption Wave 1 per
`agent_docs/WINGS_ADOPTION.md`; merged as PR #144).

**The bug.** `WriteConfigFile` (`config_editor.go`), `writeProperty`
(`properties.go`) and `WriteDataFile` (`datadir.go`) were bare `os.WriteFile`:
truncate, then write. A crash or power loss mid-write corrupts the file in
flight — and `WriteDataFile` alone carries the server list, app settings, tile
layouts and presets, custom commands and the scheduler's graphs and history.
The config-backup rotation protects the *previous* content, never the write in
flight. Re-verifying the issue's pointers found a fourth site it did not name:
`backup.go`'s `saveMeta` wrote each backup's `meta.json` the same way. The repo
already held the cure in `modservice.go`'s `saveManifest` (temp + rename) —
though that pattern leaves `os.CreateTemp`'s 0600 mode, fine for an internal
manifest, wrong for `server.properties`.

**The fix** (`backend/services/atomicwrite.go`; all four call sites
converted). `writeFileAtomic(path, data, perm)`: a sibling temp file in the
target's own directory (same filesystem, so the rename cannot cross a mount
and lose atomicity), write, `f.Sync()` — without it a power loss can make the
rename durable while the bytes are not, a correctly named empty file — close,
chmod to the mode a direct `os.WriteFile` gave, then rename over the target.
Two decisions worth keeping:

- **No remove-then-rename fallback for Windows.** Go's `os.Rename` already
  replaces an existing target there (MoveFileEx with
  MOVEFILE_REPLACE_EXISTING); the gap between a remove and a rename is exactly
  the torn-write window the helper exists to close. A sharing violation (the
  target open in another process) surfaces as an error instead.
- **`renameFile` is a package-level `var` holding `os.Rename`** — the
  package's first seam of this kind, existing only so a test can simulate a
  crash at the rename step. No test in the package runs parallel, so the swap
  is safe.

**Verification.** `atomicwrite_test.go`: round trip with a mode assertion
(skipped on Windows), overwrite, no temp residue after success or failure, a
missing parent failing before the target could be touched, and the acceptance
case — a failing rename stub leaves the old content byte-identical with the
temp removed. Full suite-check manifest green (16/16 on the PR).

### 2026-08-22 — The torn copy of a live world

**Closed: [#115](../../issues/115)** (Wings adoption Wave 1; merged as PR
#145).

**The bug.** `DuplicateWorld` was the one world operation with no
`IsRunning()` guard and no quiescing — `SetActiveWorld`, `DeleteWorld` and
`RenameWorld` all refuse while running. Duplicating a live world could copy
region files mid-write and produce a torn duplicate. The backup path had
already solved exactly this: `PrepareForBackup` (save-off, then save-all
flush; RCON preferred, stdin fallback) and `ResumeSaves` (save-on), used as a
defer pair in both backup paths. Per the issue's decision the fix quiesces
rather than refuses: duplicating a live world is a legitimate ask and the
machinery is proven.

**The fix** (`backend/services/worlds.go`). The copy loop now sits inside the
same `if s.server != nil && s.server.PrepareForBackup() { defer
s.server.ResumeSaves() }` shape `backup.go` uses; `PrepareForBackup` no-ops
(returns false) when the server is stopped, so that path is unchanged. To make
the ordering testable, `WorldService.server` narrowed from `*ServerService` to
a three-method in-package interface (`IsRunning`, `PrepareForBackup`,
`ResumeSaves`) — `NewWorldService`'s signature and the `app.go` wiring are
untouched, and nothing moved deeper into the singleton (WINGS_ADOPTION
constraint 1).

**Verification.** The package's first `worlds_test.go`: a fake guard whose
callbacks assert position at call time — the destination must not exist when
`PrepareForBackup` fires and must exist when `ResumeSaves` does — plus the
`_nether` sibling copied, the stopped path resuming nothing, and an
existing-name refusal that never touches saves. Full suite-check manifest
green (16/16 on the PR). With both Wave 1 fixes merged, `backend/services`
coverage stands at **41.1%** and the floor ratcheted 38% → **39%** in the
closing pass recorded here.

### 2026-08-23 — The power actions that raced each other

**Closed: [#109](../../issues/109)** (Wings adoption Wave 2, first of the
lifecycle core; survey §3, triage item 2).

**The bugs.** Three races in one family. Two concurrent Stops both passed the
`running` check because `Stop` released `s.mu` before waiting on `exited`: the
loser wrote "stop" into a closed stdin, closed it a second time, and both
could schedule `killTree`. `waitForExit` closed `exited` *before* clearing
`running`, so Restart's immediately-following Start could observe the stale
flag and fail with "server already running" — a restart that stopped the
server and then refused to start it. And `RestartServer` on a stopped server
returned "server not running" without ever starting — from the UI and from the
scheduler's `__restart__` block, which duplicated the same stop-then-start
composition.

**The fix** (`backend/services/server.go`, `app.go`,
`backend/services/scheduler_blocks.go`,
`frontend/src/components/QuickCommandsPanel.tsx`). One per-server power gate:
a `powerMu` mutex acquired fail-fast (`TryLock`) by `Start`, `Stop` and the
new `ServerService.Restart`, which holds it across both legs so nothing slips
between them. The loser of a contended acquire gets the exported sentinel
`ErrPowerActionInProgress`, whose message ("another power action is in
progress") is the user-facing sentence: the quick-commands panel shows it
verbatim, having gained the error surface it never had (its power buttons
swallowed every rejection with `.catch(console.error)`) plus an in-flight
disable so a double click cannot even leave the panel. Restart-from-stopped is
a plain start per the owner decision, so the stop leg tolerates
`errServerNotRunning` — which also covers a server crashing between the gate
and the leg; `app.go`'s `RestartServer` and the scheduler's `__restart__` both
delegate to the one implementation. `waitForExit` now closes `exited` dead
last, after `running` is cleared and `server:stopped` is on the bus, so anyone
the channel unblocks observes fully-torn-down state; the restart's stop leg
still marks `expectedStop` first, so no crash notification fires (asserted).
The gate and the new `launchCmd` seam sit in a commented per-instance block
for #57 to move wholesale (WINGS_ADOPTION constraint 1); #110's force kill
will bypass the gate by design, and the "server already running" check stays
inside `start()` as that path's guard. The stale `beforeClose` comment
claiming an RCON stop fallback (a P3 backlog bullet) was rewritten in passing.

**Verification.** The package's first race-shaped tests, made deterministic by
observing progress rather than timing: a fake running server whose `s.stdin`
is an in-memory pipe (its EOF proves a stop is inside the gate) while the real
process's stdin stays in the test's hand, so the 8-second killTree path is
unreachable and nothing sleeps. Concurrent Stop/Stop, Restart-into-Restart
(with the stop leg's `Expected: true` payload asserted), restart-from-stopped,
exited-observes-stopped-state, Start-while-running, and the pinned "server not
running" string contract — all green under `go test -race`. The `launchCmd`
seam (production default: java PATH check + `resolveLaunch` + `exec.Command`)
lets `start()` run a stdin-consuming shell process, giving the start body its
first coverage: `backend/services` rose 41.1% → **43.8%**, floor ratcheted
39% → **41%**. Frontend: three new panel tests (verbatim message render,
double click sends once, error clears on the next action).

### 2026-08-26 — The server that claimed running while still generating its world

**Closed: [#108](../../issues/108)**, and with it the user request in
[#101](../../issues/101) (Wings adoption Wave 2, second of the lifecycle
core; survey §1–2, triage item 1).

**The gap.** `running = true` the instant `cmd.Start()` returned, so a server
thirty seconds from accepting players was indistinguishable from one serving
them: the pill said Online mid-worldgen, and the TPS poll waited an arbitrary
fixed 15 seconds because nothing knew when the server was actually up.

**The fix** (`backend/services/server.go`, `events.go`,
`backend/models/server.go`, `app.go`, `stats.go`; frontend `constants.ts`,
`useServerStore.ts`, `useServerStatus.ts`, `tiles/stats/index.tsx`). Wings'
four-state lifecycle — offline, starting, running, stopping — as an int enum
whose zero value is offline (bare `&ServerService{}` fixtures stay correct),
living in the same commented per-instance block as #109's gate for #57 to
move wholesale. All movement goes through one `setStateLocked` under `s.mu`
that emits the new `server:state` event (`models.ServerStateChange`) only on
an actual change, since the EventBus itself never dedups; the readable getter
twin is the new `State` field on `GetServerStatus`, which the stats tick
pushes too. Start enters starting; the running transition comes from the
console scanner matching the Minecraft `]: Done (3.541s)!` family (one
pattern covers vanilla/Fabric/Quilt/Paper/Forge; anchored on the log prefix
so chat cannot spoof it; gated on starting so a late buffered line cannot
resurrect a stopped server); `Stop()` and the server's own "Stopping the
server" line enter stopping — the line's `expectedStop` write stays
unconditional, so the crash contract is untouched (crash remains
running-or-starting straight to offline); `waitForExit` enters offline before
its close-`exited`-last ordering. The timeout Wings lacks: a `watchStarting`
goroutine (armed per boot on its own `exited` channel) promotes a
never-matched starting state to running after 10 minutes, flagged `TimedOut`
on the event with a `[Konnekt]` banner in the console. The TPS poller now
starts at readiness instead of spawn+15s, sampling immediately, with its
`stopTPS`/`tpsOnce` re-arm moved alongside so a second boot polls again; it
takes the stop channel and RCON coordinates as snapshots, closing two latent
races (a later boot rewriting fields under a live poller), and `Uptime()`
gained the lock it always needed against the stats ticker. Frontend: the pill
becomes five faces (Unreachable / Starting / Online / Stopping / Offline,
the transitional pair in the warning amber token); `Running` still means
"process alive", so the console/backups/config/mods/worlds gating on it is
untouched, and the `ServerStatus` alias picked the new field up from the
regenerated bindings for free. Deliberately unchanged: the "Server started"
notification stays keyed to spawn (a "server ready" notification is a clean
follow-up), `QuickCommandsPanel.lifecycleBusy` stays (the gate owns
correctness), and `useConsoleStore.classifyLine`'s cosmetic `/Done|…/`
coloring keeps its own looser regex.

**Verification.** Lifecycle tests driven through the real machinery — Start
with the `launchCmd` seam, ready lines fed to `streamOutput` — assert the
full starting→running→stopping→offline trace with exactly one event per
transition, the never-started fixture ignoring a Done line, a table of ready
regex flavors with the chat-spoof and no-prefix negatives, timeout promotion
(30ms seam) with banner and `TimedOut`, ready suppressing the armed timer,
stop-during-starting passing through stopping with `Expected: true`, and the
TPS gate re-arming across two full boots — the regression the re-key was most
likely to cause. All green under `go test -race -count=3`; the existing
matcher test additionally pins that a stopping line on a never-started
fixture moves the flag but not the state. `backend/services` rose 43.8% →
**45.2%**, floor ratcheted 41% → **43%**. Frontend: the hook's fourth
listener asserted (apply-without-refetch, subscription tripwire moved 3 → 4)
and the pill's five faces in jsdom, including Starting-while-`running:true`,
which the old boolean pill could not render.

### 2026-08-26 — The stop that killed mid-save

**Closed: [#110](../../issues/110)** (Wings adoption Wave 2, third of the
lifecycle core; survey §5, triage item 3).

**The bug.** `stop()` wrote `stop` to stdin, waited a fixed 8 seconds, then
SIGKILLed the process tree. A large world save legitimately exceeds 8
seconds, so a routine stop could destroy the very data it was flushing —
silently, since the wait had no narration and `killTree` was reachable only
through that timeout. There was also no user-facing force kill at all: a
genuinely hung server had no escape hatch except quitting Konnekt.

**The fix** (`backend/services/server.go`, `config.go`, `scheduler_blocks.go`,
`backend/models/settings.go`, `app.go`; frontend `SettingsModal.tsx`,
`QuickCommandsPanel.tsx`, settings store/types). Wings §5's shape at desktop
scale. The grace is a parameter: `Stop(grace)`/`Restart(..., grace)` with the
configured `StopGraceSeconds` (default 60, Settings > General, clamped 5–600
in the UI) passed down by the bound methods and the scheduler's stop/restart
blocks via `ConfigService.StopGrace()`; zero maps to the 60s default inside
`stop()` and a wild value clamps at Wings' own 10-minute user-stop deadline.
`beforeClose` deliberately keeps a fixed 8-second `quitStopGrace` so quitting
the app never hangs on the configurable value — the Job Object/Pdeathsig
lifetime tie finishes what the best-effort close-time stop does not, and #117
will rewrite that path anyway. The wait itself became two staged selects with
the escalation narrated through the console ring buffer: a
`[Konnekt] Still waiting…` warning at half the grace (the issue's open
parameter, answered), the kill banner at its end. The state machine from
#108 already holds `stopping` for the whole window, so the pill never lies.

`ForceStop` is the escape hatch, bound as `ForceStopServer`: TryLock the
power gate so a free gate is still claimed, proceed regardless when a
graceful stop holds it (#109's documented plan, its comment now in the
present tense), mark `expectedStop`, enter `stopping` (deduplicated if the
graceful stop got there first), kill the tree, and wait for `waitForExit`'s
ordinary teardown — it stays the single writer of the offline transition,
the stopped payload and the exited close. A missing process is a successful
force stop, deliberately unlike `Stop`'s pinned "server not running" error:
this call's contract is "make it dead", and dead already is success. The
frontend half: a pinnable Force Stop preset, an inline red button that
appears while a stop or restart is in flight, and a confirmation it always
shows regardless of `confirmBeforeStop` — exempt from the busy-disable on
both the panel and the dialog, because a graceful stop now legitimately
holds `lifecycleBusy` for the whole grace window and the wedged case is
exactly when force stop must fire. `killTree` moved behind a per-instance
seam (the `launchCmd` precedent): the test fixtures' children lack the
Setpgid/Job setup a real boot gets, so the genuine group kill would have
been an ESRCH no-op that hung every escalation test.

Known consequence, accepted: the backups stop-and-back-up and worlds
switch-and-restart flows await `StopServer` inline and now spin up to the
configured grace during a slow save — that wait is the point.

**Verification.** Escalation with an 80ms grace asserts both banners in
order, the recorded kill pid, `Expected: true`, offline, and no crash
banner; a stop inside the grace asserts silence and zero kills. Force stop:
while a graceful `Stop(time.Hour)` is provably inside the gate (the fixture's
stdin-EOF signal), `ForceStop` returns nil, both calls come home, the
stopping transition is deduplicated to one event; idempotent-when-offline,
starting-passes-through-stopping, and a deterministic gate-exclusion test
that calls `Stop` from inside the kill seam while ForceStop's TryLock holds.
All green under `go test -race -count=3`. `backend/services` rose 45.2% →
**45.7%**, floor ratcheted 43% → **43.5%**. Frontend: three new panel tests
(force fires through the always-shown confirm while Stop is pending and
disabled; confirms even with confirm-before-stop off; rejection reaches the
alert), settings fixture extended; 330 passing.

### 2026-08-27 — The console that learned to say what Konnekt was doing

**Closed: [#113](../../issues/113)** (Wings adoption Wave 2, fourth of the
lifecycle core; survey §14, triage item 6 — the survey's own
"highest value-per-effort" item).

**The gap.** The console carried process output and nothing else. Everything
Konnekt itself did was invisible there: a backup ran with no trace, a restore
swapped directories in silence, the quiesce paused world saves and then slept
three unexplained seconds without RCON, and accepting the EULA said nothing.
The events existed, but they went to toasts and the notification feed, so the
one place a user already watches during trouble told them nothing about the
manager standing behind the server.

**The fix** (`backend/models/console.go`, `backend/services/server.go`,
`backup.go`, `app.go`; frontend `useConsoleStore.ts`, `App.tsx`,
`tiles/console/index.tsx`). `ConsoleLine` gains a `Source` field, empty for
server output and `"manager"` for narration, mirrored as an optional `source`
key on the `log:line` payload that is **omitted entirely** when empty, so the
server-output path travels exactly the payload it always did and the
`map[string]string` shape assertion still holds. The marker is structural
rather than a prefix match on purpose: a plugin printing `[Konnekt]` cannot
impersonate the manager, and the frontend needs the bit anyway to keep
narration out of `classifyLine`'s substring heuristics, which would have read
`[Konnekt] Backup failed: …` as a server error. Empty is the zero value, so
any path predating or missing the marker still reads as server output.

One exported entry point, `ServerService.Narrate`, owns the daemon tag and
tags the source; `emitConsoleLine` stays the raw server path. The five
existing banner sites from #110 and #111 (crash exit, both escalation stages,
force stop, ready timeout) moved onto it with their text byte-identical.
`BackupService` already held a concrete `*ServerService` in the same package,
so backup, world backup and restore narrate through a nil-safe forwarder with
no new wiring, and the scheduler's backup block and the worlds tile inherit it
for free. Quiesce narration lives inside `PrepareForBackup`/`ResumeSaves`
rather than at their three call sites, which covers world duplication too and
leaves `WorldService`'s narrow `serverGuard` interface untouched; the
stdin-fallback flush wait moved behind a `quiesceWait` seam so it is testable
and can say how long it is waiting. `AcceptEula` narrates after a successful
write via the exported method.

Restraint is enforced as much as the narration is: guards that refuse before
anything starts stay silent, progress percentages stay on their own channel,
installer output keeps `install:log` (Wings §14 is explicit that install
output does not belong in the console, which resolves the triage's "install
steps" mention), and a stopped server's no-op quiesce says nothing. Worst case
for a backup on a running server is five lines. On the frontend the store
levels a line by the marker instead of its text, and the tile paints
`manager` in its own colour; the level filter stays a *server log level*
filter, so narration appears under All rather than being swept into Warn or
Error.

Known and accepted: restore narration is live-only in practice, since restore
requires a stopped server and the ring buffer clears on the next Start. Two
follow-ups were noted rather than folded in: `AcceptEula`'s raw `os.WriteFile`
belongs in a service and should use `writeFileAtomic` (#116's shape), and
`CreateBackup`'s post-zip `os.Stat` failure returns an error without emitting
`backup:failed`.

**Verification.** A clean round trip asserts the whole story in order from the
ring buffer (backing up, finished, restoring, restore finished) with every
entry marked `manager`, no failure line, and no quiesce line while the server
is stopped. Restraint has its own tests: a refused backup narrates nothing, a
stopped-server quiesce narrates nothing. A corrupt archive proves the failure
wording names its stage and never claims success. The quiesce test pins all
three lines in order behind a 1ms seam. `TestNarrateMarksManagerLines` pins
both halves of the contract, including that server output carries no `source`
key at all. Frontend: the store levels by marker not by words, carries it
through `appendLine` and `loadHistory`, and the console tile got its first
line-rendering tests (manager styling, and manager lines staying out of the
Error filter). `backend/services` rose 45.7% → **46.3%**, floor ratcheted
43.5% → **44%**; 335 frontend tests pass.


### 2026-08-29 — The channel a snapshot could never update through

**The gap.** Konnekt published two channels and could only update through one.
The updater asked GitHub for `/releases/latest`, which skips prereleases by
definition, so the rolling `snapshot` prerelease was invisible to it. On top of
that a snapshot binary was stamped `0.1.0-dev.snapshot.<sha7>`, and three
separate places read the `-dev` substring as "no installable artifact":
`app.go`'s install guard, `useUpdateCheck`'s `isDevBuild()`, and the About
pane's "Not available in dev builds" branch. A snapshot was therefore a one-way
download. It never checked, never nagged, and could not replace itself; the only
way to move forward was to visit the download page again.

Underneath that sat a problem no amount of plumbing would have fixed. Two
snapshots differed only by commit sha, and `compareVersions` falls back to
`strings.Compare` on the prerelease suffix, so `…snapshot.00400f8` against
`…snapshot.abc1234` sorted alphabetically by sha. Any snapshot self-update built
on that string would have been guessing which build was newer.

**The fix** (`backend/services/update.go`, `backend/models/update.go`,
`backend/models/settings.go`, `backend/services/config.go`, `app.go`,
`.github/workflows/snapshot.yml`; frontend `hooks/useUpdateCheck.ts`,
`components/SettingsModal.tsx`, `stores/useSettingsStore.ts`, `types/index.ts`).

The version format changed first, because the rest depends on it. A snapshot is
now `<base>-snapshot.<YYYYMMDDHHMM>.<sha7>`, the timestamp taken from the
commit's own UTC date rather than `date -u` so a re-run on an unchanged `main`
produces the same version instead of nagging everyone about a build they
already have. Fixed width and all digits means the existing string compare
orders it correctly, so `compareVersions` needed no change at all; every pair
was checked and pinned in its table, including the one that matters most,
stable beating a snapshot of the same core. Dropping `-dev` was the other half:
that marker now means one thing, a local `wails dev` build, and
`IsInstallableBuild` replaces the three substring checks that used to conflate
the two.

The snapshot release's version cannot come from its tag, since `snapshot` is a
rolling literal, so the workflow publishes the bare version as the release
**title** and `releaseVersion` reads it from there. That is a contract held
together by prose, so it fails closed rather than trusting: a title that is not
a single snapshot-shaped token yields `""` and the snapshot is simply not a
candidate. That is also what makes the migration window safe, since the
already-published release still carries the old `Snapshot 0.1.0-dev.snapshot.…`
title until the next nightly, and a client on the new code quietly falls back to
stable rather than parsing a sentence as a version. The publish step greps the
computed version against the expected shape before creating the release, because
nothing else in CI defends a title the updater parses.

Channel resolution is deliberately asymmetric. Stable asks `/releases/latest`
and nothing else, so the snapshot endpoint is never contacted at all and opting
out is real rather than cosmetic; there is a test whose handler fails if that
request is ever made. Snapshot asks both and takes the higher version, ties
going to stable, which carries a snapshot user back to stable the moment a
release overtakes their build instead of stranding them on a channel that has
fallen behind. An error surfaces only when every endpoint consulted failed: a
snapshot user whose `/releases/latest` lookup is rate-limited still gets the
snapshot.

`DownloadAndInstallUpdate` gained the channel argument but not a snapshot gate,
and deliberately so. It already re-ran the check rather than trusting the
frontend, and resolution is a pure function of the version, the setting and
GitHub's state, so the assets it installs are by construction the offered
release's. A test publishes identically named assets at different URLs on both
releases to hold that, since it is exactly the invariant a later refactor would
break silently.

The UI is one `Segmented` row under Settings > General and a two-step confirm in
About. The control keeps showing the stored setting even on a snapshot build,
where the service overrides it; forcing the display to "Snapshot" would misreport
both what is on disk and what happens after a release is installed, so the
description says it instead. The confirm is two clicks because a setting that is
a foot-gun by design needs something between the warning and the install, and
the component test that pins it asserts the first click does *not* reach
`DownloadAndInstallUpdate`.

Known and accepted:

- **Snapshots already in the wild are stranded.** They run the old binary, bail
  on `isDevBuild` before checking, and would show "not available in dev builds"
  even if they did. Nothing shipped here can reach them; those users download
  once by hand. The classification is pinned in tests rather than left implicit.
- **The snapshot channel can move a user backwards in commits.** `0.2.0` beats
  `0.2.0-snapshot.…`, so a snapshot user is offered a stable build containing
  fewer commits than the one they run. That is the intended "stable caught up"
  behaviour and the alternative is never leaving the channel, but it is a
  downgrade wearing a version bump.
- **The channel stalls if `version.go`'s base is not bumped after a release.**
  Snapshots are prereleases of that base, so a stale base sorts every snapshot
  below the release and the channel reports "up to date" forever. Self-healing
  once bumped, but invisible, so the workflow now emits a `::warning::` when the
  base is not ahead of the newest release and the rule file carries it as a
  post-release step.
- **Two unauthenticated GitHub calls per snapshot check** rather than one,
  against a 60/hr per-IP limit. Fine for a one-shot startup check and a manual
  one, but the lenient error rule means a half-rate-limited check reads as a
  clean result.

**Verification.** Go: `compareVersions`' table gained seven snapshot orderings;
`IsSnapshotVersion`, `IsInstallableBuild`, `EffectiveChannel` and
`releaseVersion` each got a table including the legacy stamp; eleven httptest
cases cover both-newer resolution, the stable channel never touching the
snapshot endpoint, a snapshot build forcing the channel past a stable setting,
a missing snapshot tag, an unparseable title, both channels empty, either
endpoint failing alone, both failing, and assets coming from the offered
release. `backend/services` rose 46.3% → **46.7%**, floor ratcheted 44% →
**44.5%**. Frontend: `isDevBuild` has a regression pin for the snapshot stamp
and one for the legacy stamp, the hook has a snapshot-build case, the settings
store validates the new field including the empty value an older settings file
produces, and a new `SettingsModal.test.tsx` holds the two-step confirm. 345
frontend tests pass.

### 2026-08-29 — The warm-up that moved the stutter onto the first scroll

**The report.** "The first scroll and opening of specific tiles is always laggy,
and not as smooth as when having opened or scrolled to them once." Filed as
still-present after an earlier round had already addressed it.

That earlier round is `frontend/src/lib/prefetch.ts`, added to warm the two lazy
chunks (`WorldsScene`, `charts`) so the first tile open would not pay a cold
fetch and evaluate. It did that. It also moved the cost somewhere worse.

**Measuring it rather than guessing.** The production bundle boots in plain
Chromium once `window.go.main.App` and `window.runtime` are shimmed, so the
whole thing is measurable headlessly: serve `frontend/dist`, throttle the CPU 4x
over CDP, and record `longtask` entries and `requestAnimationFrame` gaps across
a scripted scroll and a scripted maximize. Cold and warm are the same scripted
action run twice. Every number below is the median of five launches at that
throttle, and the ratio between them is what matters, not the absolute value.

**Two independent causes, each about 95ms of blocked main thread, and they
add.** A 2x2 (warm-up on/off, Performance tile placed/not) separates them
cleanly. First scroll, worst frame and total blocking:

| | Performance tile placed | not placed |
| --- | --- | --- |
| warm-up on (what shipped) | 150ms / 189ms | 167ms / 97ms |
| warm-up off | 133ms / 96ms | **17ms / 0ms** |

1. **The warm-up itself.** `requestIdleCallback(warm, { timeout: 3000 })` fired
   one callback that kicked off both imports at once. Evaluating 1.3MB of
   module source is not an idle-sized piece of work, and one to three seconds
   after launch is exactly when a user makes their first scroll. The warm-up
   was landing on it.
2. **The Performance tile's own `charts` chunk.** Its Suspense boundary resolves
   about a second in and recharts' first render blocks ~95ms, in the same
   window. Nothing to do with the warm-up; it happens whether or not the
   warm-up runs.

**And a third cause, for the tiles half of the report.** The warm-up warmed the
two chunks that were already split. The tiles that actually stutter are the ones
that were never split at all. Attributing the entry chunk through its source map:

| in the entry chunk | source bytes | used by |
| --- | --- | --- |
| CodeMirror + `@lezer` + `yaml` | ~1.4MB | the config tile's editor, only when maximized |
| react-markdown, `rehype-raw`, parse5, micromark | ~650KB | a mod description |
| `@xyflow/react` + `@xyflow/system` | ~370KB | the scheduler's graph editor, only when maximized |

4.49MB of source, 1.64MB minified, 501KB gzip against a 550KB budget. None of it
is needed to paint the dashboard, and being in the entry chunk does not make it
free at open: V8 compiles a function lazily, on first call, so the cost lands on
the first open regardless and there is no chunk for a warm-up to reach.

**The fix, in three parts.**

- **Split the three heavy tile bodies** behind `React.lazy`, matching what
  worlds and performance already did: `scheduler/editor/GraphEditor`,
  `config/EditorPanel`, and a new `mods/MarkdownBody` extracted from
  `ModAboutBody` (the shell keeps the loading, description and empty branches,
  so the only thing behind the boundary is the markdown renderer). Entry chunk
  **501KB → 145KB gzip**; startup blocking **723ms → 427ms** at 4x.
- **Rewrite the warm-up as a paced queue.** One chunk per idle slot instead of
  everything at once, and never start one within 500ms of a wheel, pointerdown,
  keydown or scroll. `scroll` is in that list because the canvas is the app's
  only scroller and staying out of its way is the point; a capture-phase
  listener on `window` sees element scroll events even though they do not
  bubble. `pointermove` is deliberately *not* in it — the pointer crossing the
  window is not an interaction, and counting it as one starves the queue for as
  long as the mouse keeps moving. Five chunks are warmed now, not two.
- **Ratchet the bundle budget** 550KB → 165KB. Left at 550 it would have let the
  entry chunk grow 3.7x before anything noticed.

**What it buys, and what it does not.**

| | before | after |
| --- | --- | --- |
| startup blocking | 723ms | 427ms |
| first scroll, warm-up's own contribution | 97ms blocking, 1 dropped frame | **0ms, 0 dropped** |
| first scroll, all causes | 196ms blocking, 2 dropped | 110ms, 1 dropped |
| first scheduler open | 300ms worst frame / 213ms blocking | 200ms / 147ms |

The warm-up's own contribution to the first scroll is gone, which was the
reported regression. The remaining 110ms is cause 2 — recharts' first mount,
which the Performance tile triggers itself and no warm-up can get ahead of.

**Three things a later session should not have to rediscover.** All three are
also filed in the checklist's `Open backlog` ("What is still open from the
first-scroll work"), since this file is the record of what closed and they did
not.

- **The cold/warm gap on a tile is not mostly the chunk.** Warming the scheduler
  chunk removes about a third of its cold cost; the rest is first-mount work
  that only rendering can pay — V8 compiling the subtree's functions on first
  call, `@xyflow` measuring, React's first reconciliation. Cold 147ms against
  warm 70ms is what is left after the chunk is already in memory.
- **Deferral moves work, it does not delete it.** A queue that steps aside for
  every interaction has to run in the gaps between them, and an action taken
  immediately after a scroll can still catch it mid-chunk. Raising the quiet
  window to 1000ms was tried and changed nothing measurable, so it stayed at 500.
- **`prefetch.ts`'s specifiers are load-bearing.** Vite keys a chunk by resolved
  specifier; a warm path that differs from the `lazy()` path by a directory hop
  resolves to a second copy of the module and warms nothing, silently. The
  checklist's Performant pillar now names that as the thing to verify.

**A Suspense boundary is a visual change, not just a loading one.** Splitting the
scheduler meant the editor arrived a frame later than the panel, so the tile's
grey surface settled and then the darker canvas snapped over it. `style.css`'s
`.lazy-panel-in` fades a lazily-arrived panel in over `--duration-fast`, on the
scheduler editor's root and both of the config editor's, reusing the shape and
the token `scheduler.css`'s node entrance already uses rather than inventing a
second timing. Opacity, not a transform, and for a concrete reason: a transform
on a still-mounting panel is what made WebView2 size the WebGL layer wrong in
the worlds tile, and React Flow measures its container on mount the same way.

**The specifier match is a test, not a comment.** A warm path that differs from
its `lazy()` path by a directory hop resolves to a second copy of the module:
the build succeeds, the tile opens, the warm-up buys nothing, and nothing
anywhere says so. That is the same silent shape as a token class compiling to no
rule, which is why `check-token-classes.mjs` exists, so this got the same
treatment: `pnpm check-prefetch`, wired into CI and `.claude/suite.json`
alongside it. It resolves both sets to real files and compares them, reads
source so it needs no build, and refuses to pass vacuously if its own pattern
stops matching. Confirmed to fail on a dropped warm entry, on a specifier
drifted to a different real module, and on a typo'd one before being confirmed
green. It started as a vitest case and moved: the frontend `tsconfig` carries no
`@types/node`, and adding one to let a test read the source tree would have been
a dependency bought to avoid using the `scripts/` directory that already exists
for exactly this.

**Verification.** `warmSequentially` is exported for its own sake — it returns a
canceller — and `lib/prefetch.test.ts` covers five behaviours over jsdom's
`setTimeout` fallback path (which is also the path a WebView without
`requestIdleCallback` takes): one chunk at a time, holding off under sustained
wheel events, a rejected chunk not stalling the queue behind it, cancelling
detaching every listener it attached, and completion doing the same. Two more
hold the specifier invariant above. `prefetchHeavyChunks` deliberately drops the
canceller and keeps its guard at module scope, which is worth not "fixing": wired
to an effect cleanup, StrictMode's double-invoke would cancel the queue on the
first teardown and then hit the guard on the way back in, leaving dev builds with
no warm-up at all. `ModAboutBody.test.tsx`'s three cases became async, since the
markdown now arrives through a Suspense boundary. Typecheck, lint (no new
warnings against main's 13), the full frontend suite, `pnpm check-bundle` against
the new 165KB budget, and a source-map pass confirming each of the five heavy
libraries lands in exactly one chunk with no second copy, all pass.


### 2026-08-30 — The catch attached to a call that never returned

**Closed: [#184](../../issues/184)**

**The gap.** The Stable pillar said the UI "degrades gracefully when the
Minecraft server process is offline or unreachable", and it was ticked. In the
browser-only `frontend-dev` preset it did not degrade at all: clicking
Performance replaced the entire dashboard with `render error / Cannot read
properties of undefined (reading 'main')`.

The mechanism is one line of generated code. Every binding is
`return window['go']['main']['App'][...](...)`, so with no `window.go` the call
throws `TypeError` *before a promise exists*. A trailing `.catch()` is therefore
attached to a call that never returned and never runs, and from a `useEffect`
body the throw walks up to the app-level `ErrorBoundary`, whose fallback is
`h-screen`. `lib/ipc.ts` already existed for exactly this, with `readOr()` for
reads and `hasWailsBridge()` for writes, and `SettingsModal.tsx` already used
it. These sites had never been converted.

**The fix.** Six reads now go through `readOr()`
(`tiles/performance/usePerformanceHistory.ts`,
`tiles/players/PlayerDetailPopup.tsx`, `tiles/backups/useBackupWorlds.ts`,
`tiles/mods/index.tsx`, `components/ServerRow.tsx`,
`components/ServerManager/ServerDetail.tsx`); one write branches on
`hasWailsBridge()` (`App.tsx`'s auto-start effect).

Two things the issue's list did not have, both found by auditing rather than
by trusting it. `ServerManager/ServerDetail.tsx` is a **seventh** site of
identical shape — `GetServerSummary(...).then().catch().finally()` driven by
`useEffect(load, ...)` — that nobody had noticed. And the issue's closing note
to "check any new one" of the `EventsOn` registrations turned out to be live:
`window.runtime` fails the same way, and three effects registered without a
try/catch, in `tiles/worlds/useWorlds.ts`, `tiles/mods/useMods.ts` and
`tiles/scheduler/editor/GraphEditor.tsx`. Those are why the worlds and mods
tiles still died after all seven binding sites were fixed. They now use the
`let off: (() => void) | undefined` + try/catch idiom their neighbours already
use, rather than a fourth spelling: the checklist's own EventsOn item notes
that a checker has to know every spelling in use, and adding one makes that
worse.

One site of [#185](../../issues/185) came with it, because the gate below could
not land without it: `QuickCommandsPanel.tsx:156` seeds default command buttons
with `SaveCommandButtons(...)` inside an async IIFE, outside its try blocks, so
with no bridge it rejected the IIFE's own promise on every launch. It is a
write, so it branches on `hasWailsBridge()`. The rest of #185 is event-handler
scope — reachable only by clicking, not by mounting — and stays open there.

**The gate.** A checklist line asking a reader to remember is what let seven
sites accumulate, so this closes with a test rather than a note:
`tiles/noBridge.test.tsx` mounts all eleven registry tiles, plain and maximized,
plus `ServerRow` and `ServerDetail`, and asserts none of them throws. It mocks
**nothing**. jsdom has no `window.go`, so the real generated bindings fail there
exactly as they do in the preset; an automock would resolve `undefined` instead
of throwing and every case would pass vacuously. The same reasoning as
`check-prefetch`'s empty-set guard, and the file carries the same kind of
premise assertion: it first checks that the real binding still throws.

**Known and accepted:**

- The gate covers **mount**, not interaction. A binding called from a click
  handler still rejects unhandled, which is the rest of #185.
- Tiles that reach their own error state under no bridge render the raw
  `TypeError` text as their message (visible in the backups tile). That is the
  tile's error copy, not this defect, and was left alone.
- `QuickCommandsPanel`'s two reads at `:134`/`:147` are inside a `try`, so they
  are caught, but they still `console.error` the raw TypeError on every launch
  of the preset. Caught and noisy beats uncaught; not widened here.
- The app-level `ErrorBoundary` is still the only one. This removes the live
  trigger, not the blast radius: the P2 backlog item for a boundary inside
  `TileWrapper`'s content slot is unchanged, and its file is currently hot.

**Verification.** All 17 checks in `.claude/suite.json` pass via
`.claude/suite-check.py`. Frontend suite 603 tests across 47 files, up from 578;
lint holds at 13 warnings, byte-identical to the count on a stashed tree, and
typecheck and `format:check` are clean. The gate was confirmed non-vacuous by
reverting the `usePerformanceHistory` fix alone and watching exactly the two
performance cases go red, then restoring.

Then the reproduction the issue names, driven in Chromium against
`vite --port 5199`. Before: `render error` on screen after load, two uncaught
`pageerror`s, and the run could not proceed past it. After: no `render error` at
any point, **zero** uncaught page errors, and every tile added from the crate —
Performance, Players, Backups, Plugins & Mods, Worlds, Scheduler, Config —
renders its own unavailable state inside its own tile while the app stays up.

That last run also surfaced a defect this change did not cause and did not fix:
the performance tile spins a render loop whenever its history is empty, because
`index.tsx:113` anchors on `Date.now()` per render and feeds it to a `setState`
effect keyed on that value. It was masked before, since the tile could not
render at all in this preset. Filed as [#209](../../issues/209). A separate
sweep of the worlds scene's camera, prompted during the same session, is
[#208](../../issues/208).


### 2026-08-30 — The narration you had to read to know whether it worked

**The gap.** #113 gave the console Konnekt's own voice, and it worked: a backup,
a restore, a quiesce and a crash all say so now. What it could not say was how
any of them went. `ConsoleLine.Source` marks *who* spoke, and that was the whole
of the marker, so "Backup finished: world.zip (412.7 MB)" and "Backup failed:
disk error" arrived identical as far as the UI was concerned — one `manager`
level, one colour, `text-sky-400`. Telling them apart meant reading the sentence,
which is exactly what a user scrolling a thousand lines of server output during
trouble is least able to do.

Two smaller things came with it. The `[Konnekt] ` tag every narrated line
carried was pure presentation duplicating a marker that was already structural,
and it cost eleven columns on every line in the one panel where width is
scarce. And `text-sky-400` is a raw Tailwind palette colour: it sat outside the
token layer entirely, so narration was the one thing in the app that ignored
Settings > Appearance and kept its dark-theme blue on a light canvas.

**The fix** (`backend/models/console.go`, `backend/services/server.go`,
`backup.go`, `loader.go`, `app.go`; frontend `useConsoleStore.ts`, `App.tsx`,
`tiles/console/index.tsx`). `ConsoleLine` gains `Outcome` — `progress`, `ok`,
`failed` — mirrored as an optional `outcome` key on the `log:line` payload,
omitted entirely when empty, exactly the contract `source` already had. So
server output travels the payload it always has and the `map[string]string`
shape assertion still holds.

The outcome is structural for the same reason the source marker is: classifying
it from the wording would read "Backup failed: …" by the word `failed`, which is
the substring heuristic #113 removed. The narrator knows what happened, so the
narrator says it. `Narrate` keeps its name and now means progress; `NarrateDone`
and `NarrateFailed` are its twins, and picking one at each of the twenty call
sites is the whole of the classification. `BackupService` and `LoaderService`
grew matching nil-safe forwarders.

Three lines resist the three-way split and stay yellow deliberately: the
force-kill escalation, the ready-line timeout fallback, and "Resuming world
saves". Green would claim a clean finish and red would claim a break; none of
the three is either, and yellow is the only one of the three that overstates
nothing. A manager line with a missing or unrecognised outcome falls back to
progress on the same reasoning — a line from a path predating the marker gets a
dot, but never an invented verdict.

On the frontend the narration stops being a coloured line and becomes its own
block: hairline outline, faint tint, a status dot, `w-fit` so a run of them
reads as discrete blocks rather than banding the panel. The `[Konnekt] ` tag is
gone, because the block already says who is speaking and the dot says how it
went. Colours are `--success`/`--warning`/`--danger`, which `applySkin()`
overrides at runtime, so narration now retints with the user's chosen status
colours and picks up the light theme's darker variants. The dot carries
`role="img"` and a name — it is the only thing stating the outcome and sits in
no labelled control, unlike the `aria-hidden` icons inside an `IconButton`. Its
`h-5` wrapper matches `leading-5`, which centres it on the first line however
far the text wraps, with no offset to re-tune when the type scale moves.

The level filter is untouched: it stays a *server log level* filter, so
narration still appears under All rather than being swept into Warn or Error.

**Known and accepted:** the console's server-output levels still use raw
`text-yellow-400` / `text-red-400` / `text-[var(--text-secondary)]`, so a WARN
line does not follow the user's warning colour the way a narration block now
does. That is the same gap this entry closes for narration, one level over, and
it was left alone rather than widened into a second concern in one change.

**Verification.** Go: `TestNarrateMarksManagerLines` now pins both markers and
both zero values (server output carries neither key), and a new
`TestNarrateVerbsCarryTheirOutcome` pins verb to outcome. The backup round trip
asserts the outcome sequence progress → ok → progress → ok alongside the
existing ordering, and the corrupt-archive case asserts the failure line is
marked `failed` rather than merely worded that way. The two "no banner at all"
assertions moved off the `[Konnekt]` substring onto `Source == sourceManager`,
which is what they meant. `backend/services` coverage 49.9%, floor 47%.

Frontend: the store tests cover all three outcomes, the progress fallback for a
missing or unknown value, and both markers through `appendLine` and
`loadHistory`; the tile tests assert the block, the per-outcome outline and dot
colour, and the dot's accessible name. 607 tests across 47 files, up from 603;
lint holds at 13 warnings, byte-identical to before. Entry chunk 150.4 KB gzip
against the 165 KB budget, and `check-tokens` confirms every token class
compiles. The emitted CSS was checked directly to confirm the utilities resolve
through `var(--success)` rather than baking the value at build time, which would
have silently broken `applySkin()`.

Then the real thing, rendered in Chromium at both themes against a seeded
console: server output in its four levels interleaved with all three narration
outcomes. The blocks read at a glance in both, and the light theme picks up its
darker status variants as intended.
