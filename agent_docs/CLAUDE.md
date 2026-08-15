# Konnekt

A desktop Minecraft server dashboard built with Wails v2 + React + TypeScript.
Modular tile-based UI. Dark console aesthetic. Local-first, no cloud dependency.

## Stack

- **Shell**: Wails v2 (Go backend + system WebView)
- **Backend**: Go (`backend/`)
- **Frontend**: React 19 + TypeScript + Vite (`frontend/`)
- **Styling**: Tailwind CSS v4
- **State**: Zustand
- **Tile grid**: react-grid-layout
- **IPC**: Wails auto-generated bindings (`frontend/wailsjs/`)
- **Package manager**: pnpm (frontend), Go modules (backend)

## Project structure

```
app.go, main.go, version.go  # Wails entrypoint, App struct, version (repo root)
backend/
  services/           # Process mgmt, RCON, backups, scheduler, config, stats, updates
  models/             # Shared Go structs (auto-bound to TS)

frontend/
  wailsjs/            # Auto-generated bindings — DO NOT EDIT MANUALLY
  src/
    components/       # Reusable UI components
    tiles/            # One folder per tile (index.tsx + types.ts)
      registry.ts     # Central tile registry — extend, never restructure
    stores/           # Zustand stores (one per domain)
    hooks/            # Custom React hooks
    lib/              # Shared utilities, constants
```

## Architecture rules

- **Tiles are self-contained**: each tile in `frontend/src/tiles/` owns its own
  data fetching, state, and rendering. No cross-tile dependencies.
- **Go owns all side effects**: process spawning, file I/O, RCON, scheduling.
  Never call OS-level operations from the frontend.
- **IPC via generated bindings only**: always import from `wailsjs/go/` — never
  use raw `window.go` or string-based calls.
- **One Zustand store per domain**: `useServerStore`, `useLayoutStore`,
  `useTileStore`, `useSchedulerStore`. Do not mix domains.
- **Go structs = TypeScript types**: define data shapes in `backend/models/`,
  Wails generates the TS equivalents automatically on `wails dev`.

## Tile system

Adding a new tile:
1. Create `frontend/src/tiles/MyTile/index.tsx` and `types.ts`
2. Register it in `frontend/src/tiles/registry.ts` with `id`, `label`, `icon`,
   optionally `maximizable`, and `component` — extend this file, never
   restructure it. There is no sizing decision to make: every tile shares the
   same size (see below).
3. No changes to core layout system required

Every tile is the same size — one shared default, and one shared min/max
resize range, from `lib/gridSizing.ts`'s `TILE_SIZE`/`TILE_MIN`/`TILE_MAX`.
This is deliberate, not a placeholder: it removes an entire class of
per-tile-sizing code (what size should a dragged-in tile become at this
spot?) that turned out to be where the real bugs lived — see
`agent_docs/HEALTH_LOG.md`'s "crate-drag placement, rebuilt" entry.

The grid uses `GridLayout` + `useContainerWidth` from react-grid-layout's
modern (non-`/legacy`) API, configured with `gridSizing.ts`'s
`GRID_COMPACTOR` — react-grid-layout's own `verticalCompactor`, its default
and best-tested mode. A tile always floats to the topmost open row; nothing
rests at an arbitrary row the way a `compactType: null` free-placement grid
would. That trade was made on purpose after `null` compaction proved to have
real, upstream-confirmed collision and gap bugs in react-grid-layout itself
(same entry as above) — with every tile the same size, "floats to the top"
is a much smaller loss than it would be with varied tile sizes.

The crate-drag ghost is a plain, non-`static` entry appended to the same
layout array real tiles render from, then run through `GRID_COMPACTOR`
**in `Dashboard.tsx`'s own code** before being handed to `<GridLayout>` —
not left to react-grid-layout's internal (invisible-to-us) compaction alone.
`compact()` is a pure function of its input, so compacting the same array
twice (once here, once again internally for display) is idempotent; doing it
here first is what lets the on-drop commit read the *actual* landing
positions back out via a ref, rather than recomputing them separately at
`mouseup` and risking the two disagreeing.

Assembling that array is `gridSizing.ts`'s `withGhost`, and the ordering step
in it is load-bearing: it moves whatever the ghost overlaps *below* the ghost
before compacting. Compaction resolves contention by sort order (y, then x),
so without that step a tile even one column to the ghost's left wins the cell
and the ghost is the one shoved down — which made the right-hand side of a row
unreachable from the crate whenever a tile straddled the middle columns, while
dragging an already-placed tile onto the same cell worked fine. The ghost is
the item under the user's hand, so it takes the cell and the occupants yield,
matching what a native tile drag already did. The compactor still performs
every bit of the actual collision resolution.

