import { describe, it, expect } from 'vitest'
import { fitItems, gridCapacity } from './useGridFit'

describe('gridCapacity', () => {
  it('counts whole rows only', () => {
    // 3 rows of 24 with 4 between take 80; 79 leaves room for two.
    expect(gridCapacity({ columns: 3, rowHeight: 24, gap: 4, height: 80 })).toBe(9)
    expect(gridCapacity({ columns: 3, rowHeight: 24, gap: 4, height: 79 })).toBe(6)
  })

  it('is zero before a row has a height', () => {
    expect(gridCapacity({ columns: 3, rowHeight: 0, gap: 4, height: 200 })).toBe(0)
  })
})

describe('fitItems', () => {
  const items = ['a', 'b', 'c', 'd', 'e']

  it('shows everything that fits', () => {
    expect(fitItems(items, 5)).toEqual({ shown: items, more: 0 })
  })

  it('gives the last slot to the count of the rest', () => {
    expect(fitItems(items, 3)).toEqual({ shown: ['a', 'b'], more: 3 })
  })

  it('shows everything when nothing was measured', () => {
    expect(fitItems(items, null)).toEqual({ shown: items, more: 0 })
  })
})
