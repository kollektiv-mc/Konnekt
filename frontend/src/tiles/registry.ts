import type { TileDefinition } from '../types'
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
    icon: '>_',
    maximizable: true,
    component: ConsoleTile,
  },
  {
    id: 'stats',
    label: 'Stats',
    icon: '##',
    component: StatsTile,
  },
  {
    id: 'players',
    label: 'Players',
    icon: '[]',
    maximizable: true,
    component: PlayersTile,
  },
  {
    id: 'quick-commands',
    label: 'Commands',
    icon: '>>',
    component: QuickCommandsTile,
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: '/\\',
    maximizable: true,
    component: PerformanceTile,
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    icon: '()',
    maximizable: true,
    component: SchedulerTile,
  },
  {
    id: 'worlds',
    label: 'Worlds',
    icon: '{}',
    maximizable: true,
    component: WorldsTile,
  },
  {
    id: 'backups',
    label: 'Backups',
    icon: '[+]',
    maximizable: true,
    component: BackupsTile,
  },
  {
    id: 'server-config',
    label: 'Config',
    icon: '==',
    maximizable: true,
    component: ConfigTile,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: '[!]',
    maximizable: true,
    component: NotificationsTile,
  },
  {
    id: 'mods',
    label: 'Plugins & Mods',
    icon: '<>',
    maximizable: true,
    component: ModsTile,
  },
]
