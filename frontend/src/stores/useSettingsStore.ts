import { create } from 'zustand'
import type { AppSettings } from '../types'
import { applySkin, BUILTIN_SKINS } from '../lib/theme'
import { STATUS_DEFAULTS } from '../styles/tokens'
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
  consoleBufferLines: 1000,
  consoleTimestamps: false,
  notifyOnCrash: false,
  notifyOnJoin: false,
  schedulerPaletteCollapsed: true,
  schedulerPaletteClosedCategories: {},
  consoleQuickCommandsCollapsed: false,
  checkUpdatesOnStartup: true,
}

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
}

const validThemes = ['light', 'dark', 'system'] as const
const validSkinIds = BUILTIN_SKINS.map((s) => s.id)
const validBgStyles = ['solid', 'gradient'] as const

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,

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
      settings = {
        ...DEFAULTS,
        ...s,
        theme,
        skinId,
        backgroundStyle,
        schedulerPaletteClosedCategories: s.schedulerPaletteClosedCategories ?? {},
      }
    } catch {
      /* non-Wails context */
    }
    applySkin(settings)
    set({ settings, loaded: true })
  },

  update: async (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    applySkin(next)
    try {
      await SaveAppSettings(next)
    } catch {
      /* best-effort */
    }
  },
}))
