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
pnpm check-tokens       # every token-named class compiles (from frontend/, after a build)
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
      25 registrations across 12 files, all clean. Three spellings are in use
      and a check has to know all three, or it reports a false leak: a single
      `let cleanup` handle, numbered `c1…c5` handles, and an array drained in
      the cleanup (`offs.push(...)` in `ServerInstallModal.tsx`, an array
      literal in `tiles/stats/useServerStatus.ts`). Registration is always
      synchronous inside the effect — no `await` before the handle is
      captured — which is what rules out the unmount-before-assignment leak.
      One asymmetry, noted not fixed: `useServerStatus.ts` wraps its whole
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
- [ ] `ErrorBoundary` wraps the app and the UI degrades gracefully when the
      Minecraft server process is offline or unreachable.
      Verify: `grep -n "ErrorBoundary" frontend/src/main.tsx`, then run the app
      with no server configured and confirm tiles render an offline state
      rather than a blank panel. The grep half passes (`main.tsx:5`/`:18`/`:21`).
      The second half is now open on evidence rather than on absence of it: read
      2026-08-19, the console tile really does render a blank panel offline and
      the players tile cannot be told apart from an empty server — see backlog
      ("P1 — Tiles that render an unreachable server as an empty one"). That
      also corrects an assumption this line carried: the *verification* does not
      need a GUI, since a jsdom render against a rejecting mocked binding
      asserts the same thing. What needs a desk is the whole-app sweep, not the
      per-tile check.

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

**P1 — Four stores swallow a failed write and keep the optimistic update**
(found 2026-08-19)
- `agent_docs/CLAUDE.md`'s IPC conventions say a store's "write actions rethrow
  after recording the error, so an optimistic UI can revert", and name a bare
  `catch {}` as the thing to avoid. `stores/useSchedulerStore.ts:124-165` does
  exactly that and its own comment says every other store does not. It is right.
- `useServerConfigStore.ts` (`saveConfig` :49, `deleteConfig` :64, `setActiveId`
  :77), `useSettingsStore.ts` (`update` :85), `useLayoutStore.ts`
  (`savePreset`/`deletePreset` :107-133) and `useTileStore.ts`
  (`addTile`/`removeTile` :18-45) each catch the rejection with a `/* best-effort */`
  comment and then apply the local update anyway. A failed `SaveServerConfig`
  therefore shows the edit as saved, and it is gone on the next start, with no
  error anywhere.
- This is not speculative. `useSettingsStore.test.ts:100-103` *asserts* the
  behaviour: "keeps the optimistic update even when SaveAppSettings rejects",
  mocking a disk-full rejection and checking the toggle stays on. That test
  encodes the bug, so fixing the stores means fixing the test with them.
- Severity ranks by what is lost: server config (RCON credentials, working
  directory, JVM args) worst, then settings (`confirmBeforeStop`,
  `notifyOnCrash` are safety toggles a user would believe are on), then layout
  and tiles, which are cosmetic. Each store needs the rethrow *and* its callers
  need to revert, so this is a real piece of work, not a find-and-replace.

**P1 — Tiles that render an unreachable server as an empty one** (found
2026-08-19)
- The Stable pillar's `ErrorBoundary` item asks that the UI "degrade gracefully
  when the Minecraft server process is offline or unreachable" and has stayed
  half-ticked because it needs a GUI. It does not, entirely: three tiles were
  read directly and two are wrong.
- `tiles/console/index.tsx` is the blank-panel case the item is about. With no
  lines, the output region (`:132-143`) renders an empty `<div>` — no
  placeholder, no offline text; a grep for `running`/`offline`/`disabled` in
  that file returns nothing. The command input and Send button stay enabled, and
  submitting offline fails into `.catch(console.error)` with no visible feedback.
- The players tile renders an unreachable server identically to a server with
  nobody on it: `usePlayers.ts:26` swallows the rejection, `players` stays `[]`,
  and `PlayerGrid.tsx:13` shows "No players online" either way.
- `tiles/stats/index.tsx` is fine — `useServerStore`'s `defaultStatus.running`
  is `false`, so it shows its offline indicator on failure.
