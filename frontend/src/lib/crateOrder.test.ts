import { describe, it, expect } from 'vitest'
import { normalizeCrateOrder, reorderWithinGroup } from './crateOrder'
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
