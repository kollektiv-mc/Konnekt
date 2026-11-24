# Konnekt

A desktop Minecraft server dashboard built with Wails v2 + React + TypeScript.
Modular tile-based UI. Dark console aesthetic. Local-first, no cloud dependency.

Rules shared with other projects are in `.claude/rules/`. An agent that does
not load that directory itself reads `working.md`, `writing.md` and
`simplicity.md` there before starting.

## Stack

Wails v2 shell (Go backend, system WebView) with a React 19 + TypeScript +
Vite frontend, Tailwind v4, Zustand stores and a react-grid-layout tile grid.
pnpm for the frontend, Go modules for the backend.

## Project structure

Read the tree rather than a list of it. What it does not tell you:

- `frontend/wailsjs/` and `frontend/src/styles/` are generated. The
  hand-authored component CSS is `frontend/src/style.css` beside the latter.
- `demo/` is the browser demo: the frontend with a shim answering `window.go`
  from fixtures. Nothing under `frontend/src/` imports it.
- `website/` is the marketing site: plain HTML, CSS and ES modules, no build
  step. Cloudflare Pages deploys it from this branch, configured outside this
  repo, so CI's `website` job is the only pre-merge gate.
- `website/docs/` pages come from the Markdown in `docs/website/`, whose
  README has the syntax and the generators to run. Edit the Markdown.

## Architecture rules

- **Tiles are self-contained**: each tile in `frontend/src/tiles/` owns its own
  data fetching, state, and rendering. No cross-tile dependencies, with one
  sanctioned exception: the Overview tile. Read-only, never a tile's lazy half,
  every section behind its own `ErrorBoundary`.
- **Go owns all side effects**: process spawning, file I/O, RCON, scheduling.
  Never call OS-level operations from the frontend.
- **IPC via generated bindings only**: always import from `wailsjs/go/`, never
  raw `window.go` or string-based calls.
- **Per-server scoping**: a bound method that acts on a server takes its
  `serverID`, an event about a server carries it, a listener filters on it.
  The gates and their allowlists are in `.claude/rules/ipc.md`.
- **One Zustand store per domain**: `useServerStore`, `useLayoutStore`,
  `useTileStore`, `useSchedulerStore`. Do not mix domains.
- **Go structs = TypeScript types**: define data shapes in `backend/models/`;
  Wails generates the TS equivalents on `wails dev`.
- No `any`: use `unknown` and narrow. Inline `style={{}}` only for computed
  values (ESLint enforces it). Go errors are always handled.

## Build & dev commands

```bash
# from frontend/
pnpm dev | build | typecheck | lint | test | format:check   # the CI gates
pnpm test:coverage     # with the floor, per-directory table
pnpm check-bundle      # 175 KB gzip entry chunk
pnpm gen:tokens        # regenerate the token layer

# from the repo root
wails dev | wails build | wails generate module
go vet ./...  |  go test ./...
node demo/build.mjs                    # browser demo, with its drift checks
python3 .claude/suite-check.py         # every health check in .claude/suite.json
```

lefthook runs Prettier, ESLint, `tsc -b`, `gofmt` and `go vet` on staged files;
CI re-runs them. More commands are in `.claude/rules/frontend-style.md`, testing
in `.claude/rules/testing.md`, releases in `.claude/rules/builds-and-releases.md`.

**Definition of done:** run `python3 .claude/suite-check.py` (or
`/suite-kit:health`). A check it reports as skipped did not pass. Then check the
area you touched against `agent_docs/HEALTH_CHECKLIST.md`, and confirm the change
is in scope for the current milestone per `agent_docs/ROADMAP.md`.

## Task tracking

**GitHub Issues**, mirrored to Linear only by `/suite-kit:suite-sync`.
`agent_docs/ROADMAP.md` holds direction; work items are issues.

Three labels on every issue: one `type:`, one `area:`, one `p0`-`p3`, plus a
`milestone:` once staged. An issue opened through the API (by an agent) sets
the priority in the same call, `p2` when unclear. Titles name the thing: a
short noun phrase, no `X tile:` prefix. The area label is load-bearing:
`website/roadmap.js` files each issue into a folder by it. Rest in
`CONTRIBUTING.md`.

## Pull requests

Follow `CONTRIBUTING.md`: one pull request per piece of work, a `## Changelog`
line per change, an `area:` label (specific over `area:ui`). Three things it
does not say:

- `.github/changelog.json` lists the paths that never reach what ships;
  `release-notes.py` drops a pull request touching only those. `build/` is not
  on it: it holds the app icon and RPM spec.
- **Branch from `origin/main` and set the base to `main` explicitly** (#388).
- **Stacked pull requests land as merge commits, never squashed** (#263).

## Files that come from the template

Some files are owned by sandrogekeler/AllesSandro and must not be edited here:
`.claude/rules/template-files.md` lists them. `tokens.source.json` and
`.github/labels.json` are written by kollektiv's sync scripts.

## Alpha scope: do not implement beyond this

Alpha: multi-server management, start/stop/restart, live console, real-time
stats, performance history (1h), player list + kick/ban, quick and custom
commands, scheduled tasks, world management, backups, server.properties editor,
tile layout system, notifications. `agent_docs/ROADMAP.md` has the full
breakdown and the Beta list. Do not scaffold a Beta feature during alpha.

## Do not

- Use `localStorage` or `sessionStorage`: persist via Go file I/O writing JSON
  to the Wails app data directory.
- Use `useEffect` for data that should come from a Wails event listener.
- Hand-edit generated output: the token layer, `frontend/wailsjs/`, lockfiles.
- Commit secrets, `.env` files or credentials.

## graphify

An optional AST graph for "where does this live, what touches it" across the
tree. Build it with `graphify update .` (gitignored, no key), then read the
source it points at. Without it installed, the `PreToolUse` hooks no-op.
