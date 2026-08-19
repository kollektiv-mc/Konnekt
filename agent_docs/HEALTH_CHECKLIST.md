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
pnpm check-bundle       # 550 KB gzip entry-chunk budget (from frontend/)
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
      hand edit. 82/82 bound methods and every emitted struct round-tripped
      byte-identical.
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
      Verify: from `frontend/`, all four of these, because a motion literal has
      four spellings and the arbitrary-value one is the *least* common:
      ```bash
      grep -rnE "(duration|delay)-\[[0-9.]+m?s\]|ease-\[" src   # arbitrary values
      grep -rnE "\b(duration|delay)-[0-9]+\b" src                # Tailwind's own scale
      grep -rnE "\[transition:[^]]*\]" src                       # arbitrary shorthand
      grep -rnE "transition:|animation:" src src/style.css        # inline + hand CSS
      ```
      Every match must be a documented one-off, not a near-miss of an existing
      token. See backlog ("P2 — Motion one-offs outside the token vocabulary").
- [x] No committed build artifacts (`*.syso`, `frontend/dist/`, `build/bin/`)
      — `.gitignore` covers them.
- [x] No stray root-level scratch/design docs left un-triaged (either promoted
      into `agent_docs/` or deleted once the work lands).
- [ ] `agent_docs/CLAUDE.md` and `agent_docs/ROADMAP.md` still reflect the
      actual stack/structure/scope — update them when they drift.
      Verify: read CLAUDE.md's "Project structure" against the real top-level
      dirs under `frontend/src/` and `backend/`, and its "Build & dev commands"
      table against `frontend/package.json`'s `scripts`.
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
      `backend/services` sits at **38.0%** of statements, with a **36%** floor
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
      `backend/models/` change shipped without regenerating. That half holds
      (zero diff). The *source of truth* half does not: a struct Wails never
      emits gets hand-copied instead, and `skipLibCheck` hides the dangling
      reference — see backlog ("P2 — A Go model the bindings never emit").
      A clean regeneration diff is therefore necessary, not sufficient; also
      grep the generated `App.d.ts` for `models.X` names that `models.ts` never
      declares.
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

**P2 — Motion one-offs outside the token vocabulary**
- The motion vocabulary is three tokens: `--duration-fast` (150ms),
  `--duration-panel` (280ms) and `--ease-standard`
  (`cubic-bezier(0.4, 0, 0.2, 1)`).