## IPC conventions

- Bind Go methods on the `App` struct in `app.go` (repo root)
- Method names: `PascalCase` in Go → `PascalCase` in generated TS bindings
- Always return `(T, error)` from bound Go methods
- Handle errors in frontend with a shared `useWailsCall()` hook
- Re-run `wails generate module` after adding new bound methods

## Code style

- Functional components only, no class components
- `import type` for type-only imports
- No `any` — use `unknown` and narrow
- Prefer named exports; default export only for page-level components
- Styling via Tailwind utilities backed by the CSS-variable token system
  (`frontend/src/styles/tokens.css` `@theme` blocks + `frontend/src/lib/theme.ts`
  `applySkin()`). Inline `style={{}}` is reserved for genuinely dynamic/computed
  values (animation delays, transforms, react-grid-layout position props) — not
  for static styling. The codebase is mid-migration from an earlier
  inline-styles-everywhere convention; see `agent_docs/HEALTH_CHECKLIST.md`
  Milestone 2 for the tile-by-tile migration in progress.
- **Token values are not edited here.** `frontend/src/styles/tokens.css` and
  `tokens.ts` are generated by `pnpm gen:tokens` from `tokens.source.json`, which
  is vendored from `kollektiv/design/tokens.json` — the suite's shared source, also
  consumed by Kommands. To add or change a token, edit it there, run kollektiv's
  `scripts/sync-tokens.sh`, then regenerate and commit both files. A hand edit is
  reverted on the next run and never reaches the other product.
  `frontend/src/style.css` keeps the hand-authored component CSS and nothing else.
- Go: `gofmt` enforced, errors always handled (no blank `_` ignores)
- Heavy per-tile dependencies (three.js, recharts) are lazy-loaded via
  `React.lazy` + `Suspense` (see `frontend/src/tiles/worlds/index.tsx`); keep
  the entry bundle under the 550 KB gzip budget enforced by `pnpm check-bundle`.

## Build & dev commands

```bash
wails dev             # Hot-reload dev mode (runs Vite + Go together)
wails build           # Production binary
wails generate module # Regenerate TS bindings after Go changes
pnpm typecheck        # tsc --noEmit (run from frontend/)
pnpm lint             # ESLint (run from frontend/)
pnpm test             # vitest (run from frontend/)
pnpm format           # Prettier --write (run from frontend/)
pnpm check-bundle     # Enforce 550 KB gzip entry-chunk budget (run from frontend/)
pnpm gen:tokens       # Regenerate the token layer from tokens.source.json (frontend/)
go vet ./...          # Go static analysis (repo root — single module)
go test ./...         # Go tests (repo root)
```

Always run `pnpm typecheck`, `pnpm lint`, and `go vet ./...` after a series of
changes. A lefthook pre-commit hook already runs Prettier + ESLint +
`tsc --noEmit` on staged frontend files and `gofmt` + `go vet` on staged Go
files; CI (`.github/workflows/ci.yml`) re-runs typecheck/lint/build/test on
every push and PR.

**Definition of done:** run `/suite-kit:health` — it runs the gates above plus
this repo's generated-file check, driven by `.claude/suite.json`, and reports a
table. Then sanity-check the area you touched against the four pillars in
`agent_docs/HEALTH_CHECKLIST.md` (Clean / Stable / Scalable / Performant), and
confirm the change is in scope for the current milestone per
`agent_docs/ROADMAP.md` (Alpha vs Beta — do not scaffold Beta features during
Alpha). Track any gap you can't fix now under that checklist's `Open backlog`.

## Task tracking

Task tracking is **GitHub Issues**. Do not add a `TODO.md`.

`agent_docs/ROADMAP.md` holds direction and sequencing; individual work items are
issues.

Linear is a **downstream mirror**. `/suite-kit:suite-sync` writes it, mirroring
this repo's GitHub Issues into the Apps team's Konnekt project and matching on a
`Source: kollektiv-mc/konnekt#<number>` line in the Linear issue description
rather than on titles. Never write to Linear directly from this repo.

## Local tooling

