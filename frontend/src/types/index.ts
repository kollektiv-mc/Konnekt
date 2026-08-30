import type { FC } from 'react'
import type { LucideIcon } from '../lib/icons'
import type { models } from '../../wailsjs/go/models'
export type { LayoutItem } from 'react-grid-layout'

/**
 * Shapes that cross the IPC boundary are aliased from the generated bindings,
 * never redeclared. A hand-written copy stays correct until someone *adds* a
 * field in `backend/models/`: structural typing catches a rename or a removal,
 * but a new field is silently absent on the TypeScript side, and `ModUpdateInfo`
 * showed how long that survives (HEALTH_LOG.md, 2026-08-20). `tiles/mods/
 * useMods.ts` and `tiles/backups/useBackups.ts` already aliased theirs.
 *
 * Two of these deliberately do not alias, and it is not an oversight — see
 * AppSettings and ConfigFile below.
 */
export type LayoutPreset = models.LayoutPreset
export type ServerConfig = models.ServerConfig
export type Player = models.Player
export type ServerStatus = models.ServerStatus

/**
 * At-a-glance description of one configured server (sidebar hover card).
 * Unlike ServerStatus.running, `running` here is specific to that server.
 */
export type ServerSummary = models.ServerSummary

/**
 * Kept hand-written on purpose: `theme`, `backgroundStyle` and `updateChannel`
 * are `string` in Go and string-literal unions here, and the narrowing is
 * load-bearing.
 * `useSettingsStore.load` validates the value coming off disk and casts to
 * `AppSettings['backgroundStyle']`, `lib/theme.ts:118` matches on it, and
 * `SettingsModal`'s `Segmented` controls are typed against these members.
 * Aliasing would widen all of that back to `string` and delete the
 * exhaustiveness checks — a downgrade wearing a cleanup's clothes.
 *
 * The backlog entry that proposed this cleanup claimed all eight duplicated
 * models could be aliased; measured field-by-field, six could and these three
 * could not. Every other member here matches `models.AppSettings` exactly, so
 * an added field is still the failure mode to watch for.
 */
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
  stopGraceSeconds: number
  consoleBufferLines: number
  consoleTimestamps: boolean
  notifyOnCrash: boolean
  notifyOnJoin: boolean
  schedulerPaletteCollapsed: boolean
  schedulerPaletteClosedCategories: Record<string, boolean>
  consoleQuickCommandsCollapsed: boolean
  navClosedSections: Record<string, boolean>
  checkUpdatesOnStartup: boolean
  updateChannel: 'stable' | 'snapshot'
  crateOrder: string[]
  navWidth: number
}

/**
 * Also hand-written on purpose, for the same reason: `category` and `format`
 * are `string` in Go, and the config tile switches on `format` to pick a
 * CodeMirror language and a parser. Widening it to `string` would lose the
 * compiler's check that every branch is handled.
 */
export interface ConfigFile {
  relPath: string
  name: string
  category: 'server' | 'plugins' | 'mods'
  source: string
  format: 'properties' | 'yaml' | 'json' | 'json5' | 'toml' | 'text'
  sizeBytes: number
  modified: number
}

// Frontend-only shapes below: no Go counterpart, nothing to alias.

export interface TileProps {
  serverId: string
  maximized?: boolean
}

export interface TileDefinition {
  id: string
  label: string
  /**
   * The glyph itself, not a name to look up — same shape as `component` below,
   * and for the same reason: a lookup table is a second place to keep in step
   * and a runtime failure when the two drift. Sourced from `lib/icons.ts`.
   */
  icon: LucideIcon
  maximizable?: boolean
  component: FC<TileProps>
  /**
   * The tile's compact roll-up, rendered by the Overview tile's maximized
   * panel (`tiles/overview/OverviewPanel.tsx`), which lists
   * `TILE_REGISTRY.filter((t) => t.summary)` rather than a hand-kept roster of
   * its own — so a tile added later cannot leave a stale Overview behind.
   *
   * Opt-in rather than "render `component` at `maximized: false`", because for
   * some tiles the unmaximized face *is* the whole tile: a live console or the
   * command button grid is not a summary of anything, and rolling it up would
   * subscribe Overview to the log stream. A tile with nothing to contribute
   * simply omits this.
   */
  summary?: FC<TileProps>
}
