import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useTileStore } from './useTileStore'
import { ALL_TILE_IDS } from '../lib/constants'

vi.mock('../../wailsjs/go/main/App')

// A fresh install opens on the full board (see useTileStore.loadTiles).
const DEFAULT_ACTIVE = [...ALL_TILE_IDS]

// jsdom has no window.go, so `hasWailsBridge()` is false by default — the
// `frontend-dev` preview case. Attach a stub for the real-rejection path.
const attachBridge = () => Object.assign(window, { go: {} })

describe('useTileStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks() resets calls, not implementations, so a rejection armed by
    // one test would still be armed in the next.
    vi.mocked(App.SaveActiveTiles).mockResolvedValue(undefined)
    Reflect.deleteProperty(window, 'go')
    useTileStore.setState({ activeTileIds: [], error: null })
  })

  describe('loadTiles', () => {
    it('uses the saved active list when present', async () => {
      vi.mocked(App.GetActiveTiles).mockResolvedValue(['console', 'worlds'])
      await useTileStore.getState().loadTiles()
      expect(useTileStore.getState().activeTileIds).toEqual(['console', 'worlds'])
    })

    it('falls back to the full tile set when the saved list is empty', async () => {
      vi.mocked(App.GetActiveTiles).mockResolvedValue([])
      await useTileStore.getState().loadTiles()
      expect(useTileStore.getState().activeTileIds).toEqual(DEFAULT_ACTIVE)
    })

    it('falls back to the full tile set when GetActiveTiles rejects', async () => {
      vi.mocked(App.GetActiveTiles).mockRejectedValue(new Error('no wails bridge'))
      await useTileStore.getState().loadTiles()
      expect(useTileStore.getState().activeTileIds).toEqual(DEFAULT_ACTIVE)
    })
  })

  describe('addTile', () => {
    it('is a no-op when the tile is already active', async () => {
      useTileStore.setState({ activeTileIds: ['console'] })
      await useTileStore.getState().addTile('console')
      expect(App.SaveActiveTiles).not.toHaveBeenCalled()
      expect(useTileStore.getState().activeTileIds).toEqual(['console'])
    })

    it('appends a new tile and persists it', async () => {
      useTileStore.setState({ activeTileIds: ['console'] })
      await useTileStore.getState().addTile('worlds')
      expect(useTileStore.getState().activeTileIds).toEqual(['console', 'worlds'])
      expect(App.SaveActiveTiles).toHaveBeenCalledWith(['console', 'worlds'])
    })

    // Dashboard writes the tile's grid slot only after this resolves, so a tile
    // that was refused must not appear active — otherwise the persisted layout
    // holds a slot for a tile that is gone at the next start.
    it('leaves the active list alone and records the error when the backend rejects', async () => {
      attachBridge()
      useTileStore.setState({ activeTileIds: ['console'] })
      vi.mocked(App.SaveActiveTiles).mockRejectedValue(new Error('disk full'))
      await expect(useTileStore.getState().addTile('worlds')).rejects.toThrow('disk full')
      expect(useTileStore.getState().activeTileIds).toEqual(['console'])
      expect(useTileStore.getState().error).toBe('disk full')
    })

    it('still places the tile when there is no Wails bridge to save to', async () => {
      vi.mocked(App.SaveActiveTiles).mockRejectedValue(new Error('no wails bridge'))
      useTileStore.setState({ activeTileIds: ['console'] })
      await useTileStore.getState().addTile('worlds')
      expect(useTileStore.getState().activeTileIds).toEqual(['console', 'worlds'])
      expect(useTileStore.getState().error).toBeNull()
    })
  })

  describe('removeTile', () => {
    it('removes the tile from the active list and persists', async () => {
      useTileStore.setState({ activeTileIds: ['console', 'worlds'] })
      await useTileStore.getState().removeTile('console')
      expect(useTileStore.getState().activeTileIds).toEqual(['worlds'])
      expect(App.SaveActiveTiles).toHaveBeenCalledWith(['worlds'])
    })

    it('keeps the tile on the canvas and records the error when the backend rejects', async () => {
      attachBridge()
      useTileStore.setState({ activeTileIds: ['console', 'worlds'] })
      vi.mocked(App.SaveActiveTiles).mockRejectedValue(new Error('disk full'))
      await expect(useTileStore.getState().removeTile('console')).rejects.toThrow('disk full')
      expect(useTileStore.getState().activeTileIds).toEqual(['console', 'worlds'])
      expect(useTileStore.getState().error).toBe('disk full')
    })
  })
})
