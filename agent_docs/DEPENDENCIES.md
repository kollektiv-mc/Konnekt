# Konnekt — Dependency Policy & Inventory

Referenced by `agent_docs/CLAUDE.md` ("Do not add new Go dependencies without
checking `agent_docs/DEPENDENCIES.md`") and
`agent_docs/HEALTH_CHECKLIST.md`'s Scalable pillar. Keep this current when
dependencies are added, removed, or repurposed — it's a decision record, not a
lockfile mirror.

## System build dependencies (not a Go/npm dependency, but tracked here)

Linux builds (dev and the release CI's `build-linux`/`package-rpm` jobs) need
system packages Go modules don't cover, since Wails links against the host's
webkit2gtk: `libgtk-3-dev`/`gtk3-devel` and `libwebkit2gtk-4.1-dev`/
`webkit2gtk4.1-devel` (`webkit2gtk4.1` + `gtk3` at runtime — see
`build/linux/konnekt.spec`'s `Requires:`). No Rocky/RHEL 9 equivalent exists;
see `agent_docs/CLAUDE.md`'s "Linux builds" section for why.

## Policy

**Before adding a Go dependency:**
- Prefer the standard library. This app runs local-first on the user's
  machine — every dependency is something that has to be vetted, updated, and
  trusted with local file/process access.
- Justify anything beyond the existing surface (process/OS stats, the Wails
  runtime itself, Windows syscalls). If stdlib or an existing dependency
  already covers it, don't add a new one.
- Record the addition here with a one-line rationale in the same PR.

**Before adding an npm dependency:**
- Prefer what's already in the tree (e.g. reuse Zustand for state, Tailwind
  utilities for styling — see `CLAUDE.md`'s Code style section) over a new
  library that does the same job differently.
- Heavy/rarely-used dependencies must be lazy-loaded (`React.lazy` +
  `Suspense`), per the existing `worlds` (three.js), `performance` (recharts),
  `scheduler` (`@xyflow`), `config` (CodeMirror) and `mods` (react-markdown)
  pattern — see the Scalable pillar in `HEALTH_CHECKLIST.md`. Splitting it out
  is half the job: add the same import specifier to `frontend/src/lib/prefetch.ts`
  so it is warmed during idle time, or the cost simply moves to the first time
  the tile is opened.
- Check the production bundle budget (`pnpm check-bundle`, 165 KB gzip entry
  chunk) isn't blown by the addition.
- Record the addition here with a one-line rationale in the same PR.

**Periodically** (see `HEALTH_CHECKLIST.md`'s Scalable pillar): confirm
dependencies are still current and that nothing here is unused or duplicated
with another library doing the same job.

## Current inventory

### Go (`go.mod`, direct requires)

| Module | Rationale |
|---|---|
| `github.com/minio/selfupdate` | In-place self-update: replaces the running executable with a checksum-verified download (`backend/services/update.go`), handling the Windows "can't overwrite a running exe" rename dance and automatic rollback on a failed write. Maintained fork of the long-standard `inconshreveable/go-update`; reimplementing that platform-specific swap/rollback logic by hand wasn't worth it. |
| `github.com/shirou/gopsutil/v4` | Cross-platform CPU/RAM stats polling (`backend/services/stats.go`) |
| `github.com/wailsapp/wails/v2` | App shell — Go↔WebView bridge, IPC binding generation |
| `golang.org/x/sys` | Windows syscalls for Job Object child-process cleanup (`backend/services/server_windows.go`) |

All other Go modules in `go.mod` are transitive (`// indirect`), pulled in by
the three direct dependencies above (mostly Wails' own runtime/webview/toast
stack and gopsutil's per-OS backends).

**Considered and not added:** a filesystem-watch library (`fsnotify`). The
Kommands link reader (`backend/services/kommands.go`) has to notice when
`os.UserConfigDir()/kommands/saved-commands.json` changes, which is the textbook
case for one. It does an `os.Stat` mtime-and-size comparison instead: one small
file, checked on startup, on window focus and on a 30s timer, and the responsive
path is the focus refresh rather than the timer. A watch would buy latency
nobody can perceive here in exchange for a dependency with per-platform
backends. Revisit if a second or third shared file appears (#213 Phase 1's
marker file, #218's run-request file) and the poll starts to look like a loop
rather than a check.

**Considered and not added:** a log-rotation library (`lumberjack` and
friends). `backend/services/logging.go` writes through stdlib `log/slog` on Go
1.24 and does its own single-file rotation in ten lines, because one desktop
client writing occasional lines does not need size-tiered archives. Revisit
only if the log ever grows a real retention requirement.

### Frontend (`frontend/package.json`, direct dependencies)

| Package | Rationale |
|---|---|
| `react`, `react-dom` | UI framework |
| `zustand` | Per-domain state stores (`CLAUDE.md`'s "one Zustand store per domain" rule) |
| `lucide-react` | The app's icon set (`lib/icons.ts` re-exports it; `components/ui/Icon.tsx` is the only render path). ISC, `sideEffects: false`, so the entry chunk pays only for the icons re-exported: measured 2.6 KB gzip for the 20 in use, against 1600+ available. Chosen over hand-vendoring the SVGs because the shipped path data is the same data lucide.dev serves, verified icon-by-icon when this landed, so there is nothing to transcribe and nothing to drift |
| `react-grid-layout` | Tile drag/resize grid system — used via its v2 modern API (`GridLayout`, `useContainerWidth`, `verticalCompactor` — its default, best-tested mode), not the `/legacy` v1-compat wrapper and not `noCompactor` free placement (tried and abandoned — see `agent_docs/HEALTH_LOG.md`'s "crate-drag placement, rebuilt" for the upstream-confirmed bugs that ruled it out) |
| `recharts` | Performance-tile charts, lazy-loaded (`tiles/performance/charts.tsx`) |
| `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `postprocessing` | Worlds tile's 3D planetary scene, lazy-loaded (`tiles/worlds/scene/`) |
| `@xyflow/react` | Node-graph editor for the scheduler tile's block system (`tiles/scheduler/editor/`), lazy-loaded behind the maximized editor (`tiles/scheduler/index.tsx`) |
| `@codemirror/lang-json`, `@codemirror/lang-yaml`, `@codemirror/state`, `@codemirror/view`, `@uiw/react-codemirror` | server.properties / config file editor, lazy-loaded behind the maximized editor (`tiles/config/EditorPanel.tsx`) |
| `react-markdown`, `remark-gfm`, `rehype-raw` | Rendering mod descriptions / changelogs in the mods tile, lazy-loaded (`tiles/mods/MarkdownBody.tsx`). `rehype-raw` is what pulls in parse5 and the full HTML parser, which is most of the weight |
| `smol-toml`, `yaml` | Parsing server config formats in the config tile; reached only through the lazy `EditorPanel` chunk |

Dev-only tooling (build, lint, format, test — Vite, TypeScript, ESLint,
Prettier, Vitest, Tailwind, etc.) isn't itemized here; it's inspectable
directly from `devDependencies` in `frontend/package.json` and doesn't ship in
the production bundle.

## Removed

- `uplot` — was listed as a direct dependency but never imported under
  `frontend/src/`; the performance tile's charts use `recharts` exclusively.
  Removed (see `HEALTH_CHECKLIST.md`'s "P2 — Repo hygiene").
- `skinview3d` — was reserved for the not-yet-built Beta "player skin
  preview" tile and never imported under `frontend/src/`. Removed because it
  pinned its own `@types/three@0.156.0` + `three@0.156.1`, a second copy
  alongside the app's `@types/three@0.184.1` + `three@0.184.0` — React Three
  Fiber's `Camera` type could resolve against either copy depending on the
  installer's `node_modules` layout, causing an install-dependent
  `unproject()` type error in `tiles/worlds/scene/Galaxy.tsx` (see
  `HEALTH_CHECKLIST.md`'s "P1 — CI blind spot" entry). Re-add, pinned to the
  `0.184.x` line, when the skin-preview tile is actually built.
