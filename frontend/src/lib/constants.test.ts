import { describe, it, expect } from 'vitest'
import type { LayoutItem } from 'react-grid-layout'
import { DEFAULT_LAYOUT_PRESETS, COLS } from './constants'
import { TILE_REGISTRY } from '../tiles/registry'
import { TILE_SIZE, TILE_MIN } from './gridSizing'

const KNOWN_IDS = new Set(TILE_REGISTRY.map((t) => t.id))
const KNOWN_SIZES = [TILE_SIZE, TILE_MIN]

function overlaps(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

describe('DEFAULT_LAYOUT_PRESETS', () => {
  for (const preset of DEFAULT_LAYOUT_PRESETS) {
    describe(preset.name, () => {
      const layout: LayoutItem[] = JSON.parse(preset.layout)

      it('references only known tile ids', () => {
        for (const item of layout) {
          expect(KNOWN_IDS.has(item.i)).toBe(true)
        }
      })

      it('uses one of the shared size constants for every tile, uniformly', () => {
        for (const item of layout) {
          const matches = KNOWN_SIZES.some((s) => s.w === item.w && s.h === item.h)
          expect(matches).toBe(true)
        }
        // every item in a single preset shares the same size — uniform sizing
        // means there's no per-tile size decision within a preset either
        const distinctSizes = new Set(layout.map((l) => `${l.w}x${l.h}`))
        expect(distinctSizes.size).toBe(1)
      })

      it('fits within the grid column count', () => {
        for (const item of layout) {
          expect(item.x + item.w).toBeLessThanOrEqual(COLS)
          expect(item.x).toBeGreaterThanOrEqual(0)
        }
      })

      it('has no overlapping tiles', () => {
        for (let i = 0; i < layout.length; i++) {
          for (let j = i + 1; j < layout.length; j++) {
            expect(overlaps(layout[i], layout[j])).toBe(false)
          }
        }
      })

      it('has no duplicate tile ids', () => {
        const ids = layout.map((l) => l.i)
        expect(new Set(ids).size).toBe(ids.length)
      })
    })
  }

  it('Default, Console Focus, and Compact include every registered tile', () => {
    const fullPresets = DEFAULT_LAYOUT_PRESETS.filter((p) => p.name !== 'Essentials')
    for (const preset of fullPresets) {
      const ids = new Set((JSON.parse(preset.layout) as LayoutItem[]).map((l) => l.i))
      expect(ids).toEqual(KNOWN_IDS)
    }
  })

  it('Essentials is a deliberately smaller subset', () => {
    const essentials = DEFAULT_LAYOUT_PRESETS.find((p) => p.name === 'Essentials')!
    const ids = (JSON.parse(essentials.layout) as LayoutItem[]).map((l) => l.i)
    expect(ids.length).toBeLessThan(KNOWN_IDS.size)
  })
})
