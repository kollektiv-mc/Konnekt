import type { TileDefinition } from '../types'
import {
  Blocks,
  Command,
  Database,
  Earth,
  FileSliders,
  Gauge,
  MessageCircleWarning,
  SquareActivity,
  SquareChevronRight,
  UsersRound,
  Workflow,
} from '../lib/icons'
import { ConsoleTile } from './console'
import { ModsTile } from './mods'
import { StatsTile } from './stats'
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
    id: 'stats',
    label: 'Stats',
    icon: SquareActivity,
    component: StatsTile,
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
