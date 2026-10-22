import { describe, expect, it } from 'vitest'
import type { models } from '../../../../wailsjs/go/models'
import { blockEntries, groupKey } from './blockGroups'

const def = (id: string, group?: string) =>
  ({ id, category: 'action', label: id, description: '', group }) as unknown as models.BlockDef

describe('blockEntries', () => {
  it('lists ungrouped blocks one by one, in order', () => {
    const [a, b] = [def('a'), def('b')]
    expect(blockEntries([a, b])).toEqual([
      { kind: 'block', def: a },
      { kind: 'block', def: b },
    ])
  })

  it('treats an empty group name as no group', () => {
    const a = def('a', '')
    expect(blockEntries([a])).toEqual([{ kind: 'block', def: a }])
  })

  it('gathers a group where its first member appeared', () => {
    const [a, g1, b, g2, c] = [def('a'), def('g1', 'G'), def('b'), def('g2', 'G'), def('c')]
    expect(blockEntries([a, g1, b, g2, c])).toEqual([
      { kind: 'block', def: a },
      { kind: 'group', name: 'G', defs: [g1, g2] },
      { kind: 'block', def: b },
      { kind: 'block', def: c },
    ])
  })

  it('keeps separate groups apart, in order of first appearance', () => {
    const [x1, y1, x2] = [def('x1', 'X'), def('y1', 'Y'), def('x2', 'X')]
    expect(blockEntries([x1, y1, x2])).toEqual([
      { kind: 'group', name: 'X', defs: [x1, x2] },
      { kind: 'group', name: 'Y', defs: [y1] },
    ])
  })

  it('returns nothing for no blocks', () => {
    expect(blockEntries([])).toEqual([])
  })
})

describe('groupKey', () => {
  it('scopes a group to its category', () => {
    expect(groupKey('action', 'Distant Horizons')).toBe('action/Distant Horizons')
  })
})
