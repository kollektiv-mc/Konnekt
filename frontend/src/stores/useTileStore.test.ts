import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useTileStore } from './useTileStore'

vi.mock('../../wailsjs/go/main/App')

const DEFAULT_ACTIVE = ['console', 'stats', 'players', 'quick-commands']

describe('useTileStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTileStore.setState({ activeTileIds: [] })
  })

  describe('loadTiles', () => {
    it('uses the saved active list when present', async () => {
      vi.mocked(App.GetActiveTiles).mockResolvedValue(['console', 'worlds'])
      await useTileStore.getState().loadTiles()
      expect(useTileStore.getState().activeTileIds).toEqual(['console', 'worlds'])
    })

    it('falls back to the 4 default tiles when the saved list is empty', async () => {
      vi.mocked(App.GetActiveTiles).mockResolvedValue([])
      await useTileStore.getState().loadTiles()
      expect(useTileStore.getState().activeTileIds).toEqual(DEFAULT_ACTIVE)
    })

    it('falls back to the 4 default tiles when GetActiveTiles rejects', async () => {
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
  })

  describe('removeTile', () => {
    it('removes the tile from the active list and persists', async () => {
      useTileStore.setState({ activeTileIds: ['console', 'worlds'] })
      await useTileStore.getState().removeTile('console')
      expect(useTileStore.getState().activeTileIds).toEqual(['worlds'])
      expect(App.SaveActiveTiles).toHaveBeenCalledWith(['worlds'])
    })
  })
})
