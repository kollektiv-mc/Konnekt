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
pnpm check-bundle       # 550 KB gzip entry-chunk budget (from frontend/)
go vet ./...            # Go static analysis (repo root)
go test ./...           # Go tests (repo root)
go run ./scripts/coverage-floor   # backend/services coverage floor (repo root)
```
Plus the generated-file check `suite.json` declares: `pnpm gen:tokens` then
`git diff --exit-code src/styles/tokens.css src/styles/tokens.ts`. A non-empty
diff means a generated token file was hand-edited (the next run reverts it) or
`tokens.source.json` was refreshed without regenerating.

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
- [ ] No blank `_ =` error-ignores in Go, except documented `//nolint` cases
      (e.g. `backend/services/eventbus.go`).
      Verify: `grep -rn "_ = " --include=*.go app.go backend/ | grep -v nolint`
      — expect no matches. Three remain in `app.go`; see backlog
      ("P2 — Undocumented blank error-ignores").
- [x] `pnpm lint` runs against a real ESLint config and passes.
- [x] Formatting (Prettier/Biome or equivalent) is consistent and enforced,
      not manual (lefthook pre-commit hook: Prettier + ESLint + `tsc --noEmit`
      on staged frontend files, `gofmt` + `go vet` on staged Go files). The
      whole `frontend/` tree is Prettier-clean and CI runs `pnpm format:check`,
      so this no longer depends on the hook alone — note the hook's glob is
      `*.{ts,tsx,css}` and doesn't cover the HTML/JSON/`.mjs` that Prettier
      itself does.
- [x] `pnpm typecheck` has zero errors; no `any` anywhere (CLAUDE.md rule) —
      use `unknown` and narrow instead. One documented exception:
      `frontend/src/tiles/worlds/scene/Sun.tsx` (known `three`/`@react-three/fiber`
      cross-package type mismatch).
- [ ] Nothing under `frontend/wailsjs/` has been hand-edited (it's
      auto-generated; regenerate via `wails generate module` instead).
      Verify: run `wails generate module`, then
      `git diff --exit-code frontend/wailsjs` — a non-empty diff is a hand edit.
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
      Verify: from `frontend/`,
      `grep -rnE "(duration|delay)-\[[0-9.]+m?s\]|ease-\[" src` — every match
      must be a documented one-off, not a near-miss of an existing token.
- [x] No committed build artifacts (`*.syso`, `frontend/dist/`, `build/bin/`)
      — `.gitignore` covers them.
- [x] No stray root-level scratch/design docs left un-triaged (either promoted
      into `agent_docs/` or deleted once the work lands).
- [ ] `agent_docs/CLAUDE.md` and `agent_docs/ROADMAP.md` still reflect the
      actual stack/structure/scope — update them when they drift.
      Verify: read CLAUDE.md's "Project structure" against the real top-level
      dirs under `frontend/src/` and `backend/`, and its "Build & dev commands"
      table against `frontend/package.json`'s `scripts`.
- [ ] No obviously dead code (unused exports, unreachable branches, orphaned
      files) left behind after refactors.
      Verify: for each file the last refactor touched, `grep -rn "<exported
      name>" src` — an export with no importer outside its own file is dead.

## 2. Stable

- [x] Automated tests exist and pass for critical paths: RCON client, Modrinth
      API client, backup create/restore, config path-traversal guards,
      scheduler engine (Go); Zustand store logic and critical hooks (frontend).
      `backend/services` sits at **36.7%** of statements, with a **35%** floor
      owned by `scripts/coverage-floor` and run by both `/suite-kit:health` and
      CI. The floor is a ratchet: raise it as coverage rises, never lower it to
      green a red build. Coverage is a proxy, not the goal — prefer a test that
      would have caught a real bug over one that only moves the number.
- [x] CI is green on every push/PR (`.github/workflows/ci.yml`: a `frontend`
      job, a `backend` job on windows-latest, and a `backend-linux` job in a
      webkit2gtk-4.1 container — the only place `server_linux.go`/
      `server_unix.go`/`server_other.go` are compiled — plus the token-layer
      sync check, and `pnpm format:check`).
- [ ] All Go methods bound to the Wails `App` struct return `(T, error)`, and
      errors are wrapped with context (`fmt.Errorf("...: %w", err)`).
      Verify: `grep -nE "^func \(a \*App\) [A-Z]" app.go` — every hit must end
      in `error)` or `error {`. (`beforeClose`/`startup` are Wails lifecycle
      hooks, not bound methods, and are exempt.)
- [ ] Every `EventsOn` listener registered in a component is cleaned up on
      unmount — no leaked subscriptions.
      Verify: from `frontend/`, `grep -rn "EventsOn" src` — each call site must
      sit in a `useEffect` whose cleanup invokes the returned unsubscribe.
- [x] No frontend data is driven by `useEffect` polling when it should be a
      Wails event listener (CLAUDE.md rule). Every data poll is closed: the
      players tile's 3s poll, then the stats/backups/mods 10s polls (see
      HEALTH_LOG). The only remaining `setInterval` under `src/` is
      `App.tsx`'s 150ms console-log batcher, which is a render-batching
      measure rather than data fetching. Check with
      `grep -rn "setInterval" src --include=*.ts --include=*.tsx | grep -v test`.
- [ ] Process lifecycle stays safe: Windows Job Object child cleanup intact
      (`backend/services/server_windows.go`), RCON dial/operation timeouts
      present (`backend/services/rcon.go`), Modrinth HTTP client keeps its
      timeout + 429/`Retry-After` retry handling (`backend/services/modrinth.go`).
      Verify: `grep -n "JobObject" backend/services/server_windows.go`,
      `grep -n "Timeout" backend/services/rcon.go`, and
      `grep -nE "Retry-After|429|Timeout" backend/services/modrinth.go` — all
      three must still match.
