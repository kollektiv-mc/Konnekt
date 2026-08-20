import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LayoutItem } from 'react-grid-layout'
import * as App from '../../wailsjs/go/main/App'
import { useLayoutStore } from './useLayoutStore'
import { DEFAULT_LAYOUT_PRESETS } from '../lib/constants'

vi.mock('../../wailsjs/go/main/App')

function layoutStr(id: string): string {
  return JSON.stringify([{ i: id, x: 0, y: 0, w: 1, h: 1 }])
}

// jsdom has no window.go, so `hasWailsBridge()` is false by default — the
// `frontend-dev` preview case. Attach a stub for the real-rejection path.
const attachBridge = () => Object.assign(window, { go: {} })

describe('useLayoutStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Reflect.deleteProperty(window, 'go')
    vi.mocked(App.GetActiveLayout).mockResolvedValue('')
    vi.mocked(App.GetLayoutPresets).mockResolvedValue([])
    vi.mocked(App.SaveActiveLayout).mockResolvedValue(undefined)
    vi.mocked(App.SaveLayoutPreset).mockResolvedValue(undefined)
    vi.mocked(App.DeleteLayoutPreset).mockResolvedValue(undefined)
    useLayoutStore.setState({
      presets: [],
      activePresetName: 'Default',
      currentLayout: [],
      error: null,
    })
  })

  describe('loadPresets', () => {
    it('uses remote presets when present', async () => {
      const remote = [{ name: 'Mine', layout: layoutStr('console') }]
      vi.mocked(App.GetLayoutPresets).mockResolvedValue(remote)
      await useLayoutStore.getState().loadPresets()
      const { presets, activePresetName } = useLayoutStore.getState()
      expect(presets).toEqual(remote)
      expect(activePresetName).toBe('Mine')
      expect(App.SaveLayoutPreset).not.toHaveBeenCalled()
    })

    it('seeds the default presets when the remote list is empty', async () => {
      vi.mocked(App.GetLayoutPresets).mockResolvedValue([])
      await useLayoutStore.getState().loadPresets()
      expect(useLayoutStore.getState().presets).toEqual(DEFAULT_LAYOUT_PRESETS)
      expect(App.SaveLayoutPreset).toHaveBeenCalledTimes(DEFAULT_LAYOUT_PRESETS.length)
      for (const p of DEFAULT_LAYOUT_PRESETS) {
        expect(App.SaveLayoutPreset).toHaveBeenCalledWith(p.name, p.layout)
      }
    })

    it('overrides the starting layout with a saved active layout', async () => {
      const remote = [{ name: 'Mine', layout: layoutStr('console') }]
      vi.mocked(App.GetLayoutPresets).mockResolvedValue(remote)
      vi.mocked(App.GetActiveLayout).mockResolvedValue(layoutStr('worlds'))
      await useLayoutStore.getState().loadPresets()
      expect(useLayoutStore.getState().currentLayout).toEqual([
        { i: 'worlds', x: 0, y: 0, w: 1, h: 1 },
      ])
    })

    it('falls back to the first preset layout when no active layout was saved', async () => {
      const remote = [{ name: 'Mine', layout: layoutStr('console') }]
      vi.mocked(App.GetLayoutPresets).mockResolvedValue(remote)
      vi.mocked(App.GetActiveLayout).mockResolvedValue('')
      await useLayoutStore.getState().loadPresets()
      expect(useLayoutStore.getState().currentLayout).toEqual([
        { i: 'console', x: 0, y: 0, w: 1, h: 1 },
      ])
    })

    it('degrades cleanly when GetLayoutPresets and GetActiveLayout both reject', async () => {
      vi.mocked(App.GetLayoutPresets).mockRejectedValue(new Error('no bridge'))
      vi.mocked(App.GetActiveLayout).mockRejectedValue(new Error('no bridge'))
      await useLayoutStore.getState().loadPresets()
      expect(useLayoutStore.getState().presets).toEqual(DEFAULT_LAYOUT_PRESETS)
      expect(useLayoutStore.getState().activePresetName).toBe('Default')
    })

    it('compacts a gapped saved layout so it matches the (also-compacting) render', async () => {
      // 'b' sits 3 empty rows below 'a' — Dashboard renders with vertical
      // compaction, so the persisted layout must match that on load rather
      // than only after the user's first drag.
      const gapped = JSON.stringify([
        { i: 'a', x: 0, y: 0, w: 2, h: 2 },
        { i: 'b', x: 0, y: 5, w: 2, h: 2 },
      ])
      vi.mocked(App.GetActiveLayout).mockResolvedValue(gapped)
      await useLayoutStore.getState().loadPresets()
      expect(useLayoutStore.getState().currentLayout).toEqual([
        { i: 'a', x: 0, y: 0, w: 2, h: 2 },
        { i: 'b', x: 0, y: 2, w: 2, h: 2 },
      ])
    })

    it('passes through entries with a non-finite y unchanged rather than compacting them', async () => {
      // 'stale' has no y at all (JSON can't round-trip NaN/Infinity as
      // numbers — a missing field is the realistic stand-in for corrupt data).
      const withStale = JSON.stringify([
        { i: 'a', x: 0, y: 5, w: 2, h: 2 },
        { i: 'stale', x: 0, w: 2, h: 2 },
      ])
      vi.mocked(App.GetActiveLayout).mockResolvedValue(withStale)
      await useLayoutStore.getState().loadPresets()
      const { currentLayout } = useLayoutStore.getState()
      expect(currentLayout.find((l) => l.i === 'a')).toEqual({ i: 'a', x: 0, y: 0, w: 2, h: 2 })
      expect(currentLayout.find((l) => l.i === 'stale')).toEqual({ i: 'stale', x: 0, w: 2, h: 2 })
    })
  })

  describe('savePreset', () => {
    it('inserts a new preset when the name does not already exist', async () => {
      useLayoutStore.setState({
        presets: [{ name: 'A', layout: layoutStr('a') }],
        currentLayout: [{ i: 'b', x: 0, y: 0, w: 1, h: 1 } as LayoutItem],
      })
      await useLayoutStore.getState().savePreset('B')
      const { presets, activePresetName } = useLayoutStore.getState()
      expect(presets.map((p) => p.name)).toEqual(['A', 'B'])
      expect(activePresetName).toBe('B')
      expect(App.SaveLayoutPreset).toHaveBeenCalledWith('B', layoutStr('b'))
    })

    it('updates an existing preset in place when the name matches', async () => {
      useLayoutStore.setState({
        presets: [
          { name: 'A', layout: layoutStr('a') },
          { name: 'B', layout: layoutStr('b') },
        ],
        currentLayout: [{ i: 'z', x: 0, y: 0, w: 1, h: 1 } as LayoutItem],
      })
      await useLayoutStore.getState().savePreset('A')
      const { presets } = useLayoutStore.getState()
      expect(presets).toEqual([
        { name: 'A', layout: layoutStr('z') },
        { name: 'B', layout: layoutStr('b') },
      ])
    })

    it('does not list the preset and records the error when the backend rejects', async () => {
      attachBridge()
      useLayoutStore.setState({
        presets: [{ name: 'A', layout: layoutStr('a') }],
        activePresetName: 'A',
        currentLayout: [{ i: 'b', x: 0, y: 0, w: 1, h: 1 } as LayoutItem],
      })
      vi.mocked(App.SaveLayoutPreset).mockRejectedValue(new Error('disk full'))
      await expect(useLayoutStore.getState().savePreset('B')).rejects.toThrow('disk full')
      const { presets, activePresetName, error } = useLayoutStore.getState()
      expect(presets.map((p) => p.name)).toEqual(['A'])
      expect(activePresetName).toBe('A')
      expect(error).toBe('disk full')
    })

    it('still lists the preset when there is no Wails bridge to save to', async () => {
      useLayoutStore.setState({
        presets: [],
        currentLayout: [{ i: 'b', x: 0, y: 0, w: 1, h: 1 } as LayoutItem],
      })
      vi.mocked(App.SaveLayoutPreset).mockRejectedValue(new Error('no wails bridge'))
      await useLayoutStore.getState().savePreset('B')
      expect(useLayoutStore.getState().presets.map((p) => p.name)).toEqual(['B'])
      expect(useLayoutStore.getState().error).toBeNull()
    })
  })

  describe('loadPreset', () => {
    it('is a no-op for an unknown preset name', () => {
      useLayoutStore.setState({
        presets: [{ name: 'A', layout: layoutStr('a') }],
        activePresetName: 'A',
        currentLayout: [],
      })
      useLayoutStore.getState().loadPreset('Missing')
      expect(useLayoutStore.getState().activePresetName).toBe('A')
      expect(App.SaveActiveLayout).not.toHaveBeenCalled()
    })

    it('parses the preset layout, sets it active, and persists it', () => {
      useLayoutStore.setState({
        presets: [{ name: 'A', layout: layoutStr('a') }],
        activePresetName: 'Default',
        currentLayout: [],
      })
      useLayoutStore.getState().loadPreset('A')
      expect(useLayoutStore.getState().activePresetName).toBe('A')
      expect(useLayoutStore.getState().currentLayout).toEqual([{ i: 'a', x: 0, y: 0, w: 1, h: 1 }])
      expect(App.SaveActiveLayout).toHaveBeenCalledWith(layoutStr('a'))
    })
  })

  describe('deletePreset', () => {
    it('removes the preset by name and persists the deletion', async () => {
      useLayoutStore.setState({
        presets: [
          { name: 'A', layout: layoutStr('a') },
          { name: 'B', layout: layoutStr('b') },
        ],
        activePresetName: 'B',
      })
      await useLayoutStore.getState().deletePreset('A')
      expect(useLayoutStore.getState().presets.map((p) => p.name)).toEqual(['B'])
      expect(App.DeleteLayoutPreset).toHaveBeenCalledWith('A')
      // deleting a non-active preset leaves activePresetName untouched
      expect(useLayoutStore.getState().activePresetName).toBe('B')
    })

    it('reassigns activePresetName to the first remaining preset when the active one is deleted', async () => {
      useLayoutStore.setState({
        presets: [
          { name: 'A', layout: layoutStr('a') },
          { name: 'B', layout: layoutStr('b') },
        ],
        activePresetName: 'A',
      })
      await useLayoutStore.getState().deletePreset('A')
      expect(useLayoutStore.getState().activePresetName).toBe('B')
    })

    it('reassigns activePresetName to empty when the last preset is deleted', async () => {
      useLayoutStore.setState({
        presets: [{ name: 'A', layout: layoutStr('a') }],
        activePresetName: 'A',
      })
      await useLayoutStore.getState().deletePreset('A')
      expect(useLayoutStore.getState().activePresetName).toBe('')
    })

    it('keeps the preset listed and records the error when the backend rejects', async () => {
      attachBridge()
      useLayoutStore.setState({
        presets: [
          { name: 'A', layout: layoutStr('a') },
          { name: 'B', layout: layoutStr('b') },
        ],
        activePresetName: 'A',
      })
      vi.mocked(App.DeleteLayoutPreset).mockRejectedValue(new Error('file in use'))
      await expect(useLayoutStore.getState().deletePreset('A')).rejects.toThrow('file in use')
      expect(useLayoutStore.getState().presets.map((p) => p.name)).toEqual(['A', 'B'])
      expect(useLayoutStore.getState().activePresetName).toBe('A')
      expect(useLayoutStore.getState().error).toBe('file in use')
    })
  })

  describe('updateLayout', () => {
    it('sets currentLayout and persists it', () => {
      const layout = [{ i: 'x', x: 0, y: 0, w: 1, h: 1 } as LayoutItem]
      useLayoutStore.getState().updateLayout(layout)
      expect(useLayoutStore.getState().currentLayout).toEqual(layout)
      expect(App.SaveActiveLayout).toHaveBeenCalledWith(JSON.stringify(layout))
    })

    it('still updates currentLayout without throwing when the binding throws synchronously', () => {
      // The generated Wails binding dereferences window.go eagerly, so it
      // throws synchronously (not a rejected promise) when window.go is
      // undefined, e.g. outside the packaged app.
      vi.mocked(App.SaveActiveLayout).mockImplementation(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'main')")
      })
      const layout = [{ i: 'y', x: 0, y: 0, w: 1, h: 1 } as LayoutItem]
      expect(() => useLayoutStore.getState().updateLayout(layout)).not.toThrow()
      expect(useLayoutStore.getState().currentLayout).toEqual(layout)
    })

    // Records rather than reverts: the layout on screen is what the user just
    // arranged by hand, and react-grid-layout drives this from a drag callback
    // that cannot await, so there is nothing to roll back into.
    it('keeps the arranged layout and records the error when the backend rejects', async () => {
      attachBridge()
      vi.mocked(App.SaveActiveLayout).mockRejectedValue(new Error('disk full'))
      const layout = [{ i: 'z', x: 0, y: 0, w: 1, h: 1 } as LayoutItem]
      useLayoutStore.getState().updateLayout(layout)
      expect(useLayoutStore.getState().currentLayout).toEqual(layout)
      await vi.waitFor(() => expect(useLayoutStore.getState().error).toBe('disk full'))
    })
  })
})
