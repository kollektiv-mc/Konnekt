import { describe, it, expect } from 'vitest'
import type { Edge as FlowEdge } from '@xyflow/react'
import type { BlockFlowNode } from './graphMapping'
import { applySelection, typesPresent } from './selection'

function node(id: string, blockType: string, label: string, selected = false): BlockFlowNode {
  return {
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    selected,
    data: { blockType, config: {}, label },
  }
}

const nodes = [
  node('a', 'action.command', 'Command'),
  node('b', 'action.command', 'Command', true),
  node('c', 'trigger.cron', 'Cron'),
  node('d', 'notify.discord', 'Discord message'),
]
const edges: FlowEdge[] = [
  { id: 'e1', source: 'a', target: 'b', selected: true },
  { id: 'e2', source: 'b', target: 'c' },
]

const selectedIds = (ns: BlockFlowNode[]) => ns.filter((n) => n.selected).map((n) => n.id)

describe('applySelection', () => {
  it('selects every node and edge for all', () => {
    const out = applySelection(nodes, edges, { kind: 'all' })
    expect(selectedIds(out.nodes)).toEqual(['a', 'b', 'c', 'd'])
    expect(out.edges.every((e) => e.selected)).toBe(true)
  })

  it('clears nodes and edges for none', () => {
    const out = applySelection(nodes, edges, { kind: 'none' })
    expect(selectedIds(out.nodes)).toEqual([])
    expect(out.edges.some((e) => e.selected)).toBe(false)
  })

  it('selects the nodes of one block type and drops the rest', () => {
    const out = applySelection(nodes, edges, { kind: 'type', blockType: 'action.command' })
    expect(selectedIds(out.nodes)).toEqual(['a', 'b'])
    expect(out.edges.some((e) => e.selected)).toBe(false)
  })

  it('matches a name by substring, ignoring case and surrounding space', () => {
    const out = applySelection(nodes, edges, { kind: 'name', query: '  DISC ' })
    expect(selectedIds(out.nodes)).toEqual(['d'])
  })

  it('selects nothing for a blank or unmatched name', () => {
    expect(selectedIds(applySelection(nodes, edges, { kind: 'name', query: '  ' }).nodes)).toEqual(
      [],
    )
    expect(selectedIds(applySelection(nodes, edges, { kind: 'name', query: 'zzz' }).nodes)).toEqual(
      [],
    )
  })

  it('returns a node already in the right state as it was', () => {
    const out = applySelection(nodes, edges, { kind: 'type', blockType: 'action.command' })
    expect(out.nodes[1]).toBe(nodes[1])
    expect(out.nodes[2]).toBe(nodes[2])
    expect(out.nodes[0]).not.toBe(nodes[0])
    expect(out.nodes[0].selected).toBe(true)
  })

  it('does not change a node beyond its selected flag', () => {
    const out = applySelection(nodes, edges, { kind: 'all' })
    expect(out.nodes[0]).toEqual({ ...nodes[0], selected: true })
  })
})

describe('typesPresent', () => {
  it('lists each block type once, ordered by label', () => {
    const out = typesPresent(nodes, (bt) => nodes.find((n) => n.data.blockType === bt)!.data.label)
    expect(out).toEqual([
      { blockType: 'action.command', label: 'Command' },
      { blockType: 'trigger.cron', label: 'Cron' },
      { blockType: 'notify.discord', label: 'Discord message' },
    ])
  })

  it('is empty for an empty canvas', () => {
    expect(typesPresent([], (bt) => bt)).toEqual([])
  })
})
