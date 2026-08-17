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

And one invariant, `no literal border widths`: a grep for
`\bborder(-[a-z]+)?-\[[0-9.]+px\]` over `frontend/src/components` and
`frontend/src/tiles`, expected to find nothing. It is scoped to borders on
purpose — see "The remaining arbitrary-value sweeps" in the backlog for why a
broader pattern would be red on arrival. Note `ci.yml` does not invoke
`suite-check.py` and this repo has not vendored `.claude/suite-check.py`, so
invariants run under `/suite-kit:health`, not in CI.

Note `go vet`/`go test` need `frontend/dist` to exist first (`main.go`'s
`//go:embed all:frontend/dist`), so run `pnpm build` before them in a clean
tree.

---

## 1. Clean

- [x] `go vet ./...` and `gofmt -l .` report nothing.
- [x] No blank `_ =` error-ignores in Go, except documented `//nolint` cases
      (e.g. `backend/services/eventbus.go`). See backlog
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
- [x] No committed build artifacts (`*.syso`, `frontend/dist/`, `build/bin/`)
      — `.gitignore` covers them.
- [x] No stray root-level scratch/design docs left un-triaged (either promoted
      into `agent_docs/` or deleted once the work lands).
- [ ] `agent_docs/CLAUDE.md` and `agent_docs/ROADMAP.md` still reflect the
      actual stack/structure/scope — update them when they drift.
- [ ] No obviously dead code (unused exports, unreachable branches, orphaned
      files) left behind after refactors.

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
- [ ] Every `EventsOn` listener registered in a component is cleaned up on
      unmount — no leaked subscriptions.
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
- [ ] `ErrorBoundary` wraps the app and the UI degrades gracefully when the
      Minecraft server process is offline or unreachable.

## 3. Scalable / Future-proof

- [x] Heavy per-tile dependencies are lazy-loaded on demand, following the
      existing pattern in `frontend/src/tiles/worlds/index.tsx` (`React.lazy`
      + `Suspense`): worlds' three.js/@react-three scene, and now recharts
      (performance tile — see backlog). The backups tile has **no** three.js
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
- [ ] Each Zustand store still owns exactly one domain — no cross-domain state
      mixing creeping in.
- [ ] Go structs in `backend/models/` remain the single source of truth for
      TypeScript types; bindings were regenerated (`wails generate module`)
      after backend model changes.
- [ ] Dependencies (Go modules, npm packages) are reasonably current, with no
      unmaintained or duplicated libraries doing the same job.
- [ ] New Go dependencies were checked against `agent_docs/DEPENDENCIES.md`
      before being added (create this file if it doesn't exist yet — see
      backlog).
- [x] Local-first invariant holds: no `localStorage`/`sessionStorage` usage;
      all persistence goes through Go file I/O into the Wails app data dir.
      Repo-wide grep confirms zero occurrences under `frontend/src/`. The one
      violation found (scheduler `BlockPalette.tsx`'s palette-collapse and
      per-category-collapse prefs) has been migrated onto `AppSettings` →
      `app_settings.json`, the same Go-backed path console/notify prefs
      already use — see backlog.

## 4. Performant

- [ ] Console log lines are still batched (150ms flush window in `App.tsx`) so
      re-render rate stays bounded on busy servers.
- [ ] Circular/ring buffers still cap memory growth: performance history
      (`usePerformanceHistory.ts`), console buffer (`useConsoleStore.ts`, user
      configurable cap), backend stats history and console ring buffer
      (`backend/services/stats.go`, `backend/services/server.go`).
- [ ] Poll cadences remain deliberate and haven't crept down accidentally: TPS
      RCON poll (~15s, with server-flavor caching), stats tick (~10s). The
      scheduler's next-run countdown is no longer polled at all — the Go
      per-minute ticker (and each graph mutation) pushes `schedule:next-runs`.
- [ ] Expensive tile subtrees are memoized (`React.memo` / `useMemo` /
      `useCallback`) so parent re-renders don't cascade into them — pay
      particular attention to the 3D scenes (backups sphere, worlds planetary
      system) and chart-heavy tiles.
- [x] Production bundle has been profiled recently (e.g. `vite build` output
      or a bundle analyzer) and heavy libraries remain lazy rather than eager
      (three.js via Worlds, recharts via Performance — see Scalable pillar).

---

## Open backlog

The remaining, not-yet-closed follow-ups. Each item's full remediation write-up
moves to `agent_docs/HEALTH_LOG.md` once it's done — keep this section short and
current. Priorities mirror the pillars above.

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
  `log/slog`, keeping `EventBus` for UI-facing notifications. Note the starting
  point is *no* logging layer at all rather than an ad-hoc one: zero `log`/`slog`
  imports, one `fmt.Printf` (`scheduler.go:247`), and 132 `fmt.Errorf` across 21
  files that are error *construction*, not logging. So this is additive — pick
  the swallow and best-effort points — not a 132-site rewrite.
- Memoization pass: add `React.memo`/`useMemo`/`useCallback` to the most
  expensive tile subtrees identified during a profiling pass.
- React Compiler-readiness lint rules: revisit enabling
  `eslint-plugin-react-hooks`'s full `recommended`/`recommended-latest` set (~60
  findings, mostly r3f scene code) once test coverage is in place.

**P2 — The remaining arbitrary-value sweeps**