- [ ] `ErrorBoundary` wraps the app and the UI degrades gracefully when the
      Minecraft server process is offline or unreachable.
      Verify: `grep -n "ErrorBoundary" frontend/src/main.tsx`, then run the app
      with no server configured and confirm tiles render an offline state
      rather than a blank panel.

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
- [ ] `frontend/src/tiles/registry.ts` was extended, not restructured, when
      new tiles were added. (Two sanctioned exceptions while the tile grid's
      placement model was under active repair — see HEALTH_LOG.md: loose
      per-tile `defaultW`/`defaultH`/`minW`/`minH` numbers became an
      `sm`/`md`/`lg` bucket shape, then that shape was removed outright —
      every tile now shares one size from `lib/gridSizing.ts`, and a
      `TileDefinition` entry is just `{ id, label, icon, maximizable?,
      component }`. The rule applies fully to that shape going forward.)
      Verify: `git diff main -- frontend/src/tiles/registry.ts` — added entries
      only, with `TileDefinition`'s shape unchanged.
- [ ] Each Zustand store still owns exactly one domain — no cross-domain state
      mixing creeping in.
      Verify: from `frontend/`, `grep -rn "stores/" src/stores` — a store
      importing another store's state is the failure.
- [ ] Go structs in `backend/models/` remain the single source of truth for
      TypeScript types; bindings were regenerated (`wails generate module`)
      after backend model changes.
      Verify: run `wails generate module`, then
      `git diff --exit-code frontend/wailsjs/go/models.ts` — a diff means a
      `backend/models/` change shipped without regenerating.
- [ ] Dependencies (Go modules, npm packages) are reasonably current, with no
      unmaintained or duplicated libraries doing the same job.
      Verify: `go list -m -u all` at the root and `pnpm outdated` from
      `frontend/`; `pnpm why <pkg>` for anything suspected of being vendored
      twice — the duplicate-`three` incident in HEALTH_LOG.md is the shape of
      failure this catches.
- [ ] New Go dependencies were checked against `agent_docs/DEPENDENCIES.md`
      before being added.
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

- [ ] Console log lines are still batched (150ms flush window in `App.tsx`) so
      re-render rate stays bounded on busy servers.
      Verify: from `frontend/`, `grep -n "setInterval" src/App.tsx` — the
      batcher must still be there, and still be the only `setInterval` under
      `src/` (see the Stable pillar's poll check).
- [ ] Circular/ring buffers still cap memory growth: performance history
      (`usePerformanceHistory.ts`), console buffer (`useConsoleStore.ts`, user
      configurable cap), backend stats history and console ring buffer
      (`backend/services/stats.go`, `backend/services/server.go`).
      Verify: each of those five sites must slice or shift when it appends —
      `grep -nE "slice\(|\.shift\(|len\(.*\) >" ` over them. An unbounded
      append is the failure.
- [ ] Poll cadences remain deliberate and haven't crept down accidentally: TPS
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

**P2 — Undocumented blank error-ignores**
- Three `_ =` error-ignores in `app.go` carry no `//nolint` comment explaining
  why the error is safe to drop: the shutdown `serverService.Stop()`, the
  data-dir `os.MkdirAll`, and the post-update `exec.Command(exePath).Start()`.
  The 2026 sweep that documented the other 28 sites (HEALTH_LOG.md, "P2 —
  Undocumented blank error-ignores") reported clean because its audit grep was
  scoped to `backend --include="*.go"` — the repo-root files were never in
  range. Re-run it as `grep -rn "_ = " --include=*.go app.go backend/ | grep -v
  nolint`. Each of the three is plausibly deliberate; decide that per site and
  write the reason down.

**P2 — Cleanups**
- `sandbox` (`config_editor.go`) is a purely **lexical** guard — `filepath.Clean`
  plus a prefix test — so a symlink sitting inside the working directory and
  pointing outside it passes the check and then resolves outside. Left open
  deliberately: this is a local-first app where the user already owns the
  filesystem, so a user symlinking their own config directory is a weak threat
  model. A fix has to resolve the *parent* directory (`sandbox` runs for files
  that do not exist yet, on the write path), and its test needs a skip guard
  because Windows gates symlink creation behind Developer Mode or elevation.
- Config-editor backups collide within a second. `backup()` names files
  `{escaped}.{20060102_150405}.bak` at one-second resolution and `os.Create`
  truncates, so two saves in the same second leave **one** backup, not two.
  Harmless in hand-editing, wrong if anything ever writes config
  programmatically. Widening the stamp (or adding a counter suffix) is the fix.
- Structured logging: replace ad-hoc `fmt.Errorf`-only backend reporting with
  `log/slog`, keeping `EventBus` for UI-facing notifications.
- Memoization pass: add `React.memo`/`useMemo`/`useCallback` to the most
  expensive tile subtrees identified during a profiling pass.
- React Compiler-readiness lint rules: revisit enabling
  `eslint-plugin-react-hooks`'s full `recommended`/`recommended-latest` set (~60
  findings, mostly r3f scene code) once test coverage is in place.

**P2 — `website/` has no gates at all**
- The `website/` sub-project (~4,600 lines of HTML/CSS/JS added since the last
  health pass) has no lint, no formatter, and no CI job, and it isn't mentioned
  in `CLAUDE.md`'s project-structure block. It ships to konnekt.pages.dev, so
  it's user-facing surface with strictly less checking than the app.
- Minimum worth adding: Prettier over `website/**` (the config already exists),
  and a link/asset sanity check so a renamed image or a dead internal href is
  caught before deploy. Decide first whether it belongs in this repo's CI at
  all, or in the Pages deploy — don't bolt a job on without that call.

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
