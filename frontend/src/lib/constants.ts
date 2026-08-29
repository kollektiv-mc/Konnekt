import { TILE_SIZE, TILE_MIN } from './gridSizing'

export const EVENTS = {
  LOG_LINE: 'log:line',
  SERVER_STARTED: 'server:started',
  SERVER_STOPPED: 'server:stopped',
  EULA_REQUIRED: 'server:eula-required',
  SERVER_STATUS: 'server:status',
  SERVER_STATE: 'server:state',
  STATS_SNAPSHOT: 'stats:snapshot',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  BACKUP_STARTED: 'backup:started',
  BACKUP_PROGRESS: 'backup:progress',
  BACKUP_COMPLETED: 'backup:completed',
  BACKUP_FAILED: 'backup:failed',
  RESTORE_COMPLETED: 'backup:restore-completed',
  SCHEDULE_RUN_STARTED: 'schedule:run-started',
  SCHEDULE_NODE_STARTED: 'schedule:node-started',
  SCHEDULE_NODE_FINISHED: 'schedule:node-finished',
  SCHEDULE_RUN_FINISHED: 'schedule:run-finished',
  SCHEDULE_NOTIFY: 'schedule:notify',
  SCHEDULE_NEXT_RUNS: 'schedule:next-runs',
  MOD_INSTALL_STARTED: 'mod:install-started',
  MOD_INSTALL_PROGRESS: 'mod:install-progress',
  MOD_INSTALLED: 'mod:installed',
  MOD_INSTALL_FAILED: 'mod:install-failed',
  MOD_CHANGED: 'mod:changed',
  INSTALL_STARTED: 'install:started',
  INSTALL_LOG: 'install:log',
  INSTALL_FINISHED: 'install:finished',
  INSTALL_FAILED: 'install:failed',
  LOADER_UPDATE_STARTED: 'loader:update-started',
  LOADER_UPDATE_FINISHED: 'loader:update-finished',
  LOADER_UPDATE_FAILED: 'loader:update-failed',
  UPDATE_PROGRESS: 'update:progress',
} as const

export const COLS = 6
export const ROW_HEIGHT = 40

// Uniform sizing is the *default*, not a constraint: every tile can be resized
// within TILE_MIN..TILE_MAX (see lib/gridSizing.ts). A preset that leaves every
// tile at one size therefore only needs to say *which* tiles and in *what
// order* — lay them out row-major (wrapping at COLS) and let load-time
// compaction (useLayoutStore's `compacted()`) settle the exact result.
//
// A preset that deliberately uses the resize range cannot be expressed that
// way and is written out literally instead (see 'Default' below).
function tileGrid(ids: readonly string[], size: { w: number; h: number }): string {
  const perRow = Math.max(1, Math.floor(COLS / size.w))
  return JSON.stringify(
    ids.map((i, idx) => ({
      i,
      x: (idx % perRow) * size.w,
      y: Math.floor(idx / perRow) * size.h,
      w: size.w,
      h: size.h,
    })),
  )
}

// Every tile the app registers, and the set a fresh install starts with (see
// stores/useTileStore.ts). Kept as one list so the default tile set and the
// full-coverage presets below cannot drift apart.
export const ALL_TILE_IDS = [
  'console',
  'stats',
  'players',
  'quick-commands',
  'performance',
  'scheduler',
  'worlds',
  'backups',
  'server-config',
  'notifications',
  'mods',
] as const

export const DEFAULT_LAYOUT_PRESETS = [
  {
    // Hand-authored rather than generated: this one uses the resize range on
    // purpose. Two columns, each packed top to bottom — the tiles you watch
    // (quick-commands, console, performance, stats) sit above the fold, and
    // server-config takes the full TILE_MAX height because its form is long.
    // Transcribed from a working arrangement; `tileGrid()` cannot express the
    // varying heights, so edit the coordinates directly if this changes.
    name: 'Default',
    layout: JSON.stringify([
      { i: 'quick-commands', x: 0, y: 0, w: 3, h: 4 },
      { i: 'console', x: 0, y: 4, w: 3, h: 8 },
      { i: 'notifications', x: 0, y: 12, w: 3, h: 4 },
      { i: 'mods', x: 0, y: 16, w: 3, h: 8 },
      { i: 'server-config', x: 0, y: 24, w: 3, h: 16 },
      { i: 'performance', x: 3, y: 0, w: 3, h: 4 },
      { i: 'stats', x: 3, y: 4, w: 3, h: 4 },
      { i: 'players', x: 3, y: 8, w: 3, h: 8 },
      { i: 'scheduler', x: 3, y: 16, w: 3, h: 8 },
      { i: 'worlds', x: 3, y: 24, w: 3, h: 8 },
      { i: 'backups', x: 3, y: 32, w: 3, h: 8 },
    ]),
  },
  {
    name: 'Console Focus',
    layout: tileGrid(
      [
        'console',
        'quick-commands',
        'stats',
        'notifications',
        'performance',
        'players',
        'scheduler',
        'worlds',
        'backups',
        'server-config',
        'mods',
      ],
      TILE_SIZE,
    ),
  },
  {
    // Same 11 tiles as Default, authored at the shared minimum size instead
    // of the standard one — demonstrates the min..max resize range actually
    // does something, rather than just being a second copy of Default.
    name: 'Compact',
    layout: tileGrid(ALL_TILE_IDS, TILE_MIN),
  },
  {
    // Deliberately a small curated subset (not all 11 tiles) — that's the
    // point of "essentials". Only Default/Console Focus/Compact aim for
    // full coverage.
    name: 'Essentials',
    layout: tileGrid(
      ['console', 'quick-commands', 'stats', 'performance', 'players', 'notifications'],
      TILE_SIZE,
    ),
  },
]

// Mirrors loaderTargetFolder() in backend/services/modservice.go
export const PLUGIN_LOADERS = ['paper', 'spigot', 'bukkit', 'purpur', 'velocity'] as const
