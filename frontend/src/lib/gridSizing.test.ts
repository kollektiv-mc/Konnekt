import { describe, it, expect } from 'vitest'
import type { LayoutItem } from 'react-grid-layout'
import { GRID_COMPACTOR, TILE_SIZE, TILE_MIN, TILE_MAX, collides, withGhost } from './gridSizing'
import { COLS } from './constants'

const GHOST = '__ghost__'
const tile = (
  i: string,
  x: number,
  y: number,
  w: number = TILE_SIZE.w,
  h: number = TILE_SIZE.h,
): LayoutItem => ({ i, x, y, w, h })
const at = (layout: LayoutItem[], i: string) => {
  const found = layout.find((l) => l.i === i)
  if (!found) throw new Error(`no item ${i}`)
  return { x: found.x, y: found.y }
}
const anyOverlap = (layout: LayoutItem[]) =>
  layout.some((a, i) => layout.slice(i + 1).some((b) => collides(a, b)))

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

describe('collides', () => {
  it('detects overlap and ignores touching edges', () => {
    expect(collides(tile('a', 0, 0), tile('b', 1, 0))).toBe(true)
    expect(collides(tile('a', 0, 0), tile('b', 3, 0))).toBe(false)
    expect(collides(tile('a', 0, 0), tile('b', 0, 8))).toBe(false)
    expect(collides(tile('a', 0, 0), tile('b', 2, 7))).toBe(true)
  })
})

describe('withGhost', () => {
  // The regression this exists for: a tile straddling the middle columns used
  // to make the whole right of its row unreachable from the crate — the ghost
  // was shoved below it instead of displacing it.
  it('claims the hovered cell and pushes a straddling tile out of the way', () => {
    const board = [tile('performance', 1, 0), tile('other', 3, 8)]
    const result = withGhost(board, tile(GHOST, 3, 0), COLS)

    expect(at(result, GHOST)).toEqual({ x: 3, y: 0 })
    expect(at(result, 'performance')).toEqual({ x: 1, y: 8 })
    expect(anyOverlap(result)).toBe(false)
  })

  it('displaces an exact occupant rather than yielding to it', () => {
    const result = withGhost([tile('console', 0, 0)], tile(GHOST, 0, 0), COLS)

    expect(at(result, GHOST)).toEqual({ x: 0, y: 0 })
    expect(at(result, 'console')).toEqual({ x: 0, y: 8 })
  })

  it('leaves a free cell — and the rest of the board — untouched', () => {
    const board = [tile('console', 0, 0)]
    const result = withGhost(board, tile(GHOST, 3, 0), COLS)

    expect(at(result, GHOST)).toEqual({ x: 3, y: 0 })
    expect(at(result, 'console')).toEqual({ x: 0, y: 0 })
  })

  it('keeps the hovered column no matter how the board is packed', () => {
    const board = [tile('a', 0, 0, COLS, 8), tile('b', 0, 8, COLS, 8)]
    for (const x of [0, 1, 2, COLS - TILE_SIZE.w]) {
      const result = withGhost(board, tile(GHOST, x, 8), COLS)
      expect(at(result, GHOST).x).toBe(x)
      // vertical compaction may float the ghost up, but never sink it below
      // the row the pointer is over
      expect(at(result, GHOST).y).toBeLessThanOrEqual(8)
      expect(anyOverlap(result)).toBe(false)
    }
  })

  // Dashboard hands this result straight to <GridLayout>, which compacts it
  // again internally for display. That second pass has to be a no-op, or what
  // the on-drop commit persists would differ from what was on screen.
  it('survives the second compaction react-grid-layout runs internally', () => {
    const board = [tile('a', 1, 0), tile('b', 3, 8), tile('c', 0, 16)]
    const preview = withGhost(board, tile(GHOST, 3, 0), COLS)
    const recompacted = GRID_COMPACTOR.compact(preview, COLS)

    expect(recompacted.map((l) => [l.i, l.x, l.y])).toEqual(preview.map((l) => [l.i, l.x, l.y]))
  })
})
