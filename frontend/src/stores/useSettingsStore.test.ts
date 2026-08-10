import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useSettingsStore } from './useSettingsStore'
import { TILE_REGISTRY } from '../tiles/registry'

vi.mock('../../wailsjs/go/main/App')

const ALL_TILE_IDS = TILE_REGISTRY.map((t) => t.id)

const DEFAULTS = {
  theme: 'dark' as const,
  skinId: 'default',
  accentColor: '#4ade80',
  successColor: '#22c55e',
  warningColor: '#f59e0b',
  dangerColor: '#f87171',
  backgroundStyle: 'solid' as const,
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
  crateOrder: [] as string[],
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ settings: DEFAULTS, loaded: false })
  })

  describe('load', () => {
    it('merges a valid payload over the defaults', async () => {
      vi.mocked(App.GetAppSettings).mockResolvedValue({
        ...DEFAULTS,
        theme: 'light',
        accentColor: '#ff0000',
      })
      await useSettingsStore.getState().load()
      const { settings, loaded } = useSettingsStore.getState()
      expect(settings.theme).toBe('light')
      expect(settings.accentColor).toBe('#ff0000')
      expect(loaded).toBe(true)
    })

    it('falls back to the default theme when the backend value is invalid', async () => {
      vi.mocked(App.GetAppSettings).mockResolvedValue({ ...DEFAULTS, theme: 'neon' as never })
      await useSettingsStore.getState().load()
      expect(useSettingsStore.getState().settings.theme).toBe('dark')
    })

    it('falls back to the default skinId when the backend value is unrecognized', async () => {
      vi.mocked(App.GetAppSettings).mockResolvedValue({ ...DEFAULTS, skinId: 'nonexistent-skin' })
      await useSettingsStore.getState().load()
      expect(useSettingsStore.getState().settings.skinId).toBe('default')
    })

    it('falls back to the default backgroundStyle when the backend value is invalid', async () => {
      vi.mocked(App.GetAppSettings).mockResolvedValue({
        ...DEFAULTS,
        backgroundStyle: 'plaid' as never,
      })
      await useSettingsStore.getState().load()
      expect(useSettingsStore.getState().settings.backgroundStyle).toBe('solid')
    })

    it('falls back to defaults and still marks loaded when GetAppSettings rejects', async () => {
      vi.mocked(App.GetAppSettings).mockRejectedValue(new Error('no wails bridge'))
      await useSettingsStore.getState().load()
      const { settings, loaded } = useSettingsStore.getState()
      expect(settings).toEqual({ ...DEFAULTS, crateOrder: ALL_TILE_IDS })
      expect(loaded).toBe(true)
    })

    it('normalizes crateOrder: drops stale ids and appends newly-registered ones', async () => {
      vi.mocked(App.GetAppSettings).mockResolvedValue({
        ...DEFAULTS,
        crateOrder: ['stale-tile', ...ALL_TILE_IDS.slice(0, -1)],
      })
      await useSettingsStore.getState().load()
      expect(useSettingsStore.getState().settings.crateOrder).toEqual(ALL_TILE_IDS)
    })
  })

  describe('update', () => {
    it('applies the patch optimistically and persists the merged settings', async () => {
      const promise = useSettingsStore.getState().update({ consoleBufferLines: 500 })
      expect(useSettingsStore.getState().settings.consoleBufferLines).toBe(500)
      await promise
      expect(App.SaveAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ consoleBufferLines: 500 }),
      )
    })

    it('keeps the optimistic update even when SaveAppSettings rejects', async () => {
      vi.mocked(App.SaveAppSettings).mockRejectedValue(new Error('disk full'))
      await useSettingsStore.getState().update({ notifyOnCrash: true })
      expect(useSettingsStore.getState().settings.notifyOnCrash).toBe(true)
    })
  })

  describe('reorderCrate', () => {
    it('moves a tile within its group and persists the result', () => {
      useSettingsStore.setState({ settings: { ...DEFAULTS, crateOrder: ALL_TILE_IDS } })
      const groupIds = new Set(TILE_REGISTRY.filter((t) => t.maximizable).map((t) => t.id))
      const movedId = TILE_REGISTRY.find((t) => t.maximizable)!.id
      useSettingsStore.getState().reorderCrate(movedId, 0, groupIds)
      const { crateOrder } = useSettingsStore.getState().settings
      const groupOrder = crateOrder.filter((id) => groupIds.has(id))
      expect(groupOrder[0]).toBe(movedId)
      expect(App.SaveAppSettings).toHaveBeenCalledWith(expect.objectContaining({ crateOrder }))
    })

    it('leaves ids outside the group in their original slots', () => {
      useSettingsStore.setState({ settings: { ...DEFAULTS, crateOrder: ALL_TILE_IDS } })
      const utilityIds = TILE_REGISTRY.filter((t) => !t.maximizable).map((t) => t.id)
      const groupIds = new Set(TILE_REGISTRY.filter((t) => t.maximizable).map((t) => t.id))
      const movedId = TILE_REGISTRY.find((t) => t.maximizable)!.id
      useSettingsStore.getState().reorderCrate(movedId, 0, groupIds)
      const { crateOrder } = useSettingsStore.getState().settings
      expect(crateOrder.filter((id) => !groupIds.has(id))).toEqual(utilityIds)
    })
  })
})
