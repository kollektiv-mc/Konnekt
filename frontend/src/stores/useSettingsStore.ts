import { create } from 'zustand'
import type { AppSettings } from '../types'
import { applySkin, BUILTIN_SKINS } from '../lib/theme'
import { STATUS_DEFAULTS } from '../styles/tokens'
import { normalizeCrateOrder, reorderWithinGroup } from '../lib/crateOrder'
import { clampNavWidth, NAV_WIDTH_DEFAULT } from '../lib/navWidth'
import { errMsg, hasWailsBridge } from '../lib/ipc'
import { GetAppSettings, SaveAppSettings } from '../../wailsjs/go/main/App'

// One colour is stored per role for both themes, seeded from the dark defaults.
// applySkin() compares against the same table to tell "never touched" from a real
// choice, so these must come from there rather than being written out again.
const DEFAULTS: AppSettings = {
  theme: 'dark',
  skinId: 'default',
  accentColor: STATUS_DEFAULTS.dark.accent,
  successColor: STATUS_DEFAULTS.dark.success,
  warningColor: STATUS_DEFAULTS.dark.warning,
  dangerColor: STATUS_DEFAULTS.dark.danger,
  backgroundStyle: 'solid',
  autoStartActiveServer: false,
  confirmBeforeStop: false,
  stopGraceSeconds: 60,
  consoleBufferLines: 1000,
  consoleTimestamps: false,
  notifyOnCrash: false,
  notifyOnJoin: false,
  schedulerPaletteCollapsed: true,
  schedulerPaletteClosedCategories: {},
  consoleQuickCommandsCollapsed: false,
  // Servers and Tiles open, Widgets and Layouts closed: the two a first run
  // wants to see are the server it is about to start and the tiles it can
  // place, and the other two are there when they are looked for. Kept in step
  // with services.GetAppSettings, which is what a real install reads.
  navClosedSections: { widgets: true, layouts: true },
  checkUpdatesOnStartup: true,
  updateChannel: 'stable',
  crateOrder: [],
  navWidth: NAV_WIDTH_DEFAULT,
}

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
  reorderCrate: (id: string, toIndex: number, groupIds: ReadonlySet<string>) => void
  clearError: () => void
}

const validThemes = ['light', 'dark', 'system'] as const
const validSkinIds = BUILTIN_SKINS.map((s) => s.id)
const validBgStyles = ['solid', 'gradient'] as const
const validChannels = ['stable', 'snapshot'] as const

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,
  error: null,

  load: async () => {
    let settings = { ...DEFAULTS }
    try {
      const s = await GetAppSettings()
      const theme = (validThemes as readonly string[]).includes(s.theme)
        ? (s.theme as AppSettings['theme'])
        : DEFAULTS.theme
      const skinId = validSkinIds.includes(s.skinId) ? s.skinId : DEFAULTS.skinId
      const backgroundStyle = (validBgStyles as readonly string[]).includes(s.backgroundStyle)
        ? (s.backgroundStyle as AppSettings['backgroundStyle'])
        : DEFAULTS.backgroundStyle
      // Also covers the settings file written before this field existed, where
      // `updateChannel` arrives as "" rather than absent.
      const updateChannel = (validChannels as readonly string[]).includes(s.updateChannel)
        ? (s.updateChannel as AppSettings['updateChannel'])
        : DEFAULTS.updateChannel
      settings = {
        ...DEFAULTS,
        ...s,
        theme,
        skinId,
        backgroundStyle,
        updateChannel,
        schedulerPaletteClosedCategories: s.schedulerPaletteClosedCategories ?? {},
        navClosedSections: s.navClosedSections ?? DEFAULTS.navClosedSections,
      }
    } catch {
      /* non-Wails context */
    }
    // Both normalizations run unconditionally (not just on the GetAppSettings
    // success path) so the rest of the app never sees an unusable value:
    // leaving `crateOrder` at `[]` would let a reorder performed before the
    // next successful load silently drop tiles, and a `navWidth` of 0 — what a
    // settings file written before that field existed unmarshals to — would
    // render the navbar with no width at all.
    settings = {
      ...settings,
      crateOrder: normalizeCrateOrder(settings.crateOrder),
      navWidth: clampNavWidth(settings.navWidth, window.innerWidth),
    }
    applySkin(settings)
    set({ settings, loaded: true })
  },

  /**
   * Applies the patch before the write so the control the user just touched
   * moves at once, then rolls the whole settings object back if the backend
   * refuses it. `confirmBeforeStop` and `notifyOnCrash` are safety toggles a
   * user would otherwise believe are on for the rest of the session and gone at
   * the next start (HEALTH_LOG.md, 2026-08-20).
   *
   * Rethrows so a caller that owns extra local state can react. Callers with
   * nothing of their own to undo can ignore it: the revert here has already put
   * the control back, and `error` carries the reason.
   *
   * With no bridge (`frontend-dev`) the optimistic value stands — see
   * `lib/ipc.ts`.
   */
  update: async (patch) => {
    const prev = get().settings
    const next = { ...prev, ...patch }
    set({ settings: next, error: null })
    applySkin(next)
    try {
      await SaveAppSettings(next)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ settings: prev, error: errMsg(e) })
        applySkin(prev)
        throw e
      }
      /* No bridge: nothing to persist to, so keep the optimistic value. */
    }
  },

  // Deliberately swallows: `update` has already reverted the order and recorded
  // the reason, and this returns void because the crate calls it from a drag.
  reorderCrate: (id, toIndex, groupIds) => {
    const { crateOrder } = get().settings
    get()
      .update({ crateOrder: reorderWithinGroup(crateOrder, groupIds, id, toIndex) })
      .catch(() => {})
  },

  clearError: () => set({ error: null }),
}))