The border sweep closed 173 of the **356** `[Npx]` literals inside
`suite.json`'s `tokens.paths`. These are the other 183, split by whether they
are a pure find-and-replace. The `no literal border widths` invariant is scoped
to borders precisely so it stays green while these are open; widen it as each
one closes, and only then revisit `tokens.enforce: "strict"`.

- **`text-[Npx]` font sizes — 111 sites.** 107 map exactly onto existing tokens:
  `text-[10px]` ×65 → `text-2xs`, `text-[11px]` ×27 → `text-1xs`, `text-[9px]`
  ×15 → `text-3xs`. The other 4 have no token — `text-[8px]` ×2, `text-[7px]`,
  `text-[13px]` — so this is **blocked on an upstream decision** in
  `kollektiv/design/tokens.json`: extend the scale, or judge each of the four a
  mistake and snap it to an existing step. Not mechanical the way the borders
  were, and approximating is explicitly the worst of the options.
- **`rounded-[Npx]` radii — 9 sites.** `rounded-[10px]` ×7 → `rounded-panel` is a
  straight swap; `rounded-[2px]` and `rounded-[7px]` need the same upstream call.
- **Arbitrary sizing literals — 63 sites** (19 `w-`, 17 `h-`, 7 `min-w-`, 6
  `py-`, 4 `px-`, 4 `min-h-`, 2 `max-h-`, 2 `translate-y-`, 1 `max-w-`, 1
  `-left-`). Mostly layout dimensions rather than design values, and mostly
  expressible on Tailwind's own spacing scale (`w-[22px]` → `w-5.5`,
  `py-[3px]` → `py-0.75`) with no token work. Worth keeping separate so it is
  not mistaken for a token sweep.
- **Hand-written CSS still inlines border weights** — `tiles/scheduler/scheduler.css`
  (29, 35, 48) and `style.css` (134, 215, 428, 460, 502, 506) use literal
  `0.5px`/`1.5px` where `var(--border-hairline)`/`var(--border-thick)` are in
  scope. Invisible to the Tailwind-class invariant by design, since that pattern
  requires the bracket.
- **Remaining colour literals.** `tiles/performance/index.tsx:296`'s sticky
  `thead` (`bg-[#0a0c12]` — `bg-canvas` is arguably the right role, not
  `bg-overlay`; needs a call), `tiles/scheduler/editor/NodeConfigPanel.tsx:58`'s
  blue badge (`bg-[#1e3a5f]`/`text-[#60a5fa]`, no upstream equivalent) and `:56`'s
  `text-[#ef4444]` (exactly `--danger`'s light value, so a straight `text-danger`),
  `tiles/scheduler/editor/BlockNode.tsx`'s `border-[#ef4444]`, and the performance
  chart axis/grid strokes (`rgba(255,255,255,0.3)`, close to `--text-faint`'s
  0.25 but **not** equal — do not snap it).
- **`gen-tokens.mjs`'s border utilities omit `border-style`.** Tailwind's own
  width utility emits `border-style: var(--tw-border-style)` alongside the width;
  the generated `@utility` emits width only. It works because preflight sets
  `*{border:0 solid}`, verified in the built CSS and at runtime, but the two are
  not drop-in equivalents. The fix is emitting `border-style: var(--tw-border-style, solid)`;
  the `, solid` fallback is mandatory, because Tailwind registers the `@property`
  for *its* utilities, not ours, so a bare `var()` would become a latent
  no-border bug the day nothing else uses a core border utility.
- **`BUILTIN_SKINS` override no elevated surface.** `lib/theme.ts`'s five skins
  retheme `--bg-base`, `--bg-surface`, the borders and some text, but not
  `--bg-elevated` or `--bg-overlay`, so floating panels do not track a skin. A
  design decision rather than a bug, but currently written down nowhere.
- **Stale in-code claim.** `tiles/worlds/index.tsx:14`'s comment says `SCENE_BG`
  is "tracked as a token to add in HEALTH_CHECKLIST.md's backlog". It was not.
  It is now, one item above; fix the comment when that file is next open.

**P2 — `website/` has no gates at all**
- The `website/` sub-project (~4,600 lines of HTML/CSS/JS added since the last
  health pass) has no lint, no formatter, and no CI job, and it isn't mentioned
  in `CLAUDE.md`'s project-structure block. It ships to konnekt.pages.dev, so
  it's user-facing surface with strictly less checking than the app.
- Minimum worth adding: Prettier over `website/**` (the config already exists),
  and a link/asset sanity check so a renamed image or a dead internal href is
  caught before deploy.
- **That call has been made: it belongs in this repo's CI**, as a job in
  `.github/workflows/ci.yml` alongside `frontend` and `backend`. That is where
  every other gate already lives, and it catches problems before merge rather
  than at deploy. Note the deploy itself is configured externally — there is no
  `wrangler.toml`, `_headers`, `_redirects` or deploy workflow anywhere in-repo,
  so the Pages build is not somewhere this repo can add a check anyway.
- Two traps for whoever picks this up. `frontend/package.json`'s `format` scripts
  resolve `.` relative to `frontend/`, so they can never reach `website/` — the
  job needs its own invocation, not a widened glob. And `lefthook.yml`'s
  `*.{ts,tsx,css}` glob *would* match `website/styles.css` except that the job
  carries `root: "frontend/"`, so adding the file type there does nothing.
- Link/asset integrity is currently clean (every internal href, fragment anchor
  and asset path resolves, and `sitemap.xml`'s five URLs all exist). Nothing
  enforces it, which is the whole point of the item.

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
