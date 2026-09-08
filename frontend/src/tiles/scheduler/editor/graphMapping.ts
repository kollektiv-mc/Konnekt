import type { Node as FlowNode, Edge as FlowEdge, Connection } from '@xyflow/react'
import { models } from '../../../../wailsjs/go/models'
import { resolveDataPortType, portTypesCompatible } from './portTypes'

export interface NodeData extends Record<string, unknown> {
  blockType: string
  config: Record<string, unknown>
  label: string
  _animDelay?: number
}

export type BlockFlowNode = FlowNode<NodeData, 'block'>

export function graphToFlow(
  graph: models.Graph,
  defMap: Map<string, models.BlockDef>,
): { nodes: BlockFlowNode[]; edges: FlowEdge[] } {
  const nodes: BlockFlowNode[] = (graph.nodes ?? []).map((n) => ({
    id: n.id,
    type: 'block' as const,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: {
      blockType: n.type,
      config: { ...n.config },
      label: defMap.get(n.type)?.label ?? n.type,
    },
  }))

  const edges: FlowEdge[] = (graph.edges ?? []).map((e) => {
    const isData = e.kind === 'data'
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: `${isData ? 'data' : 'ctrl'}:${e.sourcePort}`,
      targetHandle: `${isData ? 'data' : 'ctrl'}:${e.targetPort}`,
      type: 'smoothstep',
      style: isData ? { strokeDasharray: '4 2', stroke: '#60a5fa' } : undefined,
      data: { kind: e.kind } as Record<string, unknown>,
    }
  })

  return { nodes, edges }
}

export function flowToGraph(
  meta: Pick<models.Graph, 'id' | 'name' | 'enabled' | 'createdAt'>,
  nodes: FlowNode[],
  edges: FlowEdge[],
): models.Graph {
  // Through the generated constructor rather than a cast: createFrom builds the
  // Node, Edge and Position instances the binding's type promises, and the
  // outgoing IPC call serializes them as plain JSON either way.
  return models.Graph.createFrom({
    id: meta.id,
    name: meta.name,
    enabled: meta.enabled,
    createdAt: meta.createdAt,
    updatedAt: Date.now(),
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as NodeData).blockType,
      config: (n.data as NodeData).config,
      position: { x: n.position.x, y: n.position.y },
    })),
    edges: edges.map((e) => {
      const srcH = e.sourceHandle ?? ''
      const tgtH = e.targetHandle ?? ''
      const kind = srcH.startsWith('data:') ? 'data' : 'control'
      return {
        id: e.id,
        kind,
        source: e.source,
        sourcePort: srcH.replace(/^(ctrl|data):/, ''),
        target: e.target,
        targetPort: tgtH.replace(/^(ctrl|data):/, ''),
      }
    }),
  })
}

// Reject cross-kind wiring, self-loops, and (for data edges) incompatible port
// types — e.g. a "string" output can't wire into a "number" input, since that
// would silently coerce to the input's default at run time.
// ReactFlow v12 passes Edge | Connection to isValidConnection.
export function isValidConnection(
  edge: FlowEdge | Connection,
  nodes: FlowNode[],
  defMap: Map<string, models.BlockDef>,
): boolean {
  if (edge.source === edge.target) return false
  const srcHandle = edge.sourceHandle ?? ''
  const tgtHandle = edge.targetHandle ?? ''
  const isData = srcHandle.startsWith('data:')
  if (isData !== tgtHandle.startsWith('data:')) return false
  if (!isData) return true

  const srcNode = nodes.find((n) => n.id === edge.source)
  const tgtNode = nodes.find((n) => n.id === edge.target)
  const srcData = srcNode?.data as NodeData | undefined
  const tgtData = tgtNode?.data as NodeData | undefined

  const srcType = resolveDataPortType(
    srcData && defMap.get(srcData.blockType),
    srcHandle.replace(/^data:/, ''),
    'output',
    srcData?.config,
  )
  const tgtType = resolveDataPortType(
    tgtData && defMap.get(tgtData.blockType),
    tgtHandle.replace(/^data:/, ''),
    'input',
    tgtData?.config,
  )
  return portTypesCompatible(srcType, tgtType)
}

export function randId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// A stable fingerprint of everything a "save" persists, for dirty-checking
// against a last-saved snapshot. Deliberately excludes fields that change
// without representing a real edit: React Flow `selected`/`dimensions`,
// `_animDelay` (load-only stagger, already absent from flowToGraph output),
// and `_collapsed` (a view toggle, not graph content). Node `position` is
// included on purpose — dragging a node counts as an unsaved change.
export function graphSignature(
  meta: Pick<models.Graph, 'name' | 'enabled'>,
  nodes: FlowNode[],
  edges: FlowEdge[],
): string {
  return JSON.stringify({
    name: meta.name,
    enabled: meta.enabled,
    nodes: nodes
      .map((n) => ({
        id: n.id,
        type: (n.data as NodeData).blockType,
        config: stripCollapsed((n.data as NodeData).config),
        position: { x: n.position.x, y: n.position.y },
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map((e) => {
        const srcH = e.sourceHandle ?? ''
        const tgtH = e.targetHandle ?? ''
        return {
          id: e.id,
          kind: srcH.startsWith('data:') ? 'data' : 'control',
          source: e.source,
          sourcePort: srcH.replace(/^(ctrl|data):/, ''),
          target: e.target,
          targetPort: tgtH.replace(/^(ctrl|data):/, ''),
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
}

function stripCollapsed(config: Record<string, unknown>): Record<string, unknown> {
  const { _collapsed, ...rest } = config
  return rest
}

// detectControlCycles finds nodes and edges that participate in a control-flow
// cycle. The engine aborts any run that loops (maxNodesPerRun guard), so the
// editor flags cycles statically to warn the author before they run.
export function detectControlCycles(
  nodes: { id: string }[],
  edges: FlowEdge[],
): { cycleNodes: Set<string>; cycleEdges: Set<string> } {
  const cycleNodes = new Set<string>()
  const cycleEdges = new Set<string>()

  const controlEdges = edges.filter(
    (e) =>
      (e.data as { kind?: string } | undefined)?.kind !== 'data' &&
      !(e.sourceHandle ?? '').startsWith('data:'),
  )
  if (controlEdges.length === 0) return { cycleNodes, cycleEdges }

  const adj = new Map<string, string[]>()
  for (const e of controlEdges) {
    const list = adj.get(e.source) ?? []
    list.push(e.target)
    adj.set(e.source, list)
  }

  // Memoised forward reachability over control edges.
  const reachCache = new Map<string, Set<string>>()
  const reachableFrom = (start: string): Set<string> => {
    const cached = reachCache.get(start)
    if (cached) return cached
    const seen = new Set<string>()
    const stack = [...(adj.get(start) ?? [])]
    while (stack.length) {
      const cur = stack.pop()!
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const next of adj.get(cur) ?? []) stack.push(next)
    }
    reachCache.set(start, seen)
    return seen
  }

  // An edge u→v closes a cycle when v can reach u again.
  for (const e of controlEdges) {
    if (e.source === e.target || reachableFrom(e.target).has(e.source)) {
      cycleEdges.add(e.id)
      cycleNodes.add(e.source)
      cycleNodes.add(e.target)
    }
  }

  return { cycleNodes, cycleEdges }
}

export function defaultConfig(def: models.BlockDef): Record<string, unknown> {
  const cfg: Record<string, unknown> = {}
  for (const f of def.configSchema ?? []) {
    if (f.default !== undefined) cfg[f.key] = f.default
  }
  return cfg
}
