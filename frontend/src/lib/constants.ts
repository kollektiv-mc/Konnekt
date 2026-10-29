// The bubble for a graph's failed run. Raised from App for every run, scheduled
// or not, and reopened from the editor's toolbar, so both name it the same way.
export const scheduleRunToastKey = (graphId: string) => `scheduler:run:${graphId}`

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
  RESTORE_FAILED: 'backup:restore-failed',
  AUTOSAVE_STUCK: 'server:autosave-stuck',
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
  COMMANDS_CHANGED: 'commands:changed',
  REMOTE_CHANGED: 'remote:changed',
} as const

export const COLS = 6
export const ROW_HEIGHT = 40

// Every tile the app registers, and the set a fresh install starts with (see
// stores/useTileStore.ts). Kept as one list so the default tile set and the
// presets below that place every tile cannot drift apart.
export const ALL_TILE_IDS = [
  'console',
  // The Overview tile. Its id stays 'stats' because it is persisted verbatim
  // here, in the presets below, and in three JSON files under the app data dir
  // — see the comment on its entry in `tiles/registry.ts`.
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

// The built-in layouts. Each is written out cell by cell, because each uses
// the resize range on purpose, and each names exactly the tiles it puts on the
// board: applying one also sets the tile set (components/LayoutPresets.tsx),
// so a tile a layout leaves out goes back to the crate.
//
// The non-default ones are sized to fit 18 rows, one screen of a 1080p-class
// window (ROW_HEIGHT plus the grid's 12px margin is 52px a row), so none of
// them scrolls there. What each is for, by the tiles users reach for most:
// Console, Commands, Overview, Performance and Players, with Notifications
// when something is happening. Worlds, Scheduler, Backups, Config and Plugins
// are read at a glance and worked on maximized, so they get the least room.
export const DEFAULT_LAYOUT_PRESETS = [
  {
    // Two columns, each packed top to bottom with no gaps. The left
    // column gives console the full TILE_MAX height, because a log you cannot
    // scroll far enough back in is the tile that gets resized first; the right
    // column stacks the at-a-glance readouts (quick-commands, stats,
    // performance) above the fold and the management tiles below them.
    // Transcribed from a working arrangement. Unlike the others it runs past
    // one screen, on purpose: it is the whole board, roomy.
    name: 'Default',
    layout: JSON.stringify([
      { i: 'console', x: 0, y: 0, w: 3, h: 16 },
      { i: 'notifications', x: 0, y: 16, w: 3, h: 4 },
      { i: 'backups', x: 0, y: 20, w: 3, h: 7 },
      { i: 'mods', x: 0, y: 27, w: 3, h: 13 },
      { i: 'quick-commands', x: 3, y: 0, w: 3, h: 6 },
      { i: 'stats', x: 3, y: 6, w: 3, h: 5 },
      { i: 'performance', x: 3, y: 11, w: 3, h: 5 },
      { i: 'players', x: 3, y: 16, w: 3, h: 8 },
      { i: 'scheduler', x: 3, y: 24, w: 3, h: 5 },
      { i: 'worlds', x: 3, y: 29, w: 3, h: 4 },
      { i: 'server-config', x: 3, y: 33, w: 3, h: 8 },
    ]),
  },
  {
    // The console at two thirds of the width and the TILE_MAX height, with only
    // what typing into it needs beside it: is the server up, the buttons, and
    // who is online to kick, op or message.
    name: 'Console Focus',
    layout: JSON.stringify([
      { i: 'console', x: 0, y: 0, w: 4, h: 16 },
      { i: 'stats', x: 4, y: 0, w: 2, h: 4 },
      { i: 'quick-commands', x: 4, y: 4, w: 2, h: 6 },
      { i: 'players', x: 4, y: 10, w: 2, h: 6 },
    ]),
  },
  {
    // Every tile on one screen, in three columns. The console and the four
    // readouts get the height; the glance tiles sit at the minimum.
    name: 'Compact',
    layout: JSON.stringify([
      { i: 'console', x: 0, y: 0, w: 2, h: 10 },
      { i: 'notifications', x: 0, y: 10, w: 2, h: 4 },
      { i: 'server-config', x: 0, y: 14, w: 2, h: 4 },
      { i: 'quick-commands', x: 2, y: 0, w: 2, h: 5 },
      { i: 'stats', x: 2, y: 5, w: 2, h: 4 },
      { i: 'performance', x: 2, y: 9, w: 2, h: 5 },
      { i: 'players', x: 2, y: 14, w: 2, h: 4 },
      { i: 'worlds', x: 4, y: 0, w: 2, h: 4 },
      { i: 'scheduler', x: 4, y: 4, w: 2, h: 4 },
      { i: 'backups', x: 4, y: 8, w: 2, h: 5 },
      { i: 'mods', x: 4, y: 13, w: 2, h: 5 },
    ]),
  },
  {
    // The six tiles that matter and nothing else, on one screen: the three
    // readouts across the top, then a wide console with the buttons and the
    // notifications beside it.
    name: 'Essentials',
    layout: JSON.stringify([
      { i: 'stats', x: 0, y: 0, w: 2, h: 6 },
      { i: 'performance', x: 2, y: 0, w: 2, h: 6 },
      { i: 'players', x: 4, y: 0, w: 2, h: 6 },
      { i: 'console', x: 0, y: 6, w: 4, h: 12 },
      { i: 'quick-commands', x: 4, y: 6, w: 2, h: 6 },
      { i: 'notifications', x: 4, y: 12, w: 2, h: 6 },
    ]),
  },
]

// Mirrors loaderTargetFolder() in backend/services/modservice.go
export const PLUGIN_LOADERS = ['paper', 'spigot', 'bukkit', 'purpur', 'velocity'] as const
