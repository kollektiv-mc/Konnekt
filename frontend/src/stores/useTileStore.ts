import { create } from 'zustand'
import { GetActiveTiles, SaveActiveTiles } from '../../wailsjs/go/main/App'

interface TileStore {
  activeTileIds: string[]
  loadTiles: () => Promise<void>
  addTile: (id: string) => Promise<void>
  removeTile: (id: string) => Promise<void>
}

export const useTileStore = create<TileStore>((set, get) => ({
  activeTileIds: [],

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

  addTile: async (id: string) => {
    const { activeTileIds } = get()
    if (activeTileIds.includes(id)) return
    const next = [...activeTileIds, id]
    try {
      await SaveActiveTiles(next)
    } catch {
      /* best-effort */
    }
    set({ activeTileIds: next })
  },

  removeTile: async (id: string) => {
    const { activeTileIds } = get()
    const next = activeTileIds.filter((a) => a !== id)
    try {
      await SaveActiveTiles(next)
    } catch {
      /* best-effort */
    }
    set({ activeTileIds: next })
  },
}))
