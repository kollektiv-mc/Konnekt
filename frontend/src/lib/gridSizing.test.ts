import { describe, it, expect } from 'vitest'
import { TILE_SIZE, TILE_MIN, TILE_MAX } from './gridSizing'
import { COLS } from './constants'

describe('uniform tile size constants', () => {
  it('orders min <= default <= max on both axes', () => {
    expect(TILE_MIN.w).toBeLessThanOrEqual(TILE_SIZE.w)
    expect(TILE_SIZE.w).toBeLessThanOrEqual(TILE_MAX.w)
    expect(TILE_MIN.h).toBeLessThanOrEqual(TILE_SIZE.h)
    expect(TILE_SIZE.h).toBeLessThanOrEqual(TILE_MAX.h)
  })

  it('fits the default and min width within the grid column count', () => {
    expect(TILE_SIZE.w).toBeLessThanOrEqual(COLS)
    expect(TILE_MIN.w).toBeLessThanOrEqual(COLS)
  })

  it('keeps every dimension positive', () => {
    expect(TILE_MIN.w).toBeGreaterThan(0)
    expect(TILE_MIN.h).toBeGreaterThan(0)
  })
})
