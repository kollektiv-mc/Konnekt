import { describe, it, expect } from 'vitest'
import { filterOptions, typeaheadIndex } from './combobox'

const OPTIONS = [
  { value: 'tps', label: 'tps' },
  { value: 'players.count', label: 'players.count' },
  { value: 'players.max', label: 'players.max' },
  { value: 'server.motd', label: 'server.motd' },
]

describe('filterOptions', () => {
  it('returns everything for an empty query', () => {
    expect(filterOptions(OPTIONS, '')).toHaveLength(4)
    expect(filterOptions(OPTIONS, '   ')).toHaveLength(4)
  })

  // Substring, not prefix: the memorable half of `server.motd` is `motd`.
  it('matches on a substring rather than only a prefix', () => {
    expect(filterOptions(OPTIONS, 'motd').map((o) => o.value)).toEqual(['server.motd'])
    expect(filterOptions(OPTIONS, 'players').map((o) => o.value)).toEqual([
      'players.count',
      'players.max',
    ])
  })

  it('ignores case', () => {
    expect(filterOptions(OPTIONS, 'TPS').map((o) => o.value)).toEqual(['tps'])
  })

  it('matches the value when the label differs from it', () => {
    const opts = [{ value: 'save-all', label: 'Save All' }]
    expect(filterOptions(opts, 'save-a')).toHaveLength(1)
  })
})

describe('typeaheadIndex', () => {
  it('finds the first label starting with the buffer', () => {
    expect(typeaheadIndex(OPTIONS, 'se')).toBe(3)
  })

  it('wraps around when searching from past the match', () => {
    expect(typeaheadIndex(OPTIONS, 'tps', 2)).toBe(0)
  })

  it('cycles through repeated prefixes as the start index advances', () => {
    expect(typeaheadIndex(OPTIONS, 'players', 0)).toBe(1)
    expect(typeaheadIndex(OPTIONS, 'players', 2)).toBe(2)
  })

  // -1 means "leave the highlight alone", never "select nothing".
  it('reports no match rather than falling back to the first option', () => {
    expect(typeaheadIndex(OPTIONS, 'zzz')).toBe(-1)
    expect(typeaheadIndex(OPTIONS, '')).toBe(-1)
    expect(typeaheadIndex([], 'a')).toBe(-1)
  })
})
