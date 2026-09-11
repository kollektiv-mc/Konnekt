import { describe, expect, it } from 'vitest'
import { moveForSlot, slotAt, type Box } from './sortable'

const row = (y: number): Box => ({ x: 0, y, width: 200, height: 20 })
const column = [row(0), row(24), row(48)]

describe('slotAt on a column', () => {
  it('splits each row at its midpoint and allows a drop past the end', () => {
    expect(slotAt(column, { x: 10, y: 5 }, 'y')).toBe(0)
    expect(slotAt(column, { x: 10, y: 15 }, 'y')).toBe(1)
    expect(slotAt(column, { x: 10, y: 30 }, 'y')).toBe(1)
    expect(slotAt(column, { x: 10, y: 40 }, 'y')).toBe(2)
    // Below the last midpoint is after everything, which the old drop-on-a-row
    // implementation could not say.
    expect(slotAt(column, { x: 10, y: 100 }, 'y')).toBe(3)
  })

  it('has one slot for nothing', () => {
    expect(slotAt([], { x: 0, y: 0 }, 'y')).toBe(0)
  })
})

describe('slotAt on a grid', () => {
  // Two columns, two lines: [0 1] / [2 3].
  const grid: Box[] = [
    { x: 0, y: 0, width: 100, height: 20 },
    { x: 110, y: 0, width: 100, height: 20 },
    { x: 0, y: 30, width: 100, height: 20 },
    { x: 110, y: 30, width: 100, height: 20 },
  ]

  it('reads left to right on a line and top to bottom between lines', () => {
    expect(slotAt(grid, { x: 20, y: 10 }, 'grid')).toBe(0)
    expect(slotAt(grid, { x: 90, y: 10 }, 'grid')).toBe(1)
    expect(slotAt(grid, { x: 130, y: 10 }, 'grid')).toBe(1)
    expect(slotAt(grid, { x: 200, y: 10 }, 'grid')).toBe(2)
    expect(slotAt(grid, { x: 20, y: 40 }, 'grid')).toBe(2)
    expect(slotAt(grid, { x: 200, y: 45 }, 'grid')).toBe(4)
  })

  it('uses the vertical midpoint when the pointer is in the gap between lines', () => {
    // In the gutter above the second line, nearest the third cell: above its
    // midpoint, so before it.
    expect(slotAt(grid, { x: 20, y: 26 }, 'grid')).toBe(2)
  })
})

describe('moveForSlot', () => {
  it('is a no-op for the two slots that surround the row', () => {
    expect(moveForSlot(1, 1)).toBeNull()
    expect(moveForSlot(1, 2)).toBeNull()
  })

  it('accounts for the row leaving its place first', () => {
    // Moving row 0 to slot 3 (after three rows) is arrayMove(0, 2).
    expect(moveForSlot(0, 3)).toBe(2)
    expect(moveForSlot(2, 0)).toBe(0)
    expect(moveForSlot(0, 2)).toBe(1)
  })
})