- **graphify** — the AST knowledge-graph tool this repo's Claude Code setup is
  built around. `.claude/settings.json` registers PreToolUse hooks that nudge
  toward `graphify query`/`explain`/`path` before raw source reads/greps (see
  the root `CLAUDE.md` graphify rules). Install it so `graphify` is on your
  `PATH` (e.g. `pipx install graphify` or `pip install --user graphify`), then
  run `graphify update .` to generate `graphify-out/` — gitignored and
  regenerable, AST-only, no API cost. Without graphify installed the hooks
  simply no-op (a harmless per-call notice; nothing blocks). Re-run `graphify
  update .` after code changes to keep the graph current.
- **`.claude/` config is committed** (`settings.json` hooks + `launch.json`
  dev-server presets) so every clone and cloud agent inherits the same setup;
  only `.claude/settings.local.json` (the personal permission allowlist) is
  gitignored.

## Testing

- Frontend: `vitest` + `jsdom` + `@testing-library/react`. Mock Wails
  bindings with `vi.mock('.../wailsjs/go/main/App')` rather than requiring a
  real Wails bridge — see any `frontend/src/stores/*.test.ts` for the pattern.
- Backend: standard `go test`, table-driven where it fits; use
  `httptest.Server` for HTTP clients (see `update_test.go`, `modrinth_test.go`).
- New logic (Go services, Zustand store logic, pure helpers) should ship with
  tests.

## Versioning & releases

`version.go`'s `Version` var is the single source of the app version,
mirrored in `wails.json`'s `info.productVersion`. `.github/workflows/release.yml`
builds and publishes on `v*` tags; the in-app updater
(`backend/services/update.go`) checks GitHub Releases. Only relevant when
cutting a release.

`.github/workflows/snapshot.yml` publishes the other channel: a nightly build
of `main` (skipped when `main` hasn't moved), force-published to the rolling
`snapshot` tag as a **prerelease**, which is what keeps it out of
`/releases/latest` and therefore invisible to both the updater and the website's
primary download card. Its version keeps the `-dev` marker
(`0.1.0-dev.snapshot.<sha>`) so `app.go`'s install guard and the frontend's
`isDevBuild()` treat a snapshot as having no update path — snapshots are
refreshed by downloading a new one.

## Linux builds

The published Linux release (`konnekt-linux-amd64` + an `.rpm`) is built with
`-tags webkit2_41` against webkit2gtk-4.1 (see
`.github/workflows/release.yml`'s `build-linux`/`package-rpm` jobs and
`build/linux/`), which covers Rocky/RHEL 10, Fedora 36+, Ubuntu 22.04+, and
Debian 12+. Rocky/RHEL 9 is not supported — it never received webkit2gtk-4.1
and EL10 dropped 4.0, so the two aren't binary-compatible.

On a Rocky Linux 10 dev machine (or any distro on the 4.1 side), if WebKit
detection fails, build with:
```bash
wails build -tags webkit2_41
wails dev -tags webkit2_41
```
Run `wails doctor` first — it will tell you exactly which tag to use.

## Alpha scope — do not implement beyond this

See `agent_docs/ROADMAP.md` for full breakdown.

Alpha: multi-server management, start/stop/restart, live console, real-time
stats, performance history (1h), player list + kick/ban, quick commands +
custom commands, scheduled tasks, world management, manual + scheduled backups,
server.properties editor, tile layout system (drag/resize/snap/crate/presets
with save/restore), notifications.

Beta features (file explorer, audit log, mod manager, player profiles, skin
previews, extended history) are in `agent_docs/ROADMAP.md` — do NOT scaffold
during alpha.

## Do not

- Do not edit files under `frontend/wailsjs/` — they are auto-generated
- Do not call OS or filesystem operations from frontend TypeScript
- Do not use `localStorage` or `sessionStorage` — persist via Go file I/O
  writing JSON to the Wails app data directory
- Do not add new Go dependencies without checking `agent_docs/DEPENDENCIES.md`
- Do not restructure `frontend/src/tiles/registry.ts` mid-feature — extend
  only. (Two sanctioned, one-time exceptions while the tile grid's placement
  model was under active repair — see HEALTH_LOG.md: loose per-tile
  `defaultW`/`defaultH`/`minW`/`minH` numbers became an `sm`/`md`/`lg` bucket
  shape, then that shape was removed outright in favor of every tile sharing
  one size from `lib/gridSizing.ts`. A `TileDefinition` entry is now just
  `{ id, label, icon, maximizable?, component }` — the rule applies fully
  from that shape going forward.)
- Do not use `useEffect` for data that should come from a Wails event listener