# Konnekt — Feature Roadmap

Direction and sequencing. Individual Beta and Remote Access tasks live in
[GitHub Issues](../../issues) — this file does not track those as a checklist
anymore; match on the issue, not on a line here.

The Alpha section below is kept in full as shipped history and technical
reference: what exists, how it's built, and where. It predates the
GitHub-Issues convention and isn't being rewritten to fit it — Alpha is
complete, so there's nothing left to extract.

Note: some Beta features (Settings page, theme toggle, desktop notifications)
were shipped early during Alpha. Their status below reflects reality.

---

## Status legend (Alpha section only)

- `[ ]` Not started
- `[x]` Complete
- `[~]` Partial / placeholder

---

## Alpha — complete

### Core infrastructure

- [x] Wails v2 app scaffold (Go + React + TypeScript + Vite)
- [x] Tailwind CSS v4 design system (dark, #05060a base, #4ade80 accent),
      backed by the generated token layer in `frontend/src/styles/`
- [x] Custom scrollbar (4px, dark minimal, matches design scheme)
- [x] Satoshi (display), Excon (titles) and Ranade (body) webfonts; mono is the
      native OS stack. JetBrains Mono and Inter were the original plan and were
      never shipped
- [x] Startup splash screen (Satoshi Black "Konnekt" in accent green, 1s fade+glow animation)
- [x] Tile layout system (react-grid-layout, drag, resize, snap)
- [x] Tile crate (inactive tiles panel, add/remove from canvas)
- [x] Tile scale and maximise
  - [x] Maximise button in tile header: expands tile to fill the canvas area as an overlay
  - [x] Restore button returns tile to its previous grid position and size
  - [x] Only one tile maximised at a time; closing restores the previous layout
  - [x] Smooth open/close animations: opacity fade on both flip-transform and fallback paths
  - (maximise lives in tiles/TileWrapper + Dashboard animations)
- [x] Layout presets (save, restore, delete named layouts)
- [x] Default presets: "Default", "Console Focus", "Compact", "Essentials"
- [x] Persistence via Go JSON files (~/.config/konnekt/)
- [x] All IPC bindings generated via wails generate module
- [x] Typed IPC error handling — per-store / per-tile-hook `loading`/`error`
  state. (A shared `useWailsCall()` hook shipped here first and was removed
  unused; see `agent_docs/CLAUDE.md`'s IPC conventions.)

### Server management

- [x] Start server (spawn Java process with configurable JVM args)
- [x] Stop server (clean process shutdown)
- [x] Restart server
- [x] Send command (write to process stdin)
- [x] Multi-server instance support — multiple saved server *configs*, one
  running at a time. `ServerService` is a singleton holding a single process,
  console buffer and player map; `Start` refuses while another server runs.
  Running several concurrently is [issue #57](../../issues/57), not Alpha scope.
- [x] Server config storage (name, jar path, JVM args, working dir per server)
- [x] Add / remove server instances from sidebar
- [x] EULA acceptance prompt
  - Detects "eula.txt" in log stream, emits server:eula-required event
  - Amber modal with EULA link (opens system browser), Accept & Restart, Dismiss
  - On accept: writes eula=true to {workingDir}/eula.txt then restarts server
- [x] GetPlayers — log-based player tracking
  - Parses "joined the game" / "left the game" from log stream via regex
  - Thread-safe in-memory map; cleared on server stop
  - Emits player:joined and player:left events for future Notifications tile
  - Ping omitted (requires RCON); GetPlayers() returns live list

### Tiles — implemented

- [x] Console tile (live log streaming, auto-scroll, pause on scroll up,
  command input, clear console button)
- [x] Stats tile (status, players online, TPS with colour banding,
  RAM used/total with progress bar, uptime)
  - All values live: TPS via RCON (log-based fallback), RAM via gopsutil RSS,
    player count from log-parsed in-memory map; all served by GetServerStatus()
- [x] Quick commands tile (start, stop, restart, save-all, list, set day,
  clear weather, freeze time, kick/ban with modal, custom commands)

### Tiles — remaining alpha

- [x] Players tile
  
  - Online player list, polls GetPlayers() every 3 seconds
  - Kick and ban buttons per player; colour-coded modal with optional reason
  - List clears automatically when server stops

- [x] Performance tile
  
  - Time-series chart of TPS, RAM, CPU (last 1 hour)
  - Go: StatsService ring buffer, 360 snapshots at 10s intervals, emits stats:snapshot
  - Frontend: recharts ComposedChart, dual Y-axes, compact + expanded views with
    sortable summary table and toggle-able series; GetStatsHistory() for initial load

- [x] Scheduler tile - Node Graph Interface
  - React Flow visual editor (Phase 2a): drag/drop palette, generic BlockNode renderer,
    control edges (solid) + data edges (dashed), isValidConnection rejects cross-kind wiring,
    NodeConfigPanel with per-type widgets + "wired" badge, multi-select (left-drag box),
    pan on middle mouse, delete selected, graph CRUD + enable toggle + Run now
  - Backend engine: BFS execution, concurrency guard (one run per graph), resolveDataInputs
    overlays wired edge values onto config; 17 native blocks + JSON manifest loader
  - Triggers: playerJoined/Left, serverStopped, backupCompleted/Failed, tpsThreshold,
    interval, timeOfDay, cron
  - Actions: consoleCommand, rcon, serverStart/Stop/Restart, backup, httpRequest, delay
  - Control: condition (onTrue/onFalse)
  - Notify: notify block fully wired — backend emits schedule:notify, frontend listener
    routes to emitNotification with info/warn/error kinds
  - Data category: serverAttribute (TPS/playerCount/RAM/running), randomNumber, constValue,
    mathOp (+/-/*/div/mod) — all wire into condition.left/right or any wirable field
  - Persistence to ~/.config/konnekt/scheduler.json; run history (200 records in-memory)
  - [x] Graph entrance animation on maximize: nodes stagger-fade in, edges draw in
    via AnimatedEdge (SVG pathLength stroke-dashoffset technique); handle re-measurement
    deferred until after animations so connections land at correct positions
  - [x] Phase 2b complete:
    - Live node highlighting: GraphEditor subscribes to schedule:run/node events,
      pulses the running node (accent glow), colors finished nodes green/red, and
      lights fired control edges in accent; auto-clears ~2.4s after run finishes.
    - Run history persisted to ~/.config/konnekt/scheduler-history.json (load on
      startup, capped at 200; addHistory writes a snapshot outside the lock).
    - Cycle visualization: detectControlCycles() statically flags nodes/edges in a
      control-flow loop (amber) — warns before a run aborts on the maxNodesPerRun guard.
    - Next-run in compact summary: backend NextRuns() computes the next fire time for
      interval/timeOfDay/cron triggers (GetScheduleNextRuns, polled every 30s); summary
      shows per-graph "in 5m/2h/3d" + a soonest "next run" footer.

- [x] Worlds tile - 3D Solar-System World Manager
  - 3-level navigation: Galaxy (L0) → World system (L1) → Floating HUD card (L2)
  - L0: central Sun = server, each world save orbits it; active world wears rings;
    per-planet proximity push to the cursor, inside `Planet.tsx`'s `useFrame`.
  - L1: overworld is the central body, nether/the_end are moons; OrbitControls.
  - L2: WorldHud (drei Html) anchored to the clicked body — metadata from level.dat
    (NBT reader: version, mode, difficulty, seed, last-played), size, modified, path;
    Set-active with 3-way confirm when running (Stop+restart / Stop only / Cancel),
    per-world Backup (reuses BackupService + shared progress bar), Open folder,
    Rename, Duplicate, Delete.
  - Backend: WorldService (ListWorlds, SetActiveWorld, DeleteWorld, RenameWorld,
    DuplicateWorld, OpenWorldFolder, BackupWorld); built-in NBT reader (nbt.go,
    no new Go dependency); groups Paper/Spigot siblings + vanilla DIM-1/DIM1.
  - Compact summary: world count, active world name, per-world size list.
  - three.js + @react-three/fiber + @react-three/drei; lazy-loaded so the bundle
    only ships when the tile is maximized.

- [x] Backups tile
  - [x] Manual backup button (zip full server dir → {dataDir}/backups/{serverID}/)
  - [x] Save-flush coordination: issues save-off/save-all/save-on via RCON when the server is running so the zip is consistent
  - [x] Backup list with timestamp, size, restore and delete actions; summary view when not maximised (BackupsSummary)
  - [x] Live progress UI: backup:started/progress events drive a shared ActiveProcesses bar (useProcessesStore) + BackupRunningDialog
  - [x] Restore backup (refuses while server running, safe extract-then-swap, rolls back on failure)
  - [x] Notifications: backup:completed / backup:failed events + emitNotification
  - [x] Path-traversal validation on all filename inputs
  - [x] Scheduled backups — delivered via the Scheduler tile (interval/timeOfDay/cron
    trigger → backup action block), rather than a dedicated config here
  - Go: BackupService (backup.go — ListBackups, CreateBackup, RestoreBackup, DeleteBackup); models/backup.go; frontend tiles/backups/useBackups.ts

- [x] Server Config tile  *(shipped as a general config-file editor; diverged from original spec)*
  
  - [x] File list of editable config files (server.properties, JSON, YAML, TOML)
  - [x] Form-based key/value editor with typed widgets (parsers in tiles/config/form/)
  - [x] Raw text editor with dirty-tracking, save, revert; compact summary when not maximised
  - [x] Save writes directly to the config file; offers restart when server running
  - Go: backend/services/config_editor.go — ListConfigFiles / ReadConfigFile / WriteConfigFile
  - (grouped fields / gamerule editor / MOTD preview moved to Beta — see GitHub Issues)

- [x] Notifications tile
  
  - [x] In-app feed (reverse-chronological, timestamped, colour-coded by kind), clear-all
  - [x] OS desktop notifications too (WebView Notification API, lib/notify.ts)
  - [x] Notification kinds: crash, join, info, warn, error — each with distinct icon + colour
  - [x] Events wired: server started/stopped/crashed, player joined/left,
    backup completed/failed, scheduler notify block (info/warn/error), TPS below
    threshold (<14, edge-triggered with 14/15 hysteresis). Player-left shares the
    "Player join/leave alerts" toggle.
  - Frontend: stores/useNotificationsStore.ts (emitted client-side; no Go NotificationService)

---

## Beta

Do not scaffold or implement these during Alpha (Alpha is done — this note is
historical). Individual Beta tasks are filed in
[GitHub Issues](../../issues), labelled `milestone:beta`.

- **Backups — beta hardening.** Full-server vs world-only snapshots shipped;
  remaining: per-world backup surfacing in the Worlds tile, the "World-specific"
  segment in the Backups tile, a world-specific Scheduler backup action,
  multi-dimension (`world_nether`/`world_the_end`) backup, retention/pruning,
  cancel-in-progress, a concurrency guard, restore integrity checks, and
  import from an external file.
- **Tiles — beta.** Server Config tile enhancements (grouped fields, gamerule
  editor, MOTD preview), a File explorer tile, an Audit log tile, a Mod/plugin
  manager tile (Modrinth + CurseForge), a Player profiles tile, a Player skin
  preview tile.
- **Features — beta.** Public server IP via playit.gg tunnel, extended (24h/7-day)
  performance history, routing desktop notifications through the originally
  planned Wails `runtime.EventsEmit` path, configurable keyboard shortcuts,
  and the Settings page's remaining items (global JVM defaults, backup
  retention policy).

## Remote access — full dashboard over the web

Expose the entire Konnekt dashboard to a remote browser (phone/laptop) via a
zero-config tunnel, secured with a password + session token. The remote client
is a responsive web page served by the app itself — no native mobile app, no
second frontend build.

**Core idea:** Wails injects `window.go.main.App.*` (IPC) and `window.runtime.*`
(events) into the local WebView. A remote browser has neither. Rather than
rewrite every tile's IPC calls, the frontend detects plain-browser mode and
injects a **shim** that implements those same globals against an embedded HTTP
server. Tiles render remotely with zero per-tile changes (every generated
binding funnels through `window['go']['main']['App'][Method]`).

**Sequencing decision:** Phases 1–5 are deferred until after all Beta tiles ship.
The shim is tile-agnostic, so Phases 1–2 cost the same now or later, while the
expensive-to-retrofit groundwork (Phase 0 — EventBus, console replay buffer,
uniform `(T, error)` bindings) is already done. Beta also adds the most
remote-hostile surface (file explorer, mod manager → native file I/O, downloads),
all of which Phase 5 must adapt; building remote first would mean redoing that
work per tile. Auth + tunnel (Phases 3–4) also expose the dashboard to the web,
so they should land once against a stable, hardened feature set. Until then, the
only ongoing cost is the remote-readiness checklist under "Adding a tile" below.

- [x] **Phase 0 — Event hub refactor**
  - `EventBus` (backend/services/eventbus.go) is now the single emit path; every
    service routes through `bus.Emit(event, data)` instead of calling
    `runtime.EventsEmit` directly. Wired into server.go (log lines, eula, player
    joined/left, server stopped), stats.go (snapshots), backup.go (started/
    progress/completed/failed/restore). The remote WS fan-out seam is marked in
    `Emit()` for Phase 1 — no service bypasses it.

Phases 1–5 (RemoteService, frontend remote runtime, auth, cloudflared tunnel,
remote-mode adaptations) are filed in [GitHub Issues](../../issues), labelled
`milestone:remote-access`.

Open questions to resolve before build: single app-wide password vs per-user
accounts (default: single); whether remote needs per-server sessions or just
mirrors the one active server like the desktop does (default: mirror).

## Later

Breadth, once the foundations are proven. Ordering here is not fixed, and
most of this is not filed as issues yet — it's too early to scope precisely.
Where an item does have an issue, it is linked.

- **Concurrent multi-server** — run more than one server at a time
  ([#57](../../issues/57)). Everything below `ServerService` assumes a single
  process; the issue scopes only the first step (extracting per-server runtime
  state into a `serverInstance`) and lists the open UI questions.

Nothing else here is scoped yet. Add an item only once it has a shape worth
writing down; a bare feature name belongs in a GitHub Issue, not here.

---

## Explicitly out of scope

Recording these so they are not accidentally re-litigated. Every entry points at
where the decision was actually made — this section records, it does not decide.

- **A cloud backend or hosted account system.** Konnekt is local-first: state
  persists as JSON in the Wails app data directory and nothing calls home except
  the update check and Modrinth. See `agent_docs/CLAUDE.md`'s opening line and
  its "Do not" rule against `localStorage`/`sessionStorage`. Remote Access
  (above) is a tunnel to the user's own machine, not a service.
- **Rocky/RHEL 9 packaging.** EL9 never shipped webkit2gtk-4.1 and EL10 dropped
  4.0, so one binary cannot span both. See `agent_docs/DEPENDENCIES.md` and the
  README's Platform support section.
- **A second frontend for mobile.** Remote Access serves the same responsive
  build through a shim; there is no native app and no second bundle. See the
  Remote access section above.

Two things are deferred rather than out of scope, and are tracked in
`agent_docs/HEALTH_CHECKLIST.md`'s "Release follow-ups": a macOS release leg,
and code-signing/notarization.

---

## Implementation notes for Claude Code

### Adding a tile (checklist)

1. Create `frontend/src/tiles/<TileName>/index.tsx`
2. Create `frontend/src/tiles/<TileName>/types.ts` if the tile has
   its own local state shape
3. Register in `frontend/src/tiles/registry.ts` — extend the array,
   never restructure the file
4. If new Go data is needed:
   a. Add struct to `backend/models/` if it crosses the IPC boundary
   b. Add method to relevant service in `backend/services/`
   c. Bind method on the App struct in `app.go` (repo root)
   d. Run `wails generate module` to regenerate TS bindings
   e. Import from `frontend/wailsjs/go/main/` in the tile
5. Run `pnpm typecheck` and `go vet ./...` before marking done
6. Remote-readiness (keeps the future Remote Access feature cheap — see below):
   a. Fetch data only through generated bindings — never raw `window.go`
   b. Emit/consume events through `EventBus`, never `runtime.EventsEmit` directly
   c. Any native-only method (file dialog, OS file/folder open, host path access)
      must be flagged "needs a remote fallback in Remote Access Phase 5" at the
      call site, so it surfaces when the remote shim is built

### Event naming convention

Wails runtime events use colon-namespaced strings:

- `log:line` — console log line from server stdout
- `stats:snapshot` — periodic stats update
- `notification:event` — user-facing notification
- `backup:progress` — backup operation progress
- `backup:complete` — backup finished
- `backup:error` — backup failed

Define all event name constants in `frontend/src/lib/constants.ts` and `backend/services/events.go` — never hardcode event strings inline.

### Go service pattern

Each service follows this shape:

```go
type MyService struct {
    ctx context.Context
    // fields
}

func NewMyService() *MyService {
    return &MyService{}
}

func (s *MyService) SetContext(ctx context.Context) {
    s.ctx = ctx
}
```

Services are instantiated in `app.go`, context is set in `startup()`.
