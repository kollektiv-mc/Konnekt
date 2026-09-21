import { create } from 'zustand'
import { errMsg, hasWailsBridge } from '../lib/ipc'
import { ALL_TILE_IDS } from '../lib/constants'
import {
  GetActiveTiles,
  GetTileLayouts,
  SaveActiveTiles,
  SaveTileLayouts,
} from '../../wailsjs/go/main/App'
import { isTileLayout, type TileLayout } from '../types'

interface TileStore {
  activeTileIds: string[]
  /** Per-tile in-tile layout, keyed by tile id. A tile not listed is on `default`. */
  layouts: Record<string, TileLayout>
  error: string | null
  loadTiles: () => Promise<void>
  addTile: (id: string) => Promise<void>
  removeTile: (id: string) => Promise<void>
  setLayout: (id: string, layout: TileLayout) => Promise<void>
  clearError: () => void
}

/** Drops anything in a saved file that is not a layout the app knows. */
export function readTileLayouts(
  raw: Record<string, string> | null | undefined,
): Record<string, TileLayout> {
  const layouts: Record<string, TileLayout> = {}
  for (const [id, layout] of Object.entries(raw ?? {})) {
    if (isTileLayout(layout) && layout !== 'default') layouts[id] = layout
  }
  return layouts
}

export const useTileStore = create<TileStore>((set, get) => ({
  activeTileIds: [],
  layouts: {},
  error: null,

  clearError: () => set({ error: null }),

  loadTiles: async () => {
    let saved: string[] = []
    let layouts: Record<string, TileLayout> = {}
    try {
      saved = await GetActiveTiles()
      layouts = readTileLayouts(await GetTileLayouts())
    } catch {
      /* Wails IPC unavailable */
    }
    // A fresh install opens on the full board, matching the 'Default' preset
    // in lib/constants.ts — which positions every tile, so seeding a smaller
    // set here would leave most of that preset unrendered (Dashboard's
    // mergedLayout filters the layout by activeTileIds).
    const active = saved.length > 0 ? saved : [...ALL_TILE_IDS]
    set({ activeTileIds: active, layouts })
  },

  // Optimistic, like a settings write: the face changes under the menu at
  // once, and a refused write puts it back and records why. `default` is the
  // absence of an entry, so choosing it deletes the key rather than storing
  // the word.
  setLayout: async (id: string, layout: TileLayout) => {
    const previous = get().layouts
    const next = { ...previous }
    if (layout === 'default') delete next[id]
    else next[id] = layout
    set({ layouts: next, error: null })
    try {
      await SaveTileLayouts(next)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ layouts: previous, error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to. */
    }
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
