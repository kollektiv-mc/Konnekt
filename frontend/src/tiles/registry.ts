import type { TileDefinition } from '../types'
import {
  Blocks,
  Command,
  Database,
  Earth,
  FileSliders,
  Gauge,
  LayoutDashboard,
  MessageCircleWarning,
  SquareChevronRight,
  UsersRound,
  Workflow,
} from '../lib/icons'
import { ConsoleTile } from './console'
import { ModsTile } from './mods'
import { ModsSummaryCard } from './mods/ModsSummary'
import { OverviewTile } from './overview'
import { PlayersTile } from './players'
import { PlayersSummary } from './players/PlayersSummary'
import { QuickCommandsTile } from './quick-commands'
import { PerformanceTile } from './performance'
import { PerformanceSummaryCard } from './performance/PerformanceSummary'
import { SchedulerTile } from './scheduler'
import { SchedulerSummaryCard } from './scheduler/SchedulerSummaryCard'
import { WorldsTile } from './worlds'
import { WorldsSummaryCard } from './worlds/WorldsSummary'
import { BackupsTile } from './backups'
import { BackupsSummary } from './backups/BackupsSummary'
import { ConfigTile } from './config'
import { ConfigSummary } from './config/ConfigSummary'
import { NotificationsTile } from './notifications'

export const TILE_REGISTRY: TileDefinition[] = [
  {
    id: 'console',
    label: 'Console',
    icon: SquareChevronRight,
    maximizable: true,
    component: ConsoleTile,
    // No summary: the tile's compact face is the live log stream, which is not
    // a summary of anything and would put a `log:line` subscription inside the
    // Overview panel.
  },
  {
    // `id` stays 'stats' deliberately, though the tile is now Overview. It is
    // persisted verbatim in active_tiles.json, layout_presets.json and
    // active_layout.json (app.go), and in the latter two it lives *inside* the
    // serialized react-grid-layout string — so renaming it means a read-time
    // rewrite that has to live forever, in exchange for a string no user ever
    // sees. The tile's name is `label`. See lib/constants.ts's ALL_TILE_IDS.
    id: 'stats',
    label: 'Overview',
    icon: LayoutDashboard,
    maximizable: true,
    component: OverviewTile,
    // No summary of its own: it is the tile that renders everyone else's.
  },
  {
    id: 'players',
    label: 'Players',
    icon: UsersRound,
    maximizable: true,
    component: PlayersTile,
    summary: PlayersSummary,
  },
  {
    id: 'quick-commands',
    label: 'Commands',
    icon: Command,
    maximizable: true,
    component: QuickCommandsTile,
    // No summary: a panel of buttons is an action surface, with no state to
    // roll up.
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: Gauge,
    maximizable: true,
    component: PerformanceTile,
    summary: PerformanceSummaryCard,
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    icon: Workflow,
    maximizable: true,
    component: SchedulerTile,
    summary: SchedulerSummaryCard,
  },
  {
    id: 'worlds',
    label: 'Worlds',
    icon: Earth,
    maximizable: true,
    component: WorldsTile,
    summary: WorldsSummaryCard,
  },
  {
    id: 'backups',
    label: 'Backups',
    icon: Database,
    maximizable: true,
    component: BackupsTile,
    summary: BackupsSummary,
  },
  {
    id: 'server-config',
    label: 'Config',
    icon: FileSliders,
    maximizable: true,
    component: ConfigTile,
    summary: ConfigSummary,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: MessageCircleWarning,
    maximizable: true,
    component: NotificationsTile,
    // The tile ignores `maximized` — its only face already *is* the summary,
    // and it reads a store rather than IPC, so the roll-up gets it for free.
    summary: NotificationsTile,
  },
  {
    id: 'mods',
    label: 'Plugins',
    icon: Blocks,
    maximizable: true,
    component: ModsTile,
    summary: ModsSummaryCard,
  },
]
