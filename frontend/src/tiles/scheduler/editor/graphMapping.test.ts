import { describe, it, expect } from 'vitest'
import type { Edge as FlowEdge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'
import {
  graphToFlow,
  flowToGraph,
  graphSignature,
  isValidConnection,
  detectControlCycles,
  randId,
  defaultConfig,
} from './graphMapping'
import type { NodeData, BlockFlowNode } from './graphMapping'
import { DATA_EDGE_STYLE } from './blockMeta'

// Wails model classes carry a `convertValues` method the pure logic never
// touches — cast via `unknown`, same pattern as portTypes.test.ts.
function port(id: string, type: string): models.DataPort {
  return { id, label: id, type } as unknown as models.DataPort
}

function def(
  id: string,
  dataOutputs: models.DataPort[] = [],
  dataInputs: models.DataPort[] = [],
  configSchema: models.ConfigField[] = [],
): models.BlockDef {
  return {
    id,
    category: 'data',
    label: id,
    description: '',
    isTrigger: false,
    controlInputs: [],
    controlOutputs: [],
    dataInputs,
    dataOutputs,
    configSchema,
    source: 'native',
  } as unknown as models.BlockDef
}

function graphNode(
  id: string,
  type: string,
  config: Record<string, unknown> = {},
  position = { x: 0, y: 0 },
): models.Node {
  return { id, type, config, position } as unknown as models.Node
}

function graphEdge(
  id: string,
  kind: 'control' | 'data',
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
): models.Edge {
  return { id, kind, source, sourcePort, target, targetPort } as unknown as models.Edge
}

function flowEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  data?: Record<string, unknown>,
): FlowEdge {
  return { id, source, target, sourceHandle, targetHandle, data } as unknown as FlowEdge
}

function flowNode(
  id: string,
  blockType: string,
  config: Record<string, unknown> = {},
): BlockFlowNode {
  return {
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    data: { blockType, config, label: blockType },
  } as unknown as BlockFlowNode
}

describe('graphToFlow', () => {
  it('maps node id/position/config and resolves label from defMap', () => {
    const graph = {
      nodes: [graphNode('n1', 'data.constant', { value: 5 }, { x: 10, y: 20 })],
      edges: [],
    } as unknown as models.Graph
    const defMap = new Map([['data.constant', def('data.constant')]])
    defMap.get('data.constant')!.label = 'Constant'

    const { nodes } = graphToFlow(graph, defMap)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n1')
    expect(nodes[0].position).toEqual({ x: 10, y: 20 })
    expect((nodes[0].data as NodeData).blockType).toBe('data.constant')
    expect((nodes[0].data as NodeData).config).toEqual({ value: 5 })
    expect((nodes[0].data as NodeData).label).toBe('Constant')
  })

  it('copies config into a distinct object, not an alias', () => {
    const original = { value: 5 }
    const graph = { nodes: [graphNode('n1', 'x', original)], edges: [] } as unknown as models.Graph
    const { nodes } = graphToFlow(graph, new Map())
    expect((nodes[0].data as NodeData).config).toEqual(original)
    expect((nodes[0].data as NodeData).config).not.toBe(original)
  })

  it('falls back to the node type as label when no def is found', () => {
    const graph = {
      nodes: [graphNode('n1', 'unknown.block')],
      edges: [],
    } as unknown as models.Graph
    const { nodes } = graphToFlow(graph, new Map())
    expect((nodes[0].data as NodeData).label).toBe('unknown.block')
  })

  it('defaults missing nodes/edges to empty arrays', () => {
    const graph = {} as unknown as models.Graph
    const { nodes, edges } = graphToFlow(graph, new Map())
    expect(nodes).toEqual([])
    expect(edges).toEqual([])
  })

  it('defaults a missing position to {x:0, y:0} and missing config to {}', () => {
    const graph = {
      nodes: [{ id: 'n1', type: 'x' } as unknown as models.Node],
      edges: [],
    } as unknown as models.Graph
    const { nodes } = graphToFlow(graph, new Map())
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
    expect((nodes[0].data as NodeData).config).toEqual({})
  })

  it('maps a control edge to ctrl: handles with no style and kind:control', () => {
    const graph = {
      nodes: [],
      edges: [graphEdge('e1', 'control', 'a', 'out', 'b', 'in')],
    } as unknown as models.Graph
    const { edges } = graphToFlow(graph, new Map())
    expect(edges[0].sourceHandle).toBe('ctrl:out')
    expect(edges[0].targetHandle).toBe('ctrl:in')
    expect(edges[0].style).toBeUndefined()
    expect(edges[0].data).toEqual({ kind: 'control' })
  })

  it('maps a data edge to data: handles with the dashed blue style and kind:data', () => {
    const graph = {
      nodes: [],
      edges: [graphEdge('e1', 'data', 'a', 'value', 'b', 'in')],
    } as unknown as models.Graph
    const { edges } = graphToFlow(graph, new Map())
    expect(edges[0].sourceHandle).toBe('data:value')
    expect(edges[0].targetHandle).toBe('data:in')
    // Against the constant, not a second copy of the literal: asserting the
    // hex here is the same drift the constant exists to stop (#163).
    expect(edges[0].style).toEqual(DATA_EDGE_STYLE)
    expect(edges[0].data).toEqual({ kind: 'data' })
  })
})

