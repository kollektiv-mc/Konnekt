import { describe, it, expect } from 'vitest'
import { GRID_DOT_OFFSET, GRID_GAP, SNAP_GRID, snapPoint } from './canvasGrid'

describe('snapPoint', () => {
  it('moves a point to the nearest grid point on each axis', () => {
    expect(snapPoint({ x: 13, y: 47 })).toEqual({ x: 20, y: 40 })
    expect(snapPoint({ x: 9, y: 31 })).toEqual({ x: 0, y: 40 })
  })

  it('leaves a point that is already on the grid where it is', () => {
    expect(snapPoint({ x: 60, y: -120 })).toEqual({ x: 60, y: -120 })
  })

  it('rounds negative coordinates the same way', () => {
    expect(snapPoint({ x: -13, y: -47 })).toEqual({ x: -20, y: -40 })
  })

  it('never returns a negative zero', () => {
    const p = snapPoint({ x: -3, y: -1 })
    expect(Object.is(p.x, 0)).toBe(true)
    expect(Object.is(p.y, 0)).toBe(true)
  })

  it('is idempotent, so snapping twice is the same as once', () => {
    const once = snapPoint({ x: 33.3, y: -71.9 })
    expect(snapPoint(once)).toEqual(once)
  })

  it('takes the gap from the caller', () => {
    expect(snapPoint({ x: 26, y: 14 }, 10)).toEqual({ x: 30, y: 10 })
  })
})

describe('the grid constants', () => {
  it("snap on both axes at the dots' spacing", () => {
    expect(SNAP_GRID).toEqual([GRID_GAP, GRID_GAP])
  })

  it('shift the pattern by half a gap plus half a dot', () => {
    expect(GRID_DOT_OFFSET).toBe(10.5)
  })
})