- **The "12 matches" this entry was written around is wrong, and the way it is
  wrong matters.** That count comes from one grep,
  `(duration|delay)-\[[0-9.]+m?s\]|ease-\[`, which only sees Tailwind's
  *arbitrary-value* spelling — and one of its 12 hits is the prose comment at
  `tiles/mods/BrowsePanel.tsx:38`, not a call site. A motion literal has four
  spellings in this codebase and that grep sees one of them. Re-measured with
  all four (the Clean pillar's verify block now lists them):
  - **arbitrary values** — 11 real call sites, as itemised below.
  - **Tailwind's own scale** — 15 more, invisible to the original grep because
    `duration-300` has no brackets: `components/ActiveProcesses.tsx:31`,
    `components/SettingsModal.tsx:656`, `components/ui/Segmented.tsx:41`,
    `tiles/TileWrapper/index.tsx:30` (`duration-150`, which *is*
    `--duration-fast` spelled as a scale step), `tiles/backups/BackupCard.tsx:46`,
    `tiles/backups/ServerInfoPanel.tsx:111`/`:179`, `tiles/backups/index.tsx:518`/`:572`,
    `tiles/config/form/widgets.tsx:38`/`:44`, `tiles/mods/index.tsx:96`/`:272`,
    `tiles/performance/index.tsx:56`, `tiles/stats/index.tsx:71`.
  - **arbitrary `[transition:...]` shorthand** — 2: `tiles/mods/BrowsePanel.tsx:442`
    (`border-color_150ms_ease`) and `tiles/mods/ContentCard.tsx:158`
    (`opacity_200ms_ease`).
  - **inline `transition:` strings and hand-authored CSS** — ~15, and this is
    where the sharpest cases live. `components/ui/Segmented.tsx:32` writes
    `cubic-bezier(0.4, 0, 0.2, 1)` out longhand, which is `--ease-standard`
    character for character. `src/style.css:166` and `:218` write bare `150ms`
    thirty lines below the same file's own `var(--duration-fast)` usages at
    `:123`/`:128`. `tiles/mods/useGridPageAnimation.ts:5` holds
    `const PANEL_DURATION = 280`, and `:328` schedules a `setTimeout` off it,
    so it is the real other half of BrowsePanel's "keep both in sync" comment —
    which points at the class on line 449 instead, in a different file.
  - Two files already do it right and are the pattern to copy:
    `components/ui/Popover.tsx:30` and `components/ui/Collapsible.tsx:45` read
    `var(--duration-fast)`/`var(--duration-panel)`/`var(--ease-standard)` from
    inside an inline `transition:` string.
- Also worth knowing before scoping: `frontend/src/styles/tokens.ts` (generated)
  exports colours only. There is no JS-readable motion token, which is why
  `useGridPageAnimation.ts` holds numbers. Emitting the motion scale into
  `tokens.ts` is a `gen-tokens.mjs` change and lands in this repo.
- The original per-group analysis of the arbitrary-value sites still stands:
  - **A near-miss that is not even a miss.** `tiles/mods/BrowsePanel.tsx:449`
    spells `duration-[280ms]`, which *is* `--duration-panel`, and line 38
    carries a hand-written comment telling the next reader to keep the two in
    sync. Switching it to the `duration-panel` utility deletes both the
    arbitrary value and the comment. `duration-fast`/`ease-standard` already
    work as utilities (`components/LayoutPresets.tsx:51`,
    `tiles/config/form/ConfigForm.tsx:33`), so nothing new is needed for this
    one.
  - **Near-misses that need a judgement call.** `duration-200`
    (`tiles/backups/BackupCard.tsx:46`), `duration-300` and `duration-[180ms]`
    (`tiles/backups/index.tsx:572`, `:616`), and `duration-[250ms]`
    (`tiles/worlds/scene/WorldsScene.tsx:383`) all sit within ~50ms of an
    existing token. Either round them onto the token or write down why the
    difference is deliberate.
  - **A repeated value with no token.** `duration-[220ms]` appears three times
    in `tiles/backups/index.tsx` (`:580`, `:626`, `:668`) for the same
    panel/tray motion. A value used three times is a vocabulary gap, not a
    one-off.
  - **`ease-[ease]`, six times** (`tiles/backups/BackupCard.tsx:46`,
    `tiles/backups/index.tsx:572`, `:580`, `:616`, `:626`, `:668`). This is
    CSS's plain `ease` keyword, `cubic-bezier(0.25, 0.1, 0.25, 1)` — a
    *different* curve from `--ease-standard`, and Tailwind has no bare `ease`
    utility, so the escape hatch is the only spelling available. Whether the
    backups tile genuinely wants a second curve or just never reached for the
    token is undecided, and undecided is the actual defect here.
  - **Genuinely unique, and fine.** `tiles/backups/SolarSystem.tsx:152`/`:234`
    (`duration-[350ms]` with an overshoot spring,
    `cubic-bezier(0.34, 1.56, 0.64, 1)`) and
    `tiles/worlds/scene/WorldsScene.tsx:328`/`:383`
    (`cubic-bezier(0.25, 0, 0.25, 1)`) are decorative scene motion no shared
    token should flatten. They need a comment saying so, not a change.
- Note the constraint before starting: the token layer is **generated**. Adding
  a duration or an easing is an edit to `kollektiv/design/tokens.json`
  (`motion.duration.scale`, `motion.easing`), then kollektiv's
  `scripts/sync-tokens.sh`, then `pnpm gen:tokens` here, committing all three
  generated files. It cannot be done from this repo alone, and a hand edit to
  `tokens.css` is reverted on the next run. So the parts that only reuse an
  existing token or add a comment can land here; anything needing a new token
  is gated on the upstream change. (Checked 2026-08-19 against a read-only
  clone of `kollektiv-mc/kollektiv`: `design/tokens.json` and this repo's
  vendored `tokens.source.json` are byte-identical, so the vendored copy is not
  stale and `motion` really does hold only those three values upstream too.)
- One resolution needs no upstream change at all, and is probably the right
  one: the three `duration-[220ms]` sites in `tiles/backups/index.tsx` are a
  *single* choreographed motion — the solar system scaling down (`:580`), the
  carousel riding up (`:626`) and the list panel sliding in (`:668`) all fire
  off the same `panelOpen` flag and must stay in lockstep. That is a panel
  open/close, which is exactly the role `--duration-panel` names. Adopting the
  token keeps the three in lockstep by construction. Per kollektiv's
  `design/README.md`, a token is named by **role**, never by appearance, so
  "panel motion that happens to be 60ms quicker" is not a second role. The
  overshoot curves are the genuine vocabulary gap:
  `cubic-bezier(0.34,1.15,0.64,1)` appears at `ServerInfoPanel.tsx:59`,
  `WorldInfoPanel.tsx:53` and `BackupCarousel.tsx:182`, and
  `cubic-bezier(0.34,1.56,0.64,1)` at `SolarSystem.tsx:136`/`:152`/`:234` —
  two near-identical springs, six sites, no token. That one *is* upstream work.

**P2 — A Go model the bindings never emit**
- `frontend/wailsjs/go/main/App.d.ts:94` types `ModCheckUpdates` as
  `Promise<Record<string, models.ModUpdateInfo>>`, and `models.ts` never
  declares `ModUpdateInfo`. Wails v2.12.0 walks a bound signature's parameter
  and return types but does not descend into a **map value**, and
  `ModCheckUpdates` (`app.go:638`) is the only place that struct appears. So the
  generator emits a reference to a type it never wrote.
- Nothing catches it. `tsconfig.json` sets `skipLibCheck: true`, which is what
  keeps a dangling `models.X` in a `.d.ts` from being an error; the return type
  degrades to `any`, and `frontend/src/tiles/mods/useMods.ts:41-45` keeps a
  hand-written copy of the Go struct that `:153` casts the result onto. The two
  agree today. A JSON-tag rename in `backend/models/mod.go` would leave them
  disagreeing with a green `pnpm typecheck` and a green `pnpm lint`, surfacing
  as `undefined` at `ModPreviewDialog.tsx:270` and `InstalledPanel.tsx:439`.
- Note what this does *not* mean: `wails generate module` itself is clean, and
  every other bound method round-trips. The hole is one generator limitation,
  not stale bindings. The fix is a signature the generator can see through
  (return a slice of a named struct rather than a map keyed by filename), which
  is an IPC shape change with frontend churn, so it is a deliberate piece of
  work rather than a patch. A cheaper stopgap that catches the *next* one: grep
  the generated `App.d.ts` for `models.` names absent from `models.ts` and make
  that a `suite.json` invariant.
- Related and lower severity: eight more hand-written redeclarations of Go
  models sit in `frontend/src/types/index.ts` (seven) and
  `tiles/performance/usePerformanceHistory.ts:6` (`StatsSnapshot`), where
  `useMods.ts:21-25` and `useBackups.ts:15` already show the right shape by
  aliasing `models.X`. All eight are in sync now, and structural typing does
  catch a rename or a removal; what they miss silently is an **added** field.

**P2 — An error sentinel with no caller**
- `backend/services/update.go:33`'s `ErrUpdatePermission` is produced at
  `:261` and matched by nobody: no `errors.Is` anywhere in the tree. Its doc
  comment used to assert a contract ("Callers should fall back to opening the
  release page for a manual download") that nothing implements; the comment now
  describes the real situation instead.
- It is not dead code, and deleting it would be wrong: the sentinel's text is
  interpolated into the error the user actually sees. The defect is that the
  only consumer is the frontend, across the Wails IPC boundary, where a Go
  sentinel arrives as a plain message string, so `errors.Is` is structurally
  unavailable to it. Realising the contract means giving the frontend something
  structured to branch on: a typed field on a returned struct, or a documented
  error-code prefix. `app.go:184` passes the error straight through and
  `frontend/src/hooks/useUpdateCheck.ts:32` swallows it with a bare `catch {}`,
  so both ends need the change together.

**P2 — Cleanups**
- `sandbox` (`config_editor.go`) is a purely **lexical** guard — `filepath.Clean`
  plus a prefix test — so a symlink sitting inside the working directory and
  pointing outside it passes the check and then resolves outside. Left open
  deliberately: this is a local-first app where the user already owns the
  filesystem, so a user symlinking their own config directory is a weak threat
  model. A fix has to resolve the *parent* directory (`sandbox` runs for files
  that do not exist yet, on the write path), and its test needs a skip guard
  because Windows gates symlink creation behind Developer Mode or elevation.
- Structured logging: replace ad-hoc `fmt.Errorf`-only backend reporting with
  `log/slog`, keeping `EventBus` for UI-facing notifications.
- Memoization pass: add `React.memo`/`useMemo`/`useCallback` to the most
  expensive tile subtrees identified during a profiling pass.
- React Compiler-readiness lint rules: revisit enabling
  `eslint-plugin-react-hooks`'s full `recommended`/`recommended-latest` set (~60
  findings, mostly r3f scene code) once test coverage is in place.

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
