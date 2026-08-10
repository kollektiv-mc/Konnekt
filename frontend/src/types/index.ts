import type { FC } from 'react'
export type { LayoutItem } from 'react-grid-layout'

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  skinId: string
  accentColor: string
  successColor: string
  warningColor: string
  dangerColor: string
  backgroundStyle: 'solid' | 'gradient'
  autoStartActiveServer: boolean
  confirmBeforeStop: boolean
  consoleBufferLines: number
  consoleTimestamps: boolean
  notifyOnCrash: boolean
  notifyOnJoin: boolean
  schedulerPaletteCollapsed: boolean
  schedulerPaletteClosedCategories: Record<string, boolean>
  consoleQuickCommandsCollapsed: boolean
  checkUpdatesOnStartup: boolean
  crateOrder: string[]
}

export interface TileProps {
  serverId: string
  maximized?: boolean
}

export interface TileDefinition {
  id: string
  label: string
  icon: string
  maximizable?: boolean
  component: FC<TileProps>
}

export interface LayoutPreset {
  name: string
  layout: string
}

export interface ServerConfig {
  id: string
  name: string
  jarPath: string
  jvmArgs: string[]
  workingDir: string
  mcVersion: string
  loader: string
}

export interface Player {
  name: string
  uuid: string
  online: boolean
  ip: string
  lastOnline: number
  opLevel: number
  whitelisted: boolean
  banned: boolean
  banReason: string
  primaryGroup: string
  groups: string[]
}

export interface ConfigFile {
  relPath: string
  name: string
  category: 'server' | 'plugins' | 'mods'
  source: string
  format: 'properties' | 'yaml' | 'json' | 'json5' | 'toml' | 'text'
  sizeBytes: number
  modified: number
}

export interface ServerStatus {
  running: boolean
  uptime: string
  players: number
  maxPlayers: number
  tps: number
  ramUsed: number
  ramTotal: number
}
