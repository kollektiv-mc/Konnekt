import { describe, it, expect } from 'vitest'
import type { LayoutItem } from 'react-grid-layout'
import { DEFAULT_LAYOUT_PRESETS, COLS } from './constants'
import { TILE_REGISTRY } from '../tiles/registry'
import { TILE_MIN, TILE_MAX, collides } from './gridSizing'

const KNOWN_IDS = new Set(TILE_REGISTRY.map((t) => t.id))

// One screen of a 1080p-class window; see the comment on DEFAULT_LAYOUT_PRESETS.
const SCREEN_ROWS = 18
const CRUCIAL = ['console', 'quick-commands', 'stats', 'performance', 'players']

const ids = (name: string) =>
  (JSON.parse(DEFAULT_LAYOUT_PRESETS.find((p) => p.name === name)!.layout) as LayoutItem[]).map(
    (l) => l.i,
  )

describe('DEFAULT_LAYOUT_PRESETS', () => {
  for (const preset of DEFAULT_LAYOUT_PRESETS) {
    describe(preset.name, () => {
      const layout: LayoutItem[] = JSON.parse(preset.layout)

      it('references only known tile ids', () => {
        for (const item of layout) {
          expect(KNOWN_IDS.has(item.i)).toBe(true)
        }
      })

      it('sizes every tile within the shared min..max resize range', () => {
        for (const item of layout) {
          expect(item.w).toBeGreaterThanOrEqual(TILE_MIN.w)
          expect(item.w).toBeLessThanOrEqual(TILE_MAX.w)
          expect(item.h).toBeGreaterThanOrEqual(TILE_MIN.h)
          expect(item.h).toBeLessThanOrEqual(TILE_MAX.h)
        }
      })

      if (preset.name !== 'Default') {
        it('fits one screen without scrolling', () => {
          for (const item of layout) {
            expect(item.y + item.h).toBeLessThanOrEqual(SCREEN_ROWS)
          }
        })
      }

      it('fits within the grid column count', () => {
        for (const item of layout) {
          expect(item.x + item.w).toBeLessThanOrEqual(COLS)
          expect(item.x).toBeGreaterThanOrEqual(0)
        }
      })

      it('has no overlapping tiles', () => {
        for (let i = 0; i < layout.length; i++) {
          for (let j = i + 1; j < layout.length; j++) {
            expect(collides(layout[i], layout[j])).toBe(false)
          }
        }
      })

      it('has no duplicate tile ids', () => {
        const ids = layout.map((l) => l.i)
        expect(new Set(ids).size).toBe(ids.length)
      })
    })
  }

  it('Default and Compact place every registered tile', () => {
    for (const name of ['Default', 'Compact']) {
      expect(new Set(ids(name))).toEqual(KNOWN_IDS)
    }
  })

  it('Essentials holds the crucial tiles and nothing else', () => {
    expect(new Set(ids('Essentials'))).toEqual(new Set([...CRUCIAL, 'notifications']))
  })

  it('Console Focus gives the console most of the board', () => {
    const layout: LayoutItem[] = JSON.parse(
      DEFAULT_LAYOUT_PRESETS.find((p) => p.name === 'Console Focus')!.layout,
    )
    const log = layout.find((l) => l.i === 'console')!
    expect(log.w * log.h).toBeGreaterThan((COLS * SCREEN_ROWS) / 2)
    expect(layout.length).toBeLessThan(KNOWN_IDS.size / 2)
  })
})
