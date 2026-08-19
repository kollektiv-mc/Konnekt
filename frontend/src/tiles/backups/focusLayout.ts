export const FOCUS = { left: '30%', top: '48%', size: 150 }
export const FOCUS_TRANSITION =
  'left 380ms cubic-bezier(0.34,1.15,0.64,1), top 380ms cubic-bezier(0.34,1.15,0.64,1), opacity 250ms ease'

import type { WorldSystem } from './useBackupWorlds'
export type FocusTarget = { kind: 'server' } | { kind: 'world'; world: WorldSystem } | null
