# Konnekt — Project Health Checklist

An evergreen yardstick for periodically measuring project health across four
pillars: **Clean, Stable, Scalable/Future-proof, Performant**. Run this check
before each milestone (e.g. alpha → beta) or roughly monthly.

**How to use this doc:** compare the current codebase against the items below.
Do **not** edit this list to match whatever the code currently does — it's the
target, not a snapshot. When a gap is found, track it as an item under
`Open backlog` below (or the repo's issue tracker), fix it, then re-run the
checklist. This file should look almost the same every time you open it; only
the `Open backlog` section should churn. Completed remediation history — the
detailed, per-session narrative of gaps already closed — lives in
`agent_docs/HEALTH_LOG.md`, not here.

See `agent_docs/CLAUDE.md` for architecture conventions and build commands, and
`agent_docs/ROADMAP.md` for feature scope. This doc doesn't duplicate either —
it's the quality gate that sits alongside them.

Canonical gate set — declared in `.claude/suite.json` and run together by
`/suite-kit:health`, which reports them as a table:
```bash
pnpm typecheck          # tsc --noEmit (from frontend/)
pnpm lint               # ESLint (from frontend/)
pnpm test               # vitest (from frontend/)
pnpm format:check       # Prettier (from frontend/)
pnpm format:website     # Prettier over website/ (from frontend/)
node scripts/check-website-links.mjs   # website links/assets/sitemap (repo root)
node scripts/check-release-notes-extract.mjs   # changelog page's body extract (repo root)
pnpm check-bundle       # 550 KB gzip entry-chunk budget (from frontend/)
pnpm check-tokens       # every token-named class compiles (from frontend/, after a build)
pnpm check-issue-templates   # .github/ISSUE_TEMPLATE forms + their labels (from frontend/)
python3 .github/scripts/release-notes_test.py  # release-notes classifier (repo root)
go vet ./...            # Go static analysis (repo root)
go test ./...           # Go tests (repo root)
go run ./scripts/coverage-floor   # backend/services coverage floor (repo root)
```
Plus the generated-file check `suite.json` declares: `pnpm gen:tokens` then
`git diff --exit-code src/styles/tokens.css src/styles/tokens.ts
../website/tokens.css`. A non-empty diff means a generated token file was
hand-edited (the next run reverts it) or `tokens.source.json` was refreshed
without regenerating. The third output is the marketing site's copy: the same
values as plain `:root` custom properties, since that site has no Tailwind.

And the invariant `suite.json` declares, `no literal border widths` — a grep for
`border-[Npx]` under `frontend/src/components` and `frontend/src/tiles` that must
find nothing. Read that entry's `diagnosis` before judging a match; the rule is
about the token layer, not the regex.

Where the plugin is not installed — CI, a cloud container, an unattended agent —
`.claude/suite-check.py` reads the same manifest and runs the same three sections
(`commands`, `invariants`, `generated`). `--json` for one record per check.

Note `go vet`/`go test` need `frontend/dist` to exist first (`main.go`'s
`//go:embed all:frontend/dist`), so run `pnpm build` before them in a clean
tree.

---

## 1. Clean

- [x] `go vet ./...` and `gofmt -l .` report nothing.
- [x] No blank `_ =` error-ignores in Go, except documented `//nolint` cases
      (e.g. `backend/services/eventbus.go`).
      Verify: `grep -rn "_ = " --include=*.go app.go backend/ | grep -v nolint`
      — expect no matches (test files aside; `_test.go` sites are excluded by
      the sweep, as they were in 2026). The repo-root files are in range of
      that grep now, which is what the 2026 sweep missed.
- [x] `pnpm lint` runs against a real ESLint config and passes.
- [x] Formatting (Prettier/Biome or equivalent) is consistent and enforced,
      not manual (lefthook pre-commit hook: Prettier + ESLint + `tsc --noEmit`
      on staged frontend files, `gofmt` + `go vet` on staged Go files). The
      whole `frontend/` tree is Prettier-clean and CI runs `pnpm format:check`,
      so this no longer depends on the hook alone — note the frontend hook's
      glob is `*.{ts,tsx,css}` and doesn't cover the JSON/`.mjs` that Prettier
      itself does. `website/` is covered the same way, by its own
      `website/.prettierrc.json` — identical to the frontend's except that it
      drops the Tailwind class-sorting plugin, since the site is not Tailwind —
      run as `pnpm format:website` in the `website` CI job and by a second
      lefthook glob. One Prettier version in the repo, two configs.
- [x] `pnpm typecheck` has zero errors; no `any` anywhere (CLAUDE.md rule) —
      use `unknown` and narrow instead. One documented exception:
      `frontend/src/tiles/worlds/scene/Sun.tsx` (known `three`/`@react-three/fiber`
      cross-package type mismatch).
- [x] Nothing under `frontend/wailsjs/` has been hand-edited (it's
      auto-generated; regenerate via `wails generate module` instead).
      Verify: run `wails generate module`, then
      `git diff --exit-code frontend/wailsjs` — a non-empty diff is a hand edit.
      Run this with the **same CLI version `go.mod` pins** (v2.12.0): a
      different generator writes a diff that is a version difference, not a
      hand edit. 83/83 bound methods and all 36 emitted structs round-tripped
      byte-identical (re-verified 2026-08-20).
      The CLI is not preinstalled in a cloud container and two sessions assumed
      that made this uncheckable. It does not:
      `go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0` takes one
      command, and regenerating with no source change is the zero-diff baseline
      that makes the check meaningful. Do that before concluding a binding fix
      is out of reach.
- [x] No bound method reaches a struct through a **map value**. Wails' generator
      does not descend into one, so it emits a `Record<string, models.X>`
      referencing an `X` it never declares; `skipLibCheck` hides the dangling
      reference and the return type degrades to `any`.
      Verify: `go test . -run NoBoundMethodHidesAStructInsideAMapValue`, which
      reflects over `App`'s real type graph rather than diffing generated
      output, so it also catches a *new* method with that shape. Maps of
      primitives are fine and stay allowed. Closed 2026-08-20 (HEALTH_LOG).
- [x] TypeScript shapes that cross IPC are **aliased** from `wailsjs/go/models`,
      not redeclared by hand. Structural typing catches a renamed or removed
      field; a field *added* on the Go side is silently missing from a copy.
      Verify: from `frontend/`,
      `grep -rn "^export interface" src/types/index.ts` — every entry should
      either have no Go counterpart (`TileProps`, `TileDefinition`) or carry a
      comment saying why it cannot alias. Two do: `AppSettings` and
      `ConfigFile` narrow Go `string`s to string-literal unions that
      `useSettingsStore`, `lib/theme.ts` and the config tile all depend on, so
      aliasing them would widen the types and delete exhaustiveness checks. Do
      not "finish the job" on those two.
- [x] No inline `style={{}}` beyond genuinely dynamic/computed values
      (animation delays, transforms, react-grid-layout position props) —
      Tailwind utilities backed by CSS-variable tokens otherwise (see
      CLAUDE.md's Code style section). Milestone 2 is complete, and
      `eslint.config.js` now sets `no-restricted-syntax` to `error` globally
      with no per-directory allowlist, so a new file is covered the moment it
      exists rather than when someone remembers to list it. Every remaining
      justified exception carries a documented `eslint-disable-next-line`.
      Verify with `pnpm exec eslint src` — expect 0 errors.
- [ ] New transition/animation durations and easing curves reuse an existing
      `--duration-*`/`--ease-*` token (`frontend/src/styles/tokens.css`'s plain
      `@theme` block — the token layer is **generated** from the vendored
      `tokens.source.json`, so the gate here is "reuse a token", never "edit
      one"; changing a value is an upstream `kollektiv/design/tokens.json` edit
      followed by `pnpm gen:tokens`) unless the motion is genuinely unique
      (e.g. a one-off decorative loop) — no undocumented one-off magic numbers.
      This isn't "all animations must look identical": a snappy hover, a panel
      slide/open-close, and a decorative splash/spin legitimately warrant
      different timing — the goal is a shared vocabulary for the common
      cases, not uniformity.
      Verify: from `frontend/`, all **five** of these, because a motion literal
      has five spellings and the arbitrary-value one is the *least* common:
      ```bash
      grep -rnE "(duration|delay)-\[[0-9.]+m?s\]|ease-\[" src   # arbitrary values
      grep -rnE "\b(duration|delay)-[0-9]+\b" src                # Tailwind's own scale
      grep -rnE "\[transition:[^]]*\]" src                       # arbitrary shorthand
      grep -rnE "transition:|animation:" src src/style.css        # inline + hand CSS
      grep -rnE "\.style\.(transition|animation)\s*=" src         # direct DOM assignment
      ```
      The fifth was added 2026-08-19. It has no colon after the property name,
      so none of the other four can see it, and it is live: `Dashboard.tsx`
      drives the whole tile maximise/minimise FLIP through it. Two greps have
      now each been "the complete set" and each missed a spelling, so treat the
      list as a floor, not a proof. Also chase symbolic constants to their
      literal (`focusLayout.ts`'s `FOCUS_TRANSITION`,
      `useGridPageAnimation.ts`'s `PANEL_DURATION`) — the grep sees the name,
      not the value.
      Every match must be a documented one-off, not a near-miss of an existing
      token. See backlog ("P2 — Motion one-offs outside the token vocabulary").
- [x] No committed build artifacts (`*.syso`, `frontend/dist/`, `build/bin/`)
      — `.gitignore` covers them.
- [x] No stray root-level scratch/design docs left un-triaged (either promoted
      into `agent_docs/` or deleted once the work lands).
- [x] `agent_docs/CLAUDE.md` and `agent_docs/ROADMAP.md` still reflect the
      actual stack/structure/scope — update them when they drift.
      Verify: read CLAUDE.md's "Project structure" against the real top-level
      dirs under `frontend/src/` and `backend/`, and its "Build & dev commands"
      table against `frontend/package.json`'s `scripts`. Then read ROADMAP.md's
      **non-feature** sections too — "Later", "Explicitly out of scope" and
      "Implementation notes" are the ones that rot unwatched, because nobody
      re-reads them while shipping a feature. That is where a whole block of
      *Kommands* roadmap had been sitting (see HEALTH_LOG, 2026-08-19): the
      suite shares a design source and a docs shape, so prose copied between
      products is a live failure mode here, not a hypothetical one.
- [x] No obviously dead code (unused exports, unreachable branches, orphaned
      files) left behind after refactors.
      The per-file grep this line used to prescribe only finds what you already
      suspect, which is how a tombstone file survives: nobody greps for a name
      they have forgotten. Sweep the whole tree instead, from both ends —
      Go: `deadcode ./...` and `staticcheck -checks=U1000 ./...`, each under
      **both** `GOOS=linux` and `GOOS=windows`, since the per-OS files
      (`server_windows.go`) make either one alone produce false positives.
      Frontend: build the import graph and list files nothing imports (expect
      only `*.test.*`, `main.tsx`, `vite-env.d.ts`), then reference-count every
      `export` across every other file. A zero-external-reference export is
      **not** automatically dead — the props-interface-beside-its-component
      convention accounts for ~14 of them; dead means zero references *including*
      its own file. Note ESLint already covers what it structurally can
      (`no-unreachable`, `no-unused-vars` are on via `js.configs.recommended`),
      so findings here are always whole exports or whole files.

## 2. Stable

- [x] Automated tests exist and pass for critical paths: RCON client, Modrinth
      API client, backup create/restore, config path-traversal guards,
      scheduler engine (Go); Zustand store logic and critical hooks (frontend).
      `backend/services` sits at **41.1%** of statements, with a **39%** floor
      owned by `scripts/coverage-floor` and run by both `/suite-kit:health` and
      CI. The floor is a ratchet: raise it as coverage rises, never lower it to
      green a red build. Coverage is a proxy, not the goal — prefer a test that
      would have caught a real bug over one that only moves the number.
- [x] CI is green on every push/PR (`.github/workflows/ci.yml`: a `frontend`
      job, an `invariants` job running `.claude/suite-check.py` over the
      manifest's `invariants` and `generated` sections, a `website` job
      (Prettier plus the link/asset check), a `backend` job on windows-latest,
      and a `backend-linux` job in a webkit2gtk-4.1 container — the only place
      `server_linux.go`/`server_unix.go`/`server_other.go` are compiled).
- [x] All Go methods bound to the Wails `App` struct return `(T, error)`, and
      errors are wrapped with context (`fmt.Errorf("...: %w", err)`).
      82/82 as of 2026-08-19.
      Verify: `grep -nE "^func \(a \*App\) [A-Z]" app.go` — every hit must end
      in `error)` or `error {`. (`beforeClose`/`startup` are Wails lifecycle
      hooks, not bound methods, and are exempt.)
- [x] Every `EventsOn` listener registered in a component is cleaned up on
      unmount — no leaked subscriptions.
      Verify: from `frontend/`, `grep -rn "EventsOn" src` — each call site must
      sit in a `useEffect` whose cleanup invokes the returned unsubscribe.
      **47 registrations across 13 files**, all clean. Recounted 2026-08-20:
      this line said "25 across 12" and had been wrong for a while — `App.tsx`
      alone holds 19. Count with
      `grep -rn "EventsOn(" src --include=*.ts --include=*.tsx | grep -v "\.test\."`
      and subtract nothing but comments; the import line spells it `EventsOn }`
      and does not match.
      Three spellings are in use and a check has to know all three, or it
      reports a false leak: a single `let cleanup` handle, numbered `c1…c5`
      handles, and an array drained in the cleanup (`offs.push(...)` in
      `ServerInstallModal.tsx`, an array literal in `hooks/useServerStatus.ts`).
      Registration is always synchronous inside the effect — no `await` before
      the handle is captured — which is what rules out the
      unmount-before-assignment leak.
      One asymmetry, noted not fixed: `hooks/useServerStatus.ts` wraps its whole
      `forEach` in one `try`, so a throwing first `off()` would skip the rest,
      where `ServerInstallModal.tsx` puts the `try` inside the loop.
- [x] No frontend data is driven by `useEffect` polling when it should be a
      Wails event listener (CLAUDE.md rule). Every data poll is closed: the
      players tile's 3s poll, then the stats/backups/mods 10s polls (see
      HEALTH_LOG). The only remaining `setInterval` under `src/` is
      `App.tsx`'s 150ms console-log batcher, which is a render-batching
      measure rather than data fetching. Check with
      `grep -rn "setInterval" src --include=*.ts --include=*.tsx | grep -v test`.
- [x] Process lifecycle stays safe: Windows Job Object child cleanup intact
      (`backend/services/server_windows.go`), RCON dial/operation timeouts
      present (`backend/services/rcon.go`), Modrinth HTTP client keeps its
      timeout + 429/`Retry-After` retry handling (`backend/services/modrinth.go`).
      Verify: `grep -n "JobObject" backend/services/server_windows.go`,
      `grep -n "Timeout" backend/services/rcon.go`, and
      `grep -nE "Retry-After|429|Timeout" backend/services/modrinth.go` — all
      three must still match.
- [x] A failure that happens outside the window's lifetime still leaves a trace
      on disk. A packaged GUI build has no terminal, so anything written to
      stdout/stderr is gone, and `EventBus` emissions die with the window.
      Verify: from the repo root,
      `grep -rn "fmt.Print\|println(" app.go main.go backend/ --include=*.go | grep -v _test`
      — expect nothing that is a diagnostic (writes to a server process's stdin
      are not). New backend diagnostics go through `log/slog`, which
      `services.InitLogger` points at `konnekt.log` in the app data dir.
      Closed 2026-08-20 (HEALTH_LOG). Adding a log-rotation dependency is a
      decided "no" — see `DEPENDENCIES.md`.
- [x] Store write actions record the failure and rethrow rather than applying
      the optimistic update anyway, per `agent_docs/CLAUDE.md`'s IPC
      conventions. All five stores that write comply as of 2026-08-20
      (HEALTH_LOG); `useSchedulerStore` is the reference shape.
      Verify: from `frontend/`,
      `grep -rn "best-effort" src/stores` — expect no matches, and read any
      `catch` in a write action against the rule. The rethrow is only half:
      grep the action's callers too, since a store that rethrows into a caller
      that ignores it is the same bug one level up.
      Note the one sanctioned exception, or it will be "fixed" back: a rejection
      with **no Wails bridge at all** (`lib/ipc.ts`'s `hasWailsBridge()`) keeps
      the optimistic value, because that is the `frontend-dev` preset in
      `.claude/launch.json` and hard-failing there makes the browser preview
      read-only. Only a bridge-present rejection reverts.
- [x] `ErrorBoundary` wraps the app and the UI degrades gracefully when the
      Minecraft server process is offline or unreachable.
      Verify: `grep -n "ErrorBoundary" frontend/src/main.tsx` (`:5`/`:18`/`:21`),
      then assert the per-tile offline states in jsdom rather than at a desk —
      this line assumed a GUI for years and did not need one. See
      `tiles/console/index.test.tsx` and `tiles/players/emptyStates.test.tsx`
      for the pattern: mock the binding, reject it, assert the tile names the
      state. Closed 2026-08-20 (HEALTH_LOG).
      Two flags, not one: `useServerStore`'s `status.running` says whether the
      server is up, `reachable` says whether the backend answered at all. A tile
      that renders "nothing here" must branch on both, or an unreachable server
      reads as a healthy idle one. `reachable` is hydrated in `App` by
      `hooks/useServerStatus.ts` — never re-tie that to a single tile's mount.

## 3. Scalable / Future-proof

- [x] Heavy per-tile dependencies are lazy-loaded on demand, following the
      existing pattern in `frontend/src/tiles/worlds/index.tsx` (`React.lazy`
      + `Suspense`): worlds' three.js/@react-three scene, and recharts
      (performance tile, `tiles/performance/charts.tsx` — see HEALTH_LOG.md's
      "P1 — Code-split heavy tiles"). The backups tile has **no** three.js
      dependency — its "planets" are pure SVG/CSS (`WireframeSphere.tsx`,
      `SolarSystem.tsx`); a repo-wide grep confirms `three`/`@react-three`
      appear only under `worlds/scene/`.
- [x] Production bundle size stays within an agreed budget (550 KB gzip on the
      entry chunk, ~12% headroom over the measured post-split size), checked
      in CI (`frontend/scripts/check-bundle-size.mjs`, `pnpm check-bundle`).
- [x] `frontend/src/tiles/registry.ts` was extended, not restructured, when
      new tiles were added. (Two sanctioned exceptions while the tile grid's
      placement model was under active repair — see HEALTH_LOG.md: loose
      per-tile `defaultW`/`defaultH`/`minW`/`minH` numbers became an
      `sm`/`md`/`lg` bucket shape, then that shape was removed outright —
      every tile now shares one size from `lib/gridSizing.ts`, and a
      `TileDefinition` entry is just `{ id, label, icon, maximizable?,
      component }`. The rule applies fully to that shape going forward.)
      Verify: `git diff main -- frontend/src/tiles/registry.ts` — added entries
      only, with `TileDefinition`'s shape unchanged.
- [x] Each Zustand store still owns exactly one domain — no cross-domain state
      mixing creeping in.
      Verify: from `frontend/`, `grep -rn "stores/" src/stores` — a store
      importing another store's state is the failure.
- [x] Go structs in `backend/models/` remain the single source of truth for
      TypeScript types; bindings were regenerated (`wails generate module`)
      after backend model changes.
      Verify: run `wails generate module`, then
      `git diff --exit-code frontend/wailsjs/go/models.ts` — a diff means a
      `backend/models/` change shipped without regenerating. Both halves hold as
      of 2026-08-20 (HEALTH_LOG). A clean regeneration diff is necessary but was
      never sufficient: a struct Wails never emits used to get hand-copied
      instead, with `skipLibCheck` hiding the dangling reference. The two items
      under Clean now cover that — no bound method hides a struct in a map
      value, and IPC shapes are aliased rather than retyped.
- [x] Dependencies (Go modules, npm packages) are reasonably current, with no
      unmaintained or duplicated libraries doing the same job.
      Verify: `go list -m -u all` at the root and `pnpm outdated` from
      `frontend/`; `pnpm why <pkg>` for anything suspected of being vendored
      twice — the duplicate-`three` incident in HEALTH_LOG.md is the shape of
      failure this catches. Checked 2026-08-19: everything is behind by a patch
      or a minor, nothing by a major; `three`/`@types/three` remain single
      copies, so that incident stays closed. Two duplicates exist and both are
      benign — `react-is` (16/17, the usual transitive spread) and **`zustand`
      4.5.7 alongside the app's 5.0.14**, pulled by `@xyflow/react` and by
      `tunnel-rat` under `@react-three/drei`. Unlike the `three` case that is
      not a hazard: it duplicated a *type* two packages had to agree on, while
      these are private runtime stores nothing shares across the boundary.
      Re-confirm rather than re-investigate. The one worth watching is
      `wails/v2`, three minors behind at v2.12.0 — and note `go.mod`'s pin is
      what the `frontend/wailsjs/` regeneration check must run against.
- [x] New Go dependencies were checked against `agent_docs/DEPENDENCIES.md`
      before being added. All four direct requires present, none dropped.
      Verify: every direct require in `go.mod` appears in that file's inventory
      table with a rationale, and nothing in the table has since been dropped.
- [x] Local-first invariant holds: no `localStorage`/`sessionStorage` usage;
      all persistence goes through Go file I/O into the Wails app data dir.
      Repo-wide grep confirms zero occurrences under `frontend/src/`. The one
      violation found (scheduler `BlockPalette.tsx`'s palette-collapse and
      per-category-collapse prefs) has been migrated onto `AppSettings` →
      `app_settings.json`, the same Go-backed path console/notify prefs
      already use — see HEALTH_LOG.md's "P1 — Scheduler node-system deep
      analysis".
      Verify: from `frontend/`,
      `grep -rn "localStorage\|sessionStorage" src` — expect no matches.

## 4. Performant

- [x] Console log lines are still batched (150ms flush window in `App.tsx`) so
      re-render rate stays bounded on busy servers.
      Verify: from `frontend/`, `grep -n "setInterval" src/App.tsx` — the
      batcher must still be there, and still be the only `setInterval` under
      `src/` (see the Stable pillar's poll check).
- [x] Circular/ring buffers still cap memory growth: performance history
      (`usePerformanceHistory.ts`), console buffer (`useConsoleStore.ts`, user
      configurable cap), backend stats history and console ring buffer
      (`backend/services/stats.go`, `backend/services/server.go`).
      Verify: each of those five sites must slice or shift when it appends —
      `grep -nE "slice\(|\.shift\(|len\(.*\) >" ` over them. An unbounded
      append is the failure.
- [x] Poll cadences remain deliberate and haven't crept down accidentally: TPS
      RCON poll (~15s, with server-flavor caching), stats tick (~10s). The
      scheduler's next-run countdown is no longer polled at all — the Go
      per-minute ticker (and each graph mutation) pushes `schedule:next-runs`.
      Verify: `grep -rnE "time\.(NewTicker|Tick)\(" backend/services` — every
      interval must match the cadence documented here, and a new one must be a
      deliberate addition rather than a copied default.
- [ ] Expensive tile subtrees are memoized (`React.memo` / `useMemo` /
      `useCallback`) so parent re-renders don't cascade into them — pay
      particular attention to the 3D scenes (backups sphere, worlds planetary
      system) and chart-heavy tiles.
      Verify: React DevTools Profiler over a drag of the tile grid — a scene or
      chart subtree that re-renders on an unrelated parent update is the
      failure. Tracked as an open backlog item until a profiling pass runs.
      Like the `ErrorBoundary` item above, this one needs a running GUI and so
      cannot be closed from a headless session; a static "which subtrees lack
      `React.memo`" pass would produce a list, not evidence, and the point of
      the item is the evidence.
- [x] Production bundle has been profiled recently (e.g. `vite build` output
      or a bundle analyzer) and heavy libraries remain lazy rather than eager
      (three.js via Worlds, recharts via Performance — see Scalable pillar).
      Verify: `pnpm build` from `frontend/`, then confirm `three` and `recharts`
      land in their own chunks rather than the entry chunk.

---

## Open backlog

The remaining, not-yet-closed follow-ups. Each item's full remediation write-up
moves to `agent_docs/HEALTH_LOG.md` once it's done — keep this section short and
current. Priorities mirror the pillars above.

**P2 — Motion one-offs outside the token vocabulary** (largely closed 2026-08-19)
- The motion vocabulary is three tokens: `--duration-fast` (150ms),
  `--duration-panel` (280ms) and `--ease-standard`
  (`cubic-bezier(0.4, 0, 0.2, 1)`). What stays open is the part needing a value
  the upstream source does not hold.
- **Know this before touching a duration utility.** Tailwind v4 resolves
  `duration-*` against the `--transition-duration-*` namespace and `delay-*`
  against `--transition-delay-*`, never against `--duration-*`. `ease-*` *does*
  read `--ease-*`, which is why `ease-standard` always worked and its duration
  counterpart silently did not: `duration-fast` compiled to nothing and the
  element fell back to Tailwind's own `--default-transition-duration`, which is
  150ms, so the two `duration-fast` call sites looked correct by coincidence.
  An earlier version of this entry called converting `duration-[280ms]` to
  `duration-panel` a safe no-op; it would have regressed that panel to 150ms.
  `gen-tokens.mjs` now emits `--transition-duration-<name>` alongside each
  `--duration-<name>` from the same source value, and `.duration-fast` /
  `.duration-panel` are real utilities in the built CSS. `--duration-*` remains
  the name hand-written CSS and inline `transition:` strings read. Do not
  hand-add a namespace; both spellings come from one `tokens.source.json` entry.
- **Adopted, each verified in the built CSS** (2026-08-19): `BrowsePanel.tsx`'s
  panel slide and resize-handle transition, `TileWrapper`'s border fade,
  `style.css`'s `.tile-outer` and resize handle, `scheduler.css`'s node and edge
  entrances (neither of which the previous version of this entry had found), and
  `Segmented.tsx`'s longhand copy of `--ease-standard`. The three
  `duration-[220ms]` values in `tiles/backups/index.tsx` are now
  `duration-panel`: they are one choreographed motion off a single `panelOpen`
  flag, so the token keeps them in lockstep by construction. That was a
  deliberate 220 → 280ms change, the only visual change in the pass.
- **Decided and annotated, not converted.** Each decorative site now carries a
  comment saying why it keeps its literal: `SolarSystem.tsx`'s overshoot
  springs, entrance rise and per-world float; `WorldsScene.tsx`'s 400ms scene
  reveal; `WireframeSphere.tsx`'s idle spin; `scheduler.css`'s run pulse;
  `style.css`'s flash ring and splash. `WorldsScene.tsx`'s 250ms HUD slide stays
  250ms and now says why: it is hand-matched to the camera's exponential damp
  (`MathUtils.damp` at lambda 4.5), which has no fixed duration to share a token
  with. The six `ease-[ease]` sites in the backups tile stay too, with the
  reason recorded at the top of the stage block — it is CSS's plain `ease`
  keyword, `cubic-bezier(0.25, 0.1, 0.25, 1)`, a genuinely different curve, and
  Tailwind ships no bare `ease` utility, so the escape hatch is the only
  spelling available. Undecided was the defect; these are decided now.
- **Still open, and genuinely upstream.** Two curves have no token and cannot
  get one from this repo:
  - `cubic-bezier(0.34,1.15,0.64,1)` — **seven** sites, not the three this entry
    used to claim: `ServerInfoPanel.tsx:59`, `WorldInfoPanel.tsx:53`,
    `BackupCarousel.tsx:182`, `BackupCard.tsx:41`, `focusLayout.ts:3` (behind the
    `FOCUS_TRANSITION` constant, which is why a grep alone never saw it), and
    `Dashboard.tsx:195`/`:216`.
  - `cubic-bezier(0.4, 0, 1, 0.6)` — `Dashboard.tsx:239`/`:244`, an accelerate
    curve for the tile minimise, unrelated to anything else here and
    undocumented until now.
  Adding either is an edit to `kollektiv/design/tokens.json`'s `motion.easing`,
  then kollektiv's `scripts/sync-tokens.sh`, then `pnpm gen:tokens` here.
- **Also still open, smaller.** Roughly 14 `duration-200`/`-300` values on
  Tailwind's own numeric scale are near-misses nobody has ruled on. They read as
  a token would, they just are not one. And `tokens.ts` still exports colours
  only, so `useGridPageAnimation.ts`'s `PANEL_DURATION = 280` and
  `Collapsible.tsx:27`'s bare `280` still hold numbers a JS-readable motion
  export would replace — a `gen-tokens.mjs` change that lands in this repo
  whenever it is wanted.
- **The bug was isolated, and there is now a gate.** Swept 2026-08-19 for the
  same defect in every other token group: built all 384 token-derived class names
  from `tokens.source.json`, found the 61 `frontend/src` actually uses, and
  checked each against the built CSS. **Zero dead.** Type sizes, radii, font
  families, border widths and every colour utility all compile, and
  `bg-canvas`/`text-text-muted` resolve through the `@theme inline` block by
  textual substitution exactly as its comment says. Do not re-run that sweep by
  hand: `pnpm check-tokens` (`frontend/scripts/check-token-classes.mjs`) is that
  check, wired into `suite.json` and CI, and it was confirmed to fail on this
  branch's own bug before being confirmed green.
- **The gate then reported that same bug as live, two days after it was fixed**
  (2026-08-21). `pnpm check-tokens` named `duration-fast` and `duration-panel` as
  compiling to nothing on a clean tree where the generator, `tokens.css` and
  Tailwind were all correct: the built CSS carries
  `.duration-fast{transition-duration:var(--transition-duration-fast)}` and
  `--transition-duration-fast:.15s`, and a fresh build passes. What it read was a
  `frontend/dist` from before the alias landed, so its verdict described the tree
  as it had been, not as it was. Nothing in the token layer needed changing, and
  a hand-edit of `tokens.css` chasing it would have been damage.
- **The defect was the check's precondition, and it is now enforced.** Both
  scripts that read `dist` rather than `src` said "requires a prior `pnpm build`"
  in a comment and then trusted whatever was on disk, which is a hope, not a
  precondition. `ci.yml` happens to satisfy it by running `pnpm build`
  immediately before `check-bundle` and `check-tokens`; nothing satisfies it in a
  local or agent run, which is where `/suite-kit:health` is the definition of
  done. It lies in both directions, and the dangerous direction is the quiet one:
  a `dist` still holding a rule the current sources no longer produce reports a
  real regression as green, which is precisely what this check exists to catch.
  `frontend/scripts/lib/dist-freshness.mjs` now compares source mtimes against
  the build and rebuilds when the build is missing or older, so both checks
  answer for the current tree or do not answer at all. Fresh `dist` means no
  work, so CI is unaffected. Re-verified by rebuilding the pre-fix
  `tokens.css` into `dist`, reproducing the two-class failure exactly, and
  watching the guard rebuild and pass.
- **`gen-tokens.mjs` now writes only when the bytes change**, which the above
  made load-bearing. It used to rewrite all three outputs unconditionally, so an
  identical regeneration still bumped their mtimes. The health runner regenerates
  in its `generated` section *after* running `commands`, so with mtime-based
  freshness every run would hand the next one a pointless ~10s rebuild. It also
  now names which file it rewrote, which is a better drift signal than the old
  fixed "wrote all three" line: a hand-edited `tokens.css` reports as exactly
  that. Verified both ways — a clean tree reports "already current" and leaves
  mtimes untouched, an appended line to `tokens.css` reports `wrote
  src/styles/tokens.css` and restores it without touching the other two.
- **An upstream naming question, deliberately not acted on.** Tailwind v4.3.2
  *does* read a `--border-width-*` namespace. The `@utility border-hairline`
  rules exist only because the tokens are named `--border-hairline`. Renaming
  them `--border-width-*` in `kollektiv/design/tokens.json` would let them
  resolve automatically the way `ease-*` and `duration-*` now do, and delete that
  block. It is a rename in the shared source and would move Kommands too, so it
  belongs upstream. The generator's comment used to state the reasoning backwards
  and now records this.
- **Why no `suite.json` invariant for this.** An invariant is one regex that
  must find nothing, with no judgement applied. Motion is not borders: the
  decorative sites above are meant to keep their literals forever, so a motion
  invariant needs a curated `exclude` list rather than the border rule's "just
  don't write it" purity, and a comment containing the matched text is a
  permanent false-failure risk. Before one could land, the numeric-scale
  near-misses need a ruling and the decorative files need exclude-listing. Until
  then it is red on arrival, exactly what the border invariant's own diagnosis
  warns against.

**P3 — An error sentinel with no caller** (downgraded 2026-08-19: the premise
was partly wrong)
- `backend/services/update.go:37`'s `ErrUpdatePermission` is produced at `:265`
  and matched by nobody: no `errors.Is` anywhere in the tree. That much holds.
- What this entry used to say, and what is actually true: it named
  `frontend/src/hooks/useUpdateCheck.ts:32` as swallowing the error with a bare
  `catch {}`. That catch wraps `CheckForUpdates`, a path this sentinel can never
  reach — permission checks only run inside `downloadAndApply`, reached only
  from `DownloadAndInstallUpdate`. The real and only caller is
  `SettingsModal.tsx`'s `runInstall` (`:567`), whose catch is **not** empty: it
  records the message into an `installFailed` state and the render branch shows
  "Couldn't install automatically", the message text, and a working "Open
  release page" button. So the contract the doc comment described is broadly
  implemented already.
- What is genuinely missing is only *tailored* guidance: permission, checksum
  and network failures all funnel into one branch distinguished by raw error
  text, so the UI cannot say "try running as Administrator". Fixing that means a
  structured field to branch on (`app.go:184` plus a model field plus a binding
  regeneration) or a documented error-code prefix the frontend matches. Neither
  is urgent, because nobody is currently stuck: the manual fallback works.

**P2 — Cleanups**
- `sandbox` (`config_editor.go`) is a purely **lexical** guard — `filepath.Clean`
  plus a prefix test — so a symlink sitting inside the working directory and
  pointing outside it passes the check and then resolves outside. Left open
  deliberately: this is a local-first app where the user already owns the
  filesystem, so a user symlinking their own config directory is a weak threat
  model. A fix has to resolve the *parent* directory (`sandbox` runs for files
  that do not exist yet, on the write path), and its test needs a skip guard
  because Windows gates symlink creation behind Developer Mode or elevation.
  Checked 2026-08-19 for the worse version of this bug and it is not there:
  `unzipTo` (`backend/services/backup.go:879`), the one place the backend
  extracts an archive to disk, has a correct zip-slip guard using the
  trailing-separator prefix form. Every other `archive/zip` use in the backend
  (`installer.go`, `modjar.go`, `backup.go`'s metadata readers) opens entries
  read-only and never writes to a caller-supplied path.
- Memoization pass: add `React.memo`/`useMemo`/`useCallback` to the most
  expensive tile subtrees identified during a profiling pass. Baseline
  2026-08-19: `React.memo` appears exactly once in the whole frontend
  (`tiles/scheduler/editor/BlockNode.tsx:25`); `useMemo` 27 times, `useCallback`
  101. The named subtrees (backups `SolarSystem`, worlds `WorldsScene`/`Planet`)
  have none. Still GUI-gated — a re-render count needs the Profiler, and the r3f
  scenes need a real WebGL context to mount.
- React Compiler-readiness lint rules: **measured** 2026-08-19 rather than
  estimated, and the previous note had it backwards. Running
  `eslint-plugin-react-hooks@7.1.1`'s `recommended-latest` over `src` gives
  **50** findings, not ~60 (`set-state-in-effect` 20, `refs` 16,
  `exhaustive-deps` 13, `purity` 1) across 22 files — and only **3** are in r3f
  scene code (`WorldsScene.tsx:275-276`, `Planet.tsx:339`, all the standard
  imperative-ref-during-render pattern). The other 47 are ordinary app logic,
  concentrated in `tiles/mods/useGridPageAnimation.ts` (8),
  `tiles/backups/BackupCarousel.tsx` (7) and `tiles/mods/BrowsePanel.tsx` (7).
  Its stated gate, "once test coverage is in place", cannot be met as written
  either: the frontend has **no** coverage measurement at all (no `coverage` key
  in `vite.config.ts`, no `@vitest/coverage-*` dependency). The 36%/38% floor is
  `backend/services` only. Either stand up frontend coverage or re-gate this on
  something that exists.

**P1/P2 — Wings-survey adoption set** (filed 2026-08-21)
- 15 behaviors adopted from the Pterodactyl Wings clean-room survey
  (`survey/wings.md`; decisions in `survey/wings-triage.md`), several of them
  bug-grade findings the comparison exposed rather than features: a silently
  dying console scanner (#112, P1 — closed 2026-08-22, HEALTH_LOG "The console
  that died on one long line"), power-action races including a broken
  restart-from-stopped (#109 — closed 2026-08-23, HEALTH_LOG "The power
  actions that raced each other"), an 8-second stop-then-SIGKILL that can kill
  a world save (#110 — closed 2026-08-26, HEALTH_LOG "The stop that killed
  mid-save"), a discarded exit code (#111 — closed 2026-08-22 as PR
  #147), unquiesced world duplication
  (#115 — closed 2026-08-22, HEALTH_LOG "The torn copy of a live world"), and
  non-atomic config writes (#116 — closed 2026-08-22, HEALTH_LOG "The
  half-written file a crash could leave"). Features: #108 (state machine +
  ready detection, implements #101 — closed 2026-08-26, HEALTH_LOG "The
  server that claimed running while still generating its world"), #113
  (manager narration — closed 2026-08-27, HEALTH_LOG "The console that
  learned to say what Konnekt was doing"), #114,
  #117 (close prompt + re-adopt, prerequisite #99), #118, #119, #120, #121;
  per-server shaping is a standing constraint tracked by #57. Cross-cutting constraints, sequencing waves, and the #30/#26
  reconciliations live in `agent_docs/WINGS_ADOPTION.md` — implementing sessions
  read that file plus their one issue, nothing more. As each issue closes, its
  write-up moves to HEALTH_LOG per convention.
- **Waves 1 and 2 are complete** (2026-08-28). Wave 1 was #112, #115, #116 and
  #111; wave 2 ran #109 → #108 → #110 → #113 in that order, because the lock is
  the choke point the state machine rides on, stop escalation needs both, and
  narration tags the banners escalation writes. What remains is wave 3 (#114,
  #119, #120, #121 — independent of each other, any order) and wave 4 (#118,
  then #117 after #99 and the wave-2 state machine).

**P3 — Smaller findings from the 2026-08-21 backend sweep** (not worth
individual issues; fix in passing when touching the file)
- `eventbus.go:37-55`'s per-handler `recover()` swallows panics with no log
  line — a handler crash is invisible even in `konnekt.log`. Add a `slog.Error`
  inside the recover when next touching the file.
- Restore leaves the restored directory with `os.MkdirTemp`'s 0700 mode rather
  than the original's permissions, and deletes the `.bak-<timestamp>` aside copy
  immediately on success (no retained undo) — `backup.go:411-431`. Neither is a
  bug per se; both are choices worth revisiting alongside #121/#30.
- `MaxPlayers()` keeps its last value after stop while every other status field
  zeroes (`server.go` accessors) — cosmetic inconsistency.
- `worlds.go:269`'s "(+ siblings)" comment overstates `CreateWorldBackup`, which
  zips only the named folder; the behavior gap is #26, the comment is local rot
  to fix when #26 lands.

**P2 — The changelog's stacked-PR guarantee is untested** (found 2026-08-28)
- `.github/scripts/release-notes.py`'s `merged_pulls()` is what lets a pull
  request merged into *another* pull request's branch keep its own entry: it
  maps each commit in the range to the pull requests containing it and keeps
  every merged one, deduped by number, with no base-branch filter. Wave 2 relied
  on that — #157 was merged into #156's branch — and it held: run against the
  real merge, the generator emits #155, #156 and #157 under their own titles in
  their own sections.
- Nothing pins that behavior. `release-notes_test.py` covers `section_for` and
  `touches_app` only, so `merged_pulls` has no test at all and a refactor could
  fold a stacked entry into its parent silently. Worth a regression test with
  the two halves that matter: a merged PR associated with a commit earns an
  entry, an unmerged one associated with the same commit does not.
- The same guarantee also dies at the merge button. Squashing a parent rewrites
  the child's commit hashes, GitHub then associates only the squashed commit
  with the parent, and the child drops out of the notes entirely with its work
  filed under the parent's title. `allow_squash_merge` is enabled on the
  repository, so this is one wrong click. Worth a sentence in
  `agent_docs/CLAUDE.md`'s "What reaches the notes at all" saying stacked pull
  requests must land as merge commits.

**P3 — Smaller findings from the wave 2 lifecycle work** (2026-08-26 to 08-28;
not worth individual issues; fix in passing when touching the file)
- `app.go`'s `AcceptEula` writes `eula.txt` with a raw `os.WriteFile` from
  `package main` — the one place app code does its own file I/O rather than
  going through a service, and it bypasses `writeFileAtomic`, so a crash
  mid-write leaves a half-written EULA (#116's shape, applied everywhere else).
- `backup.go`'s `CreateBackup` returns the post-zip `os.Stat` error without
  emitting `backup:failed`, unlike every other failure path in the same
  function: that one case fails with no event, no toast and no console
  narration.
- `useConsoleStore.ts`'s `classifyLine` keeps its own `/Done|joined the game/`
  heuristic for colouring a line green, duplicating the backend's canonical
  `reServerReady` (`server.go`) with looser matching that a chat message can
  trip. Cosmetic only — the lifecycle state machine no longer depends on it —
  but the two spellings can drift.

**Release follow-ups** (deferred)
- Release-tag-gated full `wails build` packaging job — stronger end-to-end
  confidence than the current `go build`/`pnpm build` CI smoke check.
- macOS release leg + its self-update support (`platformAssetNameFor` is
  structured to add a per-platform case, but no asset-naming/signing story
  exists for macOS yet).
- Code-signing / notarization for the published binaries (unsigned Windows
  builds trigger SmartScreen warnings).
- Second Linux leg for Rocky/RHEL 9 (webkit2gtk-4.0) — would need the updater to
  probe the host's installed webkit version rather than assume 4.1.

---

Full history of closed items and their verification notes:
`agent_docs/HEALTH_LOG.md`.
