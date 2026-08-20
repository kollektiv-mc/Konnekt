import { create } from 'zustand'
import { errMsg, hasWailsBridge } from '../lib/ipc'
import { GetActiveTiles, SaveActiveTiles } from '../../wailsjs/go/main/App'

interface TileStore {
  activeTileIds: string[]
  error: string | null
  loadTiles: () => Promise<void>
  addTile: (id: string) => Promise<void>
  removeTile: (id: string) => Promise<void>
  clearError: () => void
}

export const useTileStore = create<TileStore>((set, get) => ({
  activeTileIds: [],
  error: null,

  clearError: () => set({ error: null }),

  loadTiles: async () => {
    let saved: string[] = []
    try {
      saved = await GetActiveTiles()
    } catch {
      /* Wails IPC unavailable */
    }
    const active = saved.length > 0 ? saved : ['console', 'stats', 'players', 'quick-commands']
    set({ activeTileIds: active })
  },

  // Both writes rethrow on a real failure and leave `activeTileIds` alone, so
  // the canvas keeps matching what is on disk. Dashboard pairs each call with a
  // layout write; letting the two disagree is how a tile ends up holding a grid
  // slot it no longer occupies.
  addTile: async (id: string) => {
    const { activeTileIds } = get()
    if (activeTileIds.includes(id)) return
    const next = [...activeTileIds, id]
    set({ error: null })
    try {
      await SaveActiveTiles(next)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to. */
    }
    set({ activeTileIds: next })
  },

  removeTile: async (id: string) => {
    const { activeTileIds } = get()
    const next = activeTileIds.filter((a) => a !== id)
    set({ error: null })
    try {
      await SaveActiveTiles(next)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to. */
    }
    set({ activeTileIds: next })
  },
}))
