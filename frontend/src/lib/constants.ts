export const DEFAULT_SERVER_ID = 'default'

export const EVENTS = {
  LOG_LINE: 'log:line',
  SERVER_STARTED: 'server:started',
  SERVER_STOPPED: 'server:stopped',
  EULA_REQUIRED: 'server:eula-required',
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
  UPDATE_PROGRESS: 'update:progress',
} as const

export const DEFAULT_LAYOUT_PRESETS = [
  {
    name: 'Default',
    layout: JSON.stringify([
      { i: 'console', x: 0, y: 0, w: 3, h: 13 },
      { i: 'quick-commands', x: 3, y: 0, w: 1, h: 6 },
      { i: 'players', x: 4, y: 0, w: 2, h: 6 },
      { i: 'performance', x: 3, y: 6, w: 3, h: 6 },
      { i: 'stats', x: 3, y: 12, w: 1, h: 4 },
      { i: 'scheduler', x: 4, y: 12, w: 2, h: 4 },
      { i: 'notifications', x: 0, y: 13, w: 3, h: 3 },
      { i: 'worlds', x: 0, y: 16, w: 3, h: 6 },
      { i: 'backups', x: 3, y: 16, w: 3, h: 6 },
      { i: 'server-config', x: 0, y: 22, w: 6, h: 5 },
    ]),
  },
  {
    name: 'Console Focus',
    layout: JSON.stringify([
      { i: 'console', x: 0, y: 0, w: 5, h: 15 },
      { i: 'quick-commands', x: 5, y: 0, w: 1, h: 11 },
      { i: 'stats', x: 5, y: 11, w: 1, h: 4 },
      { i: 'notifications', x: 0, y: 15, w: 2, h: 2 },
      { i: 'performance', x: 2, y: 15, w: 2, h: 2 },
      { i: 'players', x: 4, y: 15, w: 2, h: 2 },
      { i: 'server-config', x: 0, y: 17, w: 3, h: 8 },
      { i: 'scheduler', x: 3, y: 17, w: 3, h: 8 },
      { i: 'backups', x: 0, y: 25, w: 3, h: 6 },
      { i: 'worlds', x: 3, y: 25, w: 3, h: 6 },
    ]),
  },
  {
    name: 'Compact',
    layout: JSON.stringify([
      { i: 'console', x: 0, y: 0, w: 3, h: 10 },
      { i: 'stats', x: 3, y: 0, w: 1, h: 4 },
      { i: 'players', x: 4, y: 0, w: 2, h: 4 },
      { i: 'performance', x: 3, y: 4, w: 3, h: 4 },
      { i: 'notifications', x: 3, y: 8, w: 3, h: 2 },
      { i: 'quick-commands', x: 0, y: 10, w: 3, h: 4 },
      { i: 'worlds', x: 3, y: 10, w: 3, h: 3 },
      { i: 'scheduler', x: 3, y: 13, w: 3, h: 3 },
      { i: 'server-config', x: 0, y: 14, w: 3, h: 5 },
      { i: 'backups', x: 3, y: 16, w: 3, h: 3 },
    ]),
  },
  {
    name: 'Essentials',
    layout: JSON.stringify([
      { i: 'console', x: 0, y: 0, w: 3, h: 16 },
      { i: 'quick-commands', x: 3, y: 0, w: 2, h: 4 },
      { i: 'stats', x: 5, y: 0, w: 1, h: 4 },
      { i: 'performance', x: 3, y: 4, w: 3, h: 4 },
      { i: 'players', x: 3, y: 8, w: 3, h: 4 },
      { i: 'notifications', x: 3, y: 12, w: 3, h: 4 },
    ]),
  },
]

export const COLS = 6
export const ROW_HEIGHT = 40

// Mirrors loaderTargetFolder() in backend/services/modservice.go
export const PLUGIN_LOADERS = ['paper', 'spigot', 'bukkit', 'purpur', 'velocity'] as const
