import type { Edge as FlowEdge } from '@xyflow/react'
import type { BlockFlowNode } from './graphMapping'

/** What the Edit menu's select rows ask for. */
export type SelectionSpec =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'type'; blockType: string }
  | { kind: 'name'; query: string }

/**
 * The name a node goes by when it is searched for: its label today. Node names
 * of the user's own (#126) belong here when they land, so that "select by name"
 * follows whatever the node shows as its title.
 */
export function nodeTitle(node: BlockFlowNode): string {
  return node.data.label
}

/**
 * The selection a spec asks for, as new node and edge arrays. Only the
 * `selected` flag changes, so nothing that depends on a node's identity
 * (position, config) is disturbed, and a node already in the right state is
 * returned as it was rather than copied.
 *
 * "All" takes the edges too, so a following Delete clears the canvas; the
 * narrower selections take nodes only, and drop any edge selection with them,
 * since a half-selected canvas where the edges are left over from before is
 * not something the user asked for.
 */
export function applySelection(
  nodes: readonly BlockFlowNode[],
  edges: readonly FlowEdge[],
  spec: SelectionSpec,
): { nodes: BlockFlowNode[]; edges: FlowEdge[] } {
  const query = spec.kind === 'name' ? spec.query.trim().toLowerCase() : ''
  const wanted = (n: BlockFlowNode): boolean => {
    switch (spec.kind) {
      case 'all':
        return true
      case 'none':
        return false
      case 'type':
        return n.data.blockType === spec.blockType
      case 'name':
        return query !== '' && nodeTitle(n).toLowerCase().includes(query)
    }
  }
  const edgesWanted = spec.kind === 'all'
  return {
    nodes: nodes.map((n) => (!!n.selected === wanted(n) ? n : { ...n, selected: wanted(n) })),
    edges: edges.map((e) => (!!e.selected === edgesWanted ? e : { ...e, selected: edgesWanted })),
  }
}

/** The block types on the canvas, each once, in label order. */
export function typesPresent(
  nodes: readonly BlockFlowNode[],
  labelOf: (blockType: string) => string,
): { blockType: string; label: string }[] {
  const seen = new Set<string>()
  for (const n of nodes) seen.add(n.data.blockType)
  return [...seen]
    .map((blockType) => ({ blockType, label: labelOf(blockType) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.blockType.localeCompare(b.blockType))
}
