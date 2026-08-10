import { describe, it, expect } from 'vitest'
import { TILE_REGISTRY } from './registry'

describe('TILE_REGISTRY', () => {
  it('has no duplicate ids', () => {
    const ids = TILE_REGISTRY.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