- The verification half *is* closable headlessly, contrary to what this
  checklist has assumed: `useUpdateCheck.test.ts:9` already shows the pattern
  (`vi.mock('../../wailsjs/go/main/App')` plus `mockRejectedValue`), and a
  jsdom render asserting an offline state needs no GUI. The console fix is a
  code change first, then a test.

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
  work rather than a patch.
- Measured 2026-08-19, so nobody re-derives it. Comparing every `models.X` name
  referenced in `App.d.ts` (22) against every name `models.ts` declares (34),
  `ModUpdateInfo` is the **only** dangling one. Surveying all 82 bound methods
  for the same shape turns up no second latent instance: only
  `GetScheduleNextRuns` returns a map at all and its value is an `int64`, and no
  bound method uses `[][]`, `interface{}` or `any`. So this is one isolated
  occurrence, not a pattern spreading. (`services.InstallerInfo` looks dangling
  and is not — `models.ts` declares two namespaces and `App.d.ts` imports both.)
- The cheaper stopgap is **not** expressible as a `suite.json` invariant. An
  invariant is one regex that must find nothing within a single file; this is a
  set difference between two files. It would need a script (the shape of
  `frontend/scripts/check-bundle-size.mjs`), a `health.commands` entry, and a
  literal step in `ci.yml`'s `frontend` job, since that workflow deliberately
  runs `suite-check.py` with `--section invariants --section generated` only.
  And it would be **red on arrival** until `ModCheckUpdates` is reshaped or the
  known case is explicitly excluded, so it has to ship with the real fix.
- Related and lower severity: eight more hand-written redeclarations of Go
  models sit in `frontend/src/types/index.ts` (seven: `AppSettings`,
  `LayoutPreset`, `ServerConfig`, `Player`, `ConfigFile`, `ServerStatus`,
  `ServerSummary`) and `tiles/performance/usePerformanceHistory.ts:6`
  (`StatsSnapshot`), where `useMods.ts:21-25` and `useBackups.ts:15` already
  show the right shape by aliasing `models.X`. All eight are in sync now, and
  structural typing does catch a rename or a removal; what they miss silently is
  an **added** field. Checked 2026-08-19: every one of the eight *is* emitted
  into `models.ts`, so all eight could be replaced with a one-line alias today,
  with no IPC change. `ModUpdateInfo` is the only one that structurally cannot
  be, which is the whole point of this entry.

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
- Structured logging: there is no retrievable log at all today, which is the
  reason this matters. Counted 2026-08-19 across `app.go` and `backend/`: one
  `fmt.Printf` (`scheduler.go:247`), one bare `println` (`main.go:35`), zero
  `log.*`, zero `runtime.LogXxx`, and 46 `EventBus` emissions that are UI-facing
  and live only while the window is open. `main.go` sets no `Logger` on
  `options.App`, so both stdout writes vanish in a packaged GUI build. A bug
  reporter has nothing to attach. `log/slog` is stdlib on Go 1.24, so no
  dependency is added. The smallest valuable version is one logger writing to a
  file in the app data dir plus the existing call sites moved onto it; the
  "full sweep" framing is misleading, since there is almost nothing to convert —
  the work is adding logging, not replacing it.
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

**P3 — The two changelog paths do not share a vocabulary** (found 2026-08-19)
- `.github/scripts/release-notes.py` writes the notes for both the snapshot and
  tagged releases, and has three sections: Features, Fixes, Other changes.
  `.github/release.yml`, the fallback used only when that script cannot run, has
  five: it adds Documentation and Maintenance.
- So a `type:docs` PR reads "Documentation" on one path and "Other changes" on
  the other, and `type:chore` reads "Maintenance" or "Other changes". That is
  precisely the failure `release.yml`'s own comment claims to have avoided:
  "The titles are kept in step deliberately: a reader should not have to learn
  two vocabularies depending on which path produced the notes they are looking
  at." They are in step for Features and Fixes only.
- Not fixed here because it is a decision, not a patch: either the script gains
  the two sections or `release.yml` loses three, and that is a call about what a
  release's changelog should show. `agent_docs/CLAUDE.md` has been corrected
  either way — it used to point contributors at the fallback as the authority.
- Smaller, same file: `release.yml`'s comment says `changelog:skip` is "Not a
  label that exists yet". It exists, described as "Leave this pull request out
  of the release notes entirely."

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
