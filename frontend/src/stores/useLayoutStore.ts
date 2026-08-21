import { create } from 'zustand'
import type { LayoutItem } from 'react-grid-layout'
import type { LayoutPreset } from '../types'
import { DEFAULT_LAYOUT_PRESETS, COLS } from '../lib/constants'
import { GRID_COMPACTOR } from '../lib/gridSizing'
import { errMsg, hasWailsBridge } from '../lib/ipc'
import {
  GetLayoutPresets,
  SaveLayoutPreset,
  DeleteLayoutPreset,
  GetActiveLayout,
  SaveActiveLayout,
} from '../../wailsjs/go/main/App'

// Dashboard renders with vertical compaction; a layout loaded straight from
// disk or a preset can carry gaps that don't match what's actually on
// screen. Compacting once here — rather than waiting for the user's first
// drag to write back a compacted value — keeps the persisted layout in sync
// with the render from the start. Entries with a non-finite `y` (e.g.
// stale/corrupt data) are passed through unchanged rather than fed to the
// compactor.
//
// The compactor clones items via its own internal cloneLayoutItem, which
// fills in every optional LayoutItem field (static, moved, resizeHandles,
// ...) even when unset. Reduced back to the core i/x/y/w/h fields here so
// that noise doesn't leak into what gets persisted — minW/minH/maxW/maxH in
// particular are re-derived from the shared size constants on every render
// (see Dashboard's mergedLayout) and must never be the persisted source of
// truth.
function compacted(layout: readonly LayoutItem[]): LayoutItem[] {
  const valid = layout.filter((l) => isFinite(l.y))
  const invalid = layout.filter((l) => !isFinite(l.y))
  const packed = GRID_COMPACTOR.compact(valid, COLS).map(({ i, x, y, w, h }): LayoutItem => ({
    i,
    x,
    y,
    w,
    h,
  }))
  return [...packed, ...invalid]
}

// Persist the current on-screen layout independently of named presets, so
// drags/resizes/removals survive a restart without overwriting the templates.
//
// Records the failure rather than rethrowing: the only callers are `loadPreset`
// and `updateLayout`, both of which return void because react-grid-layout drives
// them from a drag/resize callback that cannot await. There is nothing to revert
// either — the layout on screen is what the user just arranged by hand, and
// snapping it back under them would be worse than a stale file.
// Stays `async` with the call inside the `try`: with no bridge the generated
// binding throws synchronously rather than rejecting, so a bare `.catch()` on
// the returned promise would never see it.
async function persistActiveLayout(
  set: (partial: Partial<LayoutStore>) => void,
  layout: readonly LayoutItem[],
) {
  try {
    await SaveActiveLayout(JSON.stringify(layout))
  } catch (e) {
    if (hasWailsBridge()) set({ error: errMsg(e) })
    /* No bridge: nothing to persist to. */
  }
}

interface LayoutStore {
  presets: LayoutPreset[]
  activePresetName: string
  currentLayout: LayoutItem[]
  error: string | null
  loadPresets: () => Promise<void>
  savePreset: (name: string) => Promise<void>
  loadPreset: (name: string) => void
  deletePreset: (name: string) => Promise<void>
  updateLayout: (layout: readonly LayoutItem[]) => void
  clearError: () => void
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  presets: [],
  activePresetName: 'Default',
  currentLayout: [],
  error: null,

  loadPresets: async () => {
    let remote: LayoutPreset[] = []
    try {
      remote = (await GetLayoutPresets()) ?? []
    } catch {
      /* Wails IPC unavailable */
    }
    let presets: LayoutPreset[] = remote

    if (presets.length === 0) {
      for (const p of DEFAULT_LAYOUT_PRESETS) {
        try {
          await SaveLayoutPreset(p.name, p.layout)
        } catch {
          // Not the swallowed-write bug the other actions had: this seeds the
          // built-in presets on first run, and they are a compile-time constant
          // rather than anything the user typed. A failure costs nothing that
          // is not still in `DEFAULT_LAYOUT_PRESETS` and re-seeded next launch,
          // so there is no state to revert and nothing to report.
        }
      }
      presets = DEFAULT_LAYOUT_PRESETS
    }

    // Restore the last working layout if one was saved; otherwise fall back to
    // the first preset as the starting arrangement.
    const active = presets[0]
    let layout: LayoutItem[] = active ? JSON.parse(active.layout) : []
    try {
      const saved = await GetActiveLayout()
      if (saved) layout = JSON.parse(saved)
    } catch {
      /* Wails IPC unavailable */
    }

    set({ presets, activePresetName: active?.name ?? 'Default', currentLayout: compacted(layout) })
  },

  savePreset: async (name: string) => {
    const { currentLayout } = get()
    const layoutStr = JSON.stringify(currentLayout)
    set({ error: null })
    try {
      await SaveLayoutPreset(name, layoutStr)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to. */
    }
    const updated: LayoutPreset = { name, layout: layoutStr }
    set((s) => {
      const idx = s.presets.findIndex((p) => p.name === name)
      const presets =
        idx >= 0 ? s.presets.map((p, i) => (i === idx ? updated : p)) : [...s.presets, updated]
      return { presets, activePresetName: name }
    })
  },

  loadPreset: (name: string) => {
    const { presets } = get()
    const preset = presets.find((p) => p.name === name)
    if (!preset) return
    const layout = compacted(JSON.parse(preset.layout))
    set({ activePresetName: name, currentLayout: layout })
    persistActiveLayout(set, layout)
  },

  deletePreset: async (name: string) => {
    set({ error: null })
    try {
      await DeleteLayoutPreset(name)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to. */
    }
    set((s) => {
      const presets = s.presets.filter((p) => p.name !== name)
      return {
        presets,
        // Read the *filtered* list's first entry — reading s.presets[0] here
        // would reassign back to the just-deleted name whenever it happened
        // to be first, leaving no preset matching activePresetName in the UI.
        activePresetName:
          s.activePresetName === name ? (presets[0]?.name ?? '') : s.activePresetName,
      }
    })
  },

  updateLayout: (layout: readonly LayoutItem[]) => {
    set({ currentLayout: layout as LayoutItem[] })
    persistActiveLayout(set, layout)
  },

  clearError: () => set({ error: null }),
}))
