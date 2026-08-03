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

---

## Remediation backlog

Concrete, prioritized follow-ups based on the most recent review. This section
*is* allowed to go stale/get checked off — unlike the checklist above, it's a
todo list, not a target.

**P0 — CI foundation**
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

**P1 — CI blind spot: `@react-three/fiber`/`@types/three` resolution-dependent typecheck failure**
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

**P1 — Auto-updater: check, release pipeline, and in-place install all shipped**
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

**Done — Lint/format enforcement (frontend)**
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

**P1 — Inline styles → Tailwind utilities (Milestone 2)**
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
- 143 `style={{}}` usages remain across 35 files. Continue tile-by-tile —
  the remaining hotspots: worlds (45: `WorldHud.tsx` 19, `index.tsx` 15,
  `scene/WorldsScene.tsx` 6, `scene/Planet.tsx` 5) and players (32:
  `PlayerDetailPopup.tsx` 17, `PlayerRoster.tsx` 9, `PlayerCard.tsx` 4,
  `PlayerGrid.tsx` 2). The rest (`App.tsx` 6, and already-migrated tiles'
  documented exceptions) are accounted-for survivors, not backlog. worlds'
  react-three-fiber scene code and players' server-scoped data mean both will
  need `wails dev` + a configured server for full live verification, same
  limitation as backups/mods/scheduler/config previously.

**P2 — React Compiler-readiness lint rules**
- Revisit enabling `eslint-plugin-react-hooks`'s full `recommended`/
  `recommended-latest` rule set (`purity`, `refs`, `set-state-in-effect`,
  `immutability`, etc.) — currently scoped down to classic `rules-of-hooks` +
  `exhaustive-deps` only (see Lint/format enforcement above). The ~60 findings
  it currently surfaces are concentrated in the r3f scene code and would need
  a dedicated pass with test coverage in place first.

**P2 — Missing `--font-mono` theme token**
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

**P1 — Test coverage + gate**
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

**P1 — Code-split heavy tiles**
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

**P2 — Undocumented blank error-ignores**
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

**P2 — Structured logging**
- Replace ad-hoc `fmt.Errorf`-only error reporting on the backend with
  `log/slog` for diagnosable runtime logs, keeping the existing `EventBus`
  emissions for UI-facing notifications.

**P2 — Repo hygiene**
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

**P1 — Scheduler node-system deep analysis**
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
  have since been completed.)

**P2 — Memoization pass**
- Add `React.memo` to the most expensive tile components (3D scenes, chart
  tiles) identified during a profiling pass.

**P3 — Bound method missing `(T, error)` return**
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
