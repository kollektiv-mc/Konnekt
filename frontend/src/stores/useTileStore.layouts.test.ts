import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { readTileLayouts, useTileStore } from './useTileStore'

vi.mock('../../wailsjs/go/main/App')

const attachBridge = () => Object.assign(window, { go: {} })

// The per-tile layout half of the store, kept apart from useTileStore.test.ts
// so the active-list cases there stay about the active list.
describe('useTileStore layouts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.SaveTileLayouts).mockResolvedValue(undefined)
    vi.mocked(App.GetActiveTiles).mockResolvedValue(['stats'])
    Reflect.deleteProperty(window, 'go')
    useTileStore.setState({ activeTileIds: [], layouts: {}, error: null })
  })

  it('reads only the layouts it knows, and never stores default', () => {
    expect(
      readTileLayouts({ stats: 'large', players: 'compact', worlds: 'default', mods: 'huge' }),
    ).toEqual({ stats: 'large', players: 'compact' })
    expect(readTileLayouts(undefined)).toEqual({})
  })

  it('loads the saved layouts with the active list', async () => {
    vi.mocked(App.GetTileLayouts).mockResolvedValue({ stats: 'compact' })
    await useTileStore.getState().loadTiles()
    expect(useTileStore.getState().layouts).toEqual({ stats: 'compact' })
  })

  it('persists a choice and drops the key for default', async () => {
    await useTileStore.getState().setLayout('stats', 'large')
    expect(useTileStore.getState().layouts).toEqual({ stats: 'large' })
    expect(App.SaveTileLayouts).toHaveBeenLastCalledWith({ stats: 'large' })

    await useTileStore.getState().setLayout('stats', 'default')
    expect(useTileStore.getState().layouts).toEqual({})
    expect(App.SaveTileLayouts).toHaveBeenLastCalledWith({})
  })

  it('reverts and records the reason when the bridge refuses the write', async () => {
    attachBridge()
    useTileStore.setState({ layouts: { stats: 'compact' } })
    vi.mocked(App.SaveTileLayouts).mockRejectedValue(new Error('disk full'))
    await expect(useTileStore.getState().setLayout('stats', 'large')).rejects.toThrow('disk full')
    expect(useTileStore.getState().layouts).toEqual({ stats: 'compact' })
    expect(useTileStore.getState().error).toBe('disk full')
  })

  it('keeps the optimistic value with no bridge to persist to', async () => {
    vi.mocked(App.SaveTileLayouts).mockRejectedValue(new Error('no wails bridge'))
    await useTileStore.getState().setLayout('stats', 'large')
    expect(useTileStore.getState().layouts).toEqual({ stats: 'large' })
  })
})
