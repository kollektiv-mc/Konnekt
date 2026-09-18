# Konnekt

A desktop Minecraft server dashboard built with Wails v2 + React + TypeScript.
Modular tile-based UI. Dark console aesthetic. Local-first, no cloud dependency.

## Stack

Wails v2 shell (Go backend, system WebView) with a React 19 + TypeScript +
Vite frontend, Tailwind v4, Zustand stores and a react-grid-layout tile grid.
pnpm for the frontend, Go modules for the backend.

## Project structure

Read the tree rather than a list of it. What it does not tell you:

- `frontend/wailsjs/` and `frontend/src/styles/` are generated. The
  hand-authored component CSS is `frontend/src/style.css` beside the latter.
- `demo/` is the browser demo: the untouched frontend with a shim
  (`demo/backend/`) answering `window.go` from fixtures. Nothing under
  `frontend/src/` imports it, and `demo/build.mjs` fails on drift against the
  generated bindings.
- `website/` is the marketing site: plain HTML, CSS and ES modules, no build
  step. Cloudflare Pages deploys it from this branch, configured outside this
  repo, so CI's `website` job is the only pre-merge gate.

## Architecture rules

- **Tiles are self-contained**: each tile in `frontend/src/tiles/` owns its own
  data fetching, state, and rendering. No cross-tile dependencies, with one
  sanctioned exception: the Overview tile, because a dashboard of the whole
  server cannot be built any other way. Read-only, never a tile's lazy half,
  every section behind its own `ErrorBoundary`.
- **Go owns all side effects**: process spawning, file I/O, RCON, scheduling.
  Never call OS-level operations from the frontend.
- **IPC via generated bindings only**: always import from `wailsjs/go/` — never
  use raw `window.go` or string-based calls.
- **One Zustand store per domain**: `useServerStore`, `useLayoutStore`,
  `useTileStore`, `useSchedulerStore`. Do not mix domains.
- **Go structs = TypeScript types**: define data shapes in `backend/models/`,
  Wails generates the TS equivalents automatically on `wails dev`.

## Code style

- Functional components only, no class components
- `import type` for type-only imports
- No `any` — use `unknown` and narrow
- Prefer named exports; default export only for page-level components
- Styling is Tailwind utilities over the CSS-variable token layer. Inline
  `style={{}}` is for genuinely computed values only, and
  `eslint.config.js`'s `no-restricted-syntax` rule enforces that as `error`.
- Go: `gofmt` enforced, errors always handled (no blank `_` ignores)
- Keep the entry bundle under the 165 KB gzip budget (`pnpm check-bundle`);
  heavy per-tile dependencies are lazy-loaded and warmed from
  `lib/prefetch.ts`.

## Build & dev commands

```bash
# from frontend/
pnpm dev | build | typecheck | lint | test | format:check   # the CI gates
pnpm test:coverage     # with the floor, per-directory table
pnpm check-bundle      # 165 KB gzip entry chunk
pnpm check-tokens      # every token-named class compiles
pnpm check-prefetch    # every lazy chunk is in the warm list
pnpm gen:tokens        # regenerate the token layer
pnpm format:website    # Prettier over website/

# from the repo root
wails dev | wails build | wails generate module
go vet ./...  |  go test ./...
node scripts/check-website-links.mjs   # hrefs, assets, sitemap
node demo/build.mjs                    # browser demo, with its drift checks
node demo/record.mjs                   # website clips; needs ffmpeg
npx --yes aislop@0.16.0 scan
```

A lefthook pre-commit hook runs Prettier + ESLint + `tsc -b` on staged
frontend files and `gofmt` + `go vet` on staged Go files; CI re-runs
typecheck/lint/build/test on every push and pull request.

**Definition of done:** run `/suite-kit:health`, or `.claude/suite-check.py`
where the plugin is not installed. Then sanity-check the area you touched
against the four pillars in `agent_docs/HEALTH_CHECKLIST.md` (Clean / Stable /
Scalable / Performant), and confirm the change is in scope for the current
milestone per `agent_docs/ROADMAP.md`. Track any gap you cannot fix now under
that checklist's `Open backlog`.

## Testing

- Frontend: `vitest` + `jsdom` + `@testing-library/react`. Mock Wails bindings
  with `vi.mock('.../wailsjs/go/main/App')` rather than requiring a real
  bridge — see any `frontend/src/stores/*.test.ts`.