describe('flowToGraph', () => {
  const meta = { id: 'g1', name: 'My Graph', enabled: true, createdAt: 1000 }

  it('maps node type/config/position from flow node data', () => {
    const nodes = [flowNode('n1', 'data.constant', { value: 5 })]
    nodes[0].position = { x: 10, y: 20 }
    const graph = flowToGraph(meta, nodes, [])
    expect(graph.nodes).toEqual([
      { id: 'n1', type: 'data.constant', config: { value: 5 }, position: { x: 10, y: 20 } },
    ])
  })

  it('carries meta through and stamps a fresh updatedAt', () => {
    const before = Date.now()
    const graph = flowToGraph(meta, [], [])
    expect(graph.id).toBe('g1')
    expect(graph.name).toBe('My Graph')
    expect(graph.enabled).toBe(true)
    expect(graph.createdAt).toBe(1000)
    expect(graph.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('infers kind from the sourceHandle prefix and strips ctrl:/data: from ports', () => {
    const edges = [
      flowEdge('e1', 'a', 'b', 'ctrl:out', 'ctrl:in'),
      flowEdge('e2', 'a', 'b', 'data:value', 'data:in'),
    ]
    const graph = flowToGraph(meta, [], edges)
    expect(graph.edges).toEqual([
      { id: 'e1', kind: 'control', source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in' },
      { id: 'e2', kind: 'data', source: 'a', sourcePort: 'value', target: 'b', targetPort: 'in' },
    ])
  })

  it('treats a missing handle as an empty port', () => {
    const edges = [flowEdge('e1', 'a', 'b', '', '')]
    const graph = flowToGraph(meta, [], edges)
    expect(graph.edges[0]).toMatchObject({ kind: 'control', sourcePort: '', targetPort: '' })
  })
})

describe('graphToFlow -> flowToGraph round-trip', () => {
  it('preserves node ids/types/configs/positions and edge kinds/ports', () => {
    const defMap = new Map([
      ['data.constant', def('data.constant', [port('value', 'number')])],
      ['action.log', def('action.log')],
    ])
    const original = {
      id: 'g1',
      name: 'Round Trip',
      enabled: true,
      createdAt: 1000,
      nodes: [
        graphNode('n1', 'data.constant', { value: 5 }, { x: 10, y: 20 }),
        graphNode('n2', 'action.log', { message: 'hi' }, { x: 100, y: 200 }),
      ],
      edges: [
        graphEdge('e1', 'control', 'n1', 'out', 'n2', 'in'),
        graphEdge('e2', 'data', 'n1', 'value', 'n2', 'message'),
      ],
    } as unknown as models.Graph

    const { nodes, edges } = graphToFlow(original, defMap)
    const roundTripped = flowToGraph(
      {
        id: original.id,
        name: original.name,
        enabled: original.enabled,
        createdAt: original.createdAt,
      },
      nodes,
      edges,
    )

    expect(roundTripped.id).toBe(original.id)
    expect(roundTripped.name).toBe(original.name)
    expect(roundTripped.enabled).toBe(original.enabled)
    expect(roundTripped.createdAt).toBe(original.createdAt)
    expect(roundTripped.nodes).toEqual(original.nodes)
    expect(roundTripped.edges).toEqual(original.edges)
  })
})

describe('isValidConnection', () => {
  // Each def carries both an output and an input 'value' port so a node can
  // play either the source or target role in different tests.
  const defMap = new Map([
    ['data.number', def('data.number', [port('value', 'number')], [port('value', 'number')])],
    ['data.string', def('data.string', [port('value', 'string')], [port('value', 'string')])],
  ])
  const nodes = [flowNode('a', 'data.number'), flowNode('b', 'data.string')]

  it('rejects a self-loop', () => {
    expect(isValidConnection(flowEdge('e', 'a', 'a', 'ctrl:out', 'ctrl:in'), nodes, defMap)).toBe(
      false,
    )
  })

  it('rejects cross-kind wiring (data handle into control handle)', () => {
    expect(isValidConnection(flowEdge('e', 'a', 'b', 'data:value', 'ctrl:in'), nodes, defMap)).toBe(
      false,
    )
  })

  it('allows control-to-control unconditionally', () => {
    expect(isValidConnection(flowEdge('e', 'a', 'b', 'ctrl:out', 'ctrl:in'), nodes, defMap)).toBe(
      true,
    )
  })

  it('allows compatible data types (number -> string)', () => {
    expect(
      isValidConnection(flowEdge('e', 'a', 'b', 'data:value', 'data:value'), nodes, defMap),
    ).toBe(true)
  })

  it('blocks incompatible data types (string -> number)', () => {
    const rev = [flowNode('a', 'data.string'), flowNode('b', 'data.number')]
    expect(
      isValidConnection(flowEdge('e', 'a', 'b', 'data:value', 'data:value'), rev, defMap),
    ).toBe(false)
  })

  it('allows a connection when the type cannot be resolved', () => {
    expect(
      isValidConnection(flowEdge('e', 'a', 'b', 'data:missing', 'data:missing'), nodes, defMap),
    ).toBe(true)
  })
})

describe('detectControlCycles', () => {
  it('returns empty sets when there are no control edges', () => {
    const result = detectControlCycles([{ id: 'a' }], [])
    expect(result.cycleNodes.size).toBe(0)
    expect(result.cycleEdges.size).toBe(0)
  })

  it('flags nothing for an acyclic chain a->b->c', () => {
    const edges = [
      flowEdge('e1', 'a', 'b', 'ctrl:out', 'ctrl:in'),
      flowEdge('e2', 'b', 'c', 'ctrl:out', 'ctrl:in'),
    ]
    const result = detectControlCycles([{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges)
    expect(result.cycleNodes.size).toBe(0)
    expect(result.cycleEdges.size).toBe(0)
  })

  it('flags both nodes and edges in a simple 2-node cycle', () => {
    const edges = [
      flowEdge('e1', 'a', 'b', 'ctrl:out', 'ctrl:in'),
      flowEdge('e2', 'b', 'a', 'ctrl:out', 'ctrl:in'),
    ]
    const result = detectControlCycles([{ id: 'a' }, { id: 'b' }], edges)
    expect(result.cycleNodes).toEqual(new Set(['a', 'b']))
    expect(result.cycleEdges).toEqual(new Set(['e1', 'e2']))
  })

  it('flags a self-loop control edge', () => {
    const edges = [flowEdge('e1', 'a', 'a', 'ctrl:out', 'ctrl:in')]
    const result = detectControlCycles([{ id: 'a' }], edges)
    expect(result.cycleNodes).toEqual(new Set(['a']))
    expect(result.cycleEdges).toEqual(new Set(['e1']))
  })

  it('ignores data edges even when they form a loop', () => {
    const edges = [
      flowEdge('e1', 'a', 'b', 'data:out', 'data:in', { kind: 'data' }),
      flowEdge('e2', 'b', 'a', 'data:out', 'data:in', { kind: 'data' }),
    ]
    const result = detectControlCycles([{ id: 'a' }, { id: 'b' }], edges)
    expect(result.cycleNodes.size).toBe(0)
    expect(result.cycleEdges.size).toBe(0)
  })

  it('only flags the cycle members, not an unrelated acyclic tail', () => {
    const edges = [
      flowEdge('e1', 'a', 'b', 'ctrl:out', 'ctrl:in'),
      flowEdge('e2', 'b', 'a', 'ctrl:out', 'ctrl:in'),
      flowEdge('e3', 'a', 'c', 'ctrl:out', 'ctrl:in'),
    ]
    const result = detectControlCycles([{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges)
    expect(result.cycleNodes).toEqual(new Set(['a', 'b']))
    expect(result.cycleEdges).toEqual(new Set(['e1', 'e2']))
  })
})

describe('randId', () => {
  it('returns an 8-character string', () => {
    expect(randId()).toHaveLength(8)
  })
})

describe('defaultConfig', () => {
  it('picks up schema defaults and skips fields without one', () => {
    const d = def(
      'x',
      [],
      [],
      [
        { key: 'a', label: 'A', type: 'string', default: 'hi' } as unknown as models.ConfigField,
        { key: 'b', label: 'B', type: 'number' } as unknown as models.ConfigField,
      ],
    )
    expect(defaultConfig(d)).toEqual({ a: 'hi' })
  })
})

describe('graphSignature', () => {
  const meta = { name: 'g1', enabled: true }

  it('is stable for the same graph across calls', () => {
    const nodes = [flowNode('n1', 'data.constant', { value: 1 })]
    const edges = [flowEdge('e1', 'n1', 'n2', 'ctrl:out', 'ctrl:in')]
    expect(graphSignature(meta, nodes, edges)).toBe(graphSignature(meta, nodes, edges))
  })

  it('changes when a node moves', () => {
    const n1 = flowNode('n1', 'data.constant', { value: 1 })
    const n2 = { ...n1, position: { x: 40, y: 40 } }
    expect(graphSignature(meta, [n1], [])).not.toBe(graphSignature(meta, [n2], []))
  })

  it('changes when node config changes', () => {
    const n1 = flowNode('n1', 'data.constant', { value: 1 })
    const n2 = flowNode('n1', 'data.constant', { value: 2 })
    expect(graphSignature(meta, [n1], [])).not.toBe(graphSignature(meta, [n2], []))
  })

  it('changes when the graph name or enabled flag changes', () => {
    const nodes = [flowNode('n1', 'data.constant', { value: 1 })]
    expect(graphSignature(meta, nodes, [])).not.toBe(
      graphSignature({ name: 'g2', enabled: true }, nodes, []),
    )
    expect(graphSignature(meta, nodes, [])).not.toBe(
      graphSignature({ name: 'g1', enabled: false }, nodes, []),
    )
  })

  it('changes when edges are added, removed, or rewired', () => {
    const nodes = [
      flowNode('n1', 'data.constant', {}),
      flowNode('n2', 'data.constant', {}),
      flowNode('n3', 'data.constant', {}),
    ]
    const e1 = [flowEdge('e1', 'n1', 'n2', 'ctrl:out', 'ctrl:in')]
    const e2 = [flowEdge('e1', 'n1', 'n3', 'ctrl:out', 'ctrl:in')]
    expect(graphSignature(meta, nodes, e1)).not.toBe(graphSignature(meta, nodes, e2))
    expect(graphSignature(meta, nodes, e1)).not.toBe(graphSignature(meta, nodes, []))
  })

  it('ignores node/edge array order', () => {
    const n1 = flowNode('n1', 'data.constant', {})
    const n2 = flowNode('n2', 'data.constant', {})
    const e1 = flowEdge('e1', 'n1', 'n2', 'ctrl:out', 'ctrl:in')
    const e2 = flowEdge('e2', 'n1', 'n2', 'data:out', 'data:in')
    expect(graphSignature(meta, [n1, n2], [e1, e2])).toBe(graphSignature(meta, [n2, n1], [e2, e1]))
  })

  it('ignores _collapsed (a view toggle, not graph content)', () => {
    const n1 = flowNode('n1', 'data.constant', { value: 1 })
    const n2 = flowNode('n1', 'data.constant', { value: 1, _collapsed: true })
    expect(graphSignature(meta, [n1], [])).toBe(graphSignature(meta, [n2], []))
  })

  it('ignores React Flow transient fields like selected and _animDelay', () => {
    const n1 = flowNode('n1', 'data.constant', { value: 1 })
    const n2 = {
      ...n1,
      selected: true,
      data: { ...n1.data, _animDelay: 123 },
    }
    expect(graphSignature(meta, [n1], [])).toBe(graphSignature(meta, [n2], []))
  })
})
