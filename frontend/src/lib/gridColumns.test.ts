import { describe, expect, it } from 'vitest'
import { COMMAND_GRID, columnsFor } from './gridColumns'

// The default Commands tile's body, near enough.
const TILE = { width: 360, height: 330 }
const WIDE = { width: 800, height: 330 }

describe('columnsFor', () => {
  it('fills the tile with one command, stacks two, and goes two by two from three', () => {
    expect(columnsFor(1, TILE, COMMAND_GRID)).toBe(1)
    expect(columnsFor(2, TILE, COMMAND_GRID)).toBe(1)
    expect(columnsFor(3, TILE, COMMAND_GRID)).toBe(2)
    expect(columnsFor(4, TILE, COMMAND_GRID)).toBe(2)
    expect(columnsFor(6, TILE, COMMAND_GRID)).toBe(2)
  })

  it('adds rows, not narrower columns, once the tile is at its column floor', () => {
    // The default tile fits two label-wide columns; a longer list scrolls.
    expect(columnsFor(12, TILE, COMMAND_GRID)).toBe(2)
    expect(columnsFor(24, TILE, COMMAND_GRID)).toBe(2)
    expect(columnsFor(12, { width: 600, height: 330 }, COMMAND_GRID)).toBe(4)
  })

  it('spreads into more columns on a wider tile', () => {
    expect(columnsFor(2, WIDE, COMMAND_GRID)).toBe(2)
    expect(columnsFor(6, WIDE, COMMAND_GRID)).toBe(3)
  })

  it('never offers a column narrower than a label needs', () => {
    expect(columnsFor(20, { width: 150, height: 330 }, COMMAND_GRID)).toBe(1)
    expect(columnsFor(20, { width: 270, height: 330 }, COMMAND_GRID)).toBe(2)
  })

  it('stays within the column cap', () => {
    expect(columnsFor(40, { width: 3000, height: 200 }, COMMAND_GRID)).toBe(COMMAND_GRID.maxColumns)
  })
})
