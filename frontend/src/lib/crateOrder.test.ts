import { describe, it, expect } from 'vitest'
import { dropIndexAt, normalizeCrateOrder, reorderWithinGroup } from './crateOrder'
import { TILE_REGISTRY } from '../tiles/registry'

const ALL_IDS = TILE_REGISTRY.map((t) => t.id)

describe('normalizeCrateOrder', () => {
  it('returns full registry order when given an empty order', () => {
    expect(normalizeCrateOrder([])).toEqual(ALL_IDS)
  })

  it('preserves an already-valid full order unchanged', () => {
    const reversed = [...ALL_IDS].reverse()
    expect(normalizeCrateOrder(reversed)).toEqual(reversed)
  })

  it('drops ids no longer present in the registry', () => {
    const withStale = ['stale-tile', ...ALL_IDS]
    expect(normalizeCrateOrder(withStale)).toEqual(ALL_IDS)
  })

  it('appends newly-registered ids in registry order', () => {
    const withoutLastTwo = ALL_IDS.slice(0, -2)
    const result = normalizeCrateOrder(withoutLastTwo)
    expect(result.slice(0, -2)).toEqual(withoutLastTwo)
    expect(result.slice(-2)).toEqual(ALL_IDS.slice(-2))
  })
})

describe('reorderWithinGroup', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  const groupA = new Set(['a', 'c', 'e'])

  it('moves an id within its group without touching other slots', () => {
    // group sequence is [a, c, e]; move 'e' to index 0 -> [e, a, c]
    const result = reorderWithinGroup(order, groupA, 'e', 0)
    // slots 1 ('b') and 3 ('d') belong to the other group and stay put
    expect(result[1]).toBe('b')
    expect(result[3]).toBe('d')
    expect(result.filter((x) => groupA.has(x))).toEqual(['e', 'a', 'c'])
  })

  it('clamps toIndex below zero', () => {
    const result = reorderWithinGroup(order, groupA, 'e', -5)
    expect(result.filter((x) => groupA.has(x))).toEqual(['e', 'a', 'c'])
  })

  it('clamps toIndex past the end of the group', () => {
    const result = reorderWithinGroup(order, groupA, 'a', 99)
    expect(result.filter((x) => groupA.has(x))).toEqual(['c', 'e', 'a'])
  })

  it('is a no-op when the id is already at the target index', () => {
    expect(reorderWithinGroup(order, groupA, 'a', 0)).toEqual(order)
  })
})

describe('dropIndexAt', () => {
  // Three 20px rows starting at y=0, laid out with no gap between them, so
  // midpoints fall at 10, 30 and 50.
  const rows = [
    { top: 0, height: 20 },
    { top: 20, height: 20 },
    { top: 40, height: 20 },
  ]

  it('points above the first row when the pointer is over its top half', () => {
    expect(dropIndexAt(rows, 0)).toBe(0)
    expect(dropIndexAt(rows, 9)).toBe(0)
  })

  // The flip happens at the midpoint, not at the boundary between rows: that
  // is what makes the marker move when the row it would displace is half
  // covered, rather than only once the pointer has fully left it.
  it('flips at a row midpoint', () => {
    expect(dropIndexAt(rows, 10)).toBe(0)
    expect(dropIndexAt(rows, 11)).toBe(1)
    expect(dropIndexAt(rows, 30)).toBe(1)
    expect(dropIndexAt(rows, 31)).toBe(2)
  })

  it('points below the last row once the pointer is past its midpoint', () => {
    expect(dropIndexAt(rows, 51)).toBe(3)
    expect(dropIndexAt(rows, 4000)).toBe(3)
  })

  it('returns 0 for an empty group, the only gap it has', () => {
    expect(dropIndexAt([], 42)).toBe(0)
  })

  // An unmeasurable row cannot say which side of it the pointer is on, so it
  // counts as passed and the index stays aligned with the row list.
  it('treats an unmeasurable row as passed', () => {
    expect(dropIndexAt([null, rows[1]], 0)).toBe(1)
    expect(dropIndexAt([null, null], 0)).toBe(2)
  })

  // The index is a `toIndex` for reorderWithinGroup, so it has to be a real
  // slot in the group for every pointer position.
  it('never returns an index the group cannot accept', () => {
    for (const y of [-500, 0, 25, 60, 5000]) {
      const i = dropIndexAt(rows, y)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThanOrEqual(rows.length)
    }
  })
})