- Backend: standard `go test`, table-driven where it fits; use
  `httptest.Server` for HTTP clients.
- New logic (Go services, Zustand store logic, pure helpers) ships with tests.
- Both sides hold a coverage floor: `go run ./scripts/coverage-floor` for
  `backend/services`, `pnpm test:coverage` for `frontend/src`. Each is a
  ratchet: raise it as coverage rises, never lower it to make a build pass.

## Task tracking

**GitHub Issues.** Do not add a `TODO.md`. `agent_docs/ROADMAP.md` holds
direction; work items are issues. Linear is a downstream mirror written only by
`/suite-kit:suite-sync`, never from this repo.

Three labels on every issue: one `type:`, one `area:`, one `p0`-`p3`, plus a
`milestone:` once staged (its absence means nobody staged it, not Later). Titles
name the thing rather than describe the change: a short noun phrase, no `X tile:`
prefix or suffix, no em dashes. The area label is load-bearing, because
`website/roadmap.js` files each issue into a folder by it. Rest in
`CONTRIBUTING.md`.

## Commits & pull requests

`CONTRIBUTING.md` holds the title rules and the `type:` ladder with its worked
cases. Four things it does not say:

- **Label each pull request twice**: one `type:`, *and* one `area:` from
  `.github/labels.yml`. CI's `pr-labelled` job checks the two separately and
  fails on either, so a pull request carrying only a `type:` is still red.
  Prefer a specific area over `area:ui`, as on an issue.
- **No em dashes** in titles, bodies or commit messages. Use a comma, a colon,
  or two sentences.
- `.github/scripts/release-notes.py` drops any pull request whose files all sit
  under the prefixes in `.github/changelog.json`, which is this repo's own list
  of what never reaches what ships. Note `README.md` is on it and `build/` is
  not, because `build/` holds the app icon and RPM spec.
- **Stacked pull requests land as merge commits, never squashed** (#263).
  Squashing the parent rewrites the child's commits, and the child's work is
  then filed under the parent's title with no line of its own.

Commit messages follow the same rules. Nothing parses them.

## Local tooling

- **graphify** is the AST knowledge graph the root `CLAUDE.md` holds the rules
  for. Without it installed, the `PreToolUse` hooks no-op and nothing blocks.
- **aislop** scores the tree for what AI-assisted code leaves behind, and CI
  fails below 100. Policy and ratchet: `.claude/rules/aislop.md`.
- **`.claude/` config is committed** so every clone and cloud agent inherits
  the same setup; only `.claude/settings.local.json` is gitignored.

## Versioning & releases

`version.go`'s `Version` var is the single source of the app version. A release
is cut from the Actions tab. The ladder, the snapshot channel and the Linux
build tags are in `.claude/rules/builds-and-releases.md`, which loads when you
open a workflow, `version.go`, `wails.json` or anything under `build/`.

## Alpha scope — do not implement beyond this

Alpha: multi-server management, start/stop/restart, live console, real-time
stats, performance history (1h), player list + kick/ban, quick commands +
custom commands, scheduled tasks, world management, manual + scheduled backups,
server.properties editor, tile layout system (drag/resize/snap/crate/presets
with save/restore), notifications.

`agent_docs/ROADMAP.md` has the full breakdown and the Beta list. Do NOT
scaffold a Beta feature during alpha.

## Do not

- Do not edit files under `frontend/wailsjs/` — they are auto-generated
- Do not call OS or filesystem operations from frontend TypeScript
- Do not use `localStorage` or `sessionStorage` — persist via Go file I/O
  writing JSON to the Wails app data directory
- Do not add new Go dependencies without checking `agent_docs/DEPENDENCIES.md`
- Do not restructure `frontend/src/tiles/registry.ts` mid-feature — extend only
- Do not use `useEffect` for data that should come from a Wails event listener
- Do not hand-edit generated output: the token layer, `frontend/wailsjs/`,
  lockfiles. Change the input and regenerate.

## Deeper rules, loaded on demand

`.claude/rules/` holds what only matters in one part of the tree, each scoped
by `paths:` so it costs no context until you open a matching file:
`tile-system.md`, `builds-and-releases.md`, `frontend-style.md`, `ipc.md`,
`backend.md`, `dependencies.md` and `aislop.md`.
