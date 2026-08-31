import type { TileDefinition } from '../types'
import {
  Blocks,
  Command,
  Database,
  Earth,
  FileSliders,
  Gauge,
  MessageCircleWarning,
  LayoutDashboard,
  SquareChevronRight,
  UsersRound,
  Workflow,
} from '../lib/icons'
import { ConsoleTile } from './console'
import { ModsTile } from './mods'
import { OverviewTile } from './overview'
import { PlayersTile } from './players'
import { QuickCommandsTile } from './quick-commands'
import { PerformanceTile } from './performance'
import { SchedulerTile } from './scheduler'
import { WorldsTile } from './worlds'
import { BackupsTile } from './backups'
import { ConfigTile } from './config'
import { NotificationsTile } from './notifications'

export const TILE_REGISTRY: TileDefinition[] = [
  {
    id: 'console',
    label: 'Console',
    icon: SquareChevronRight,
    maximizable: true,
    component: ConsoleTile,
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
  },
  {
    id: 'players',
    label: 'Players',
    icon: UsersRound,
    maximizable: true,
    component: PlayersTile,
  },
  {
    id: 'quick-commands',
    label: 'Commands',
    icon: Command,
    maximizable: true,
    component: QuickCommandsTile,
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: Gauge,
    maximizable: true,
    component: PerformanceTile,
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    icon: Workflow,
    maximizable: true,
    component: SchedulerTile,
  },
  {
    id: 'worlds',
    label: 'Worlds',
    icon: Earth,
    maximizable: true,
    component: WorldsTile,
  },
  {
    id: 'backups',
    label: 'Backups',
    icon: Database,
    maximizable: true,
    component: BackupsTile,
  },
  {
    id: 'server-config',
    label: 'Config',
    icon: FileSliders,
    maximizable: true,
    component: ConfigTile,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: MessageCircleWarning,
    maximizable: true,
    component: NotificationsTile,
  },
  {
    id: 'mods',
    label: 'Plugins',
    icon: Blocks,
    maximizable: true,
    component: ModsTile,
  },
]
