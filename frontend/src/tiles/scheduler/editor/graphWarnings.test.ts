import { describe, it, expect } from 'vitest'
import type { models } from '../../../../wailsjs/go/models'
import type { BlockFlowNode } from './graphMapping'
import { warningLine, warningRows, warningsByNode } from './graphWarnings'

const node = (id: string, label: string) =>
  ({
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    data: { blockType: 'x', config: {}, label },
  }) as BlockFlowNode
const w = (nodeId: string, text: string) => ({ nodeId, text }) as models.GraphWarning

describe('warningRows', () => {
  const nodes = [node('a', 'Command'), node('b', 'DH Snapshot')]

  it('gives each warning the label of its node', () => {
    expect(warningRows([w('b', 'one'), w('a', 'two')], nodes)).toEqual([
      { nodeId: 'b', label: 'DH Snapshot', text: 'one' },
      { nodeId: 'a', label: 'Command', text: 'two' },
    ])
  })

  it('leaves a graph-wide warning without a label', () => {
    expect(warningRows([w('', 'whole graph')], nodes)).toEqual([
      { nodeId: '', label: '', text: 'whole graph' },
    ])
  })

  it('treats a node that is gone as graph-wide', () => {
    expect(warningRows([w('zzz', 'stale')], nodes)).toEqual([
      { nodeId: '', label: '', text: 'stale' },
    ])
  })
})

describe('warningLine', () => {
  it('leads with the label when there is one', () => {
    expect(warningLine({ label: 'Command', text: 'beware' })).toBe('Command: beware')
    expect(warningLine({ label: '', text: 'beware' })).toBe('beware')
  })
})

describe('warningsByNode', () => {
  it('groups by node and drops the graph-wide ones', () => {
    const byNode = warningsByNode([w('a', 'one'), w('', 'whole'), w('a', 'two'), w('b', 'three')])
    expect([...byNode]).toEqual([
      ['a', ['one', 'two']],
      ['b', ['three']],
    ])
  })
})
