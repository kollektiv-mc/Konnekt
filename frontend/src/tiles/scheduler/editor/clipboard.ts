import type { Edge as FlowEdge } from '@xyflow/react'
import { randId, type BlockFlowNode, type NodeData } from './graphMapping'

/** What a copy holds: the selected nodes and the edges wholly inside that set. */
export interface ClipboardSlice {
  nodes: BlockFlowNode[]
  edges: FlowEdge[]
}

interface Point {
  x: number
  y: number
}

/**
 * How far each repeat paste, and each duplicate, steps from the last. Flow
 * units, so a node (about 200 wide) is still mostly clear of its twin at a
 * glance without being a full node away, which would read as unrelated.
 */
export const PASTE_OFFSET = 32

// Module scope on purpose (#128): the editor remounts for each graph switch and
// each maximize, and the clipboard has to outlive both for a paste into another
// graph to work. In memory only, because the frontend has no OS clipboard and
// moving a graph between machines is the export/import issue's territory.
let held: ClipboardSlice | null = null

// How many times this copy has been pasted at the same spot, so the next one
// steps instead of landing exactly on the last (see `pasteStep`).
let lastAnchor: string | null = null
let repeats = 0

/** The clipboard's contents, or null when nothing has been copied. */
export function readClipboard(): ClipboardSlice | null {
  return held
}

export function hasClipboard(): boolean {
  return held !== null
}

/** Empties the clipboard and its repeat count. Tests only. */
export function clearClipboard(): void {
  held = null
  lastAnchor = null
  repeats = 0
}

/**
 * Takes the selected nodes and the edges that run between two of them. An edge
 * with one end outside the selection is dropped: pasted, it would point at a
 * node that is not there, or worse at an unrelated one that happens to share
 * the id. Null when no node is selected, so a caller can tell a copy that did
 * nothing from one that did.
 *
 * Detached from the canvas: config is deep-copied so a later edit to the
 * original cannot reach into the clipboard, and what React Flow keeps on a node
 * for its own use (selection, measured size, the load-time animation stagger)
 * stays behind.
 */
export function captureSelection(
  nodes: readonly BlockFlowNode[],
  edges: readonly FlowEdge[],
): ClipboardSlice | null {
  const chosen = nodes.filter((n) => n.selected)
  if (chosen.length === 0) return null
  const ids = new Set(chosen.map((n) => n.id))
  return {
    nodes: chosen.map((n) => ({
      id: n.id,
      type: 'block' as const,
      position: { x: n.position.x, y: n.position.y },
      data: cloneData(n.data),
    })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e, selected: false, data: cloneEdgeData(e.data) })),
  }
}

/** Puts a slice on the clipboard and starts its repeat count over. */
export function writeClipboard(slice: ClipboardSlice): void {
  held = slice
  lastAnchor = null
  repeats = 0
}

/** The top-left of the box the slice's nodes occupy. */
export function sliceOrigin(slice: ClipboardSlice): Point {
  return {
    x: Math.min(...slice.nodes.map((n) => n.position.x)),
    y: Math.min(...slice.nodes.map((n) => n.position.y)),
  }
}

/**
 * How many steps past the anchor this paste lands. The first paste at a spot is
 * 0, and pasting again with the pointer where it was is 1, 2, and so on, which
 * is what keeps a run of Ctrl+V from stacking copies on one another. Moving the
 * pointer (or pasting with no anchor after one with) starts over, since the
 * user has chosen a new place. Counted in whole flow units so the sub-pixel
 * noise in a screen-to-flow conversion does not read as movement.
 */
export function pasteStep(anchor: Point | null): number {
  const key = anchor ? `${Math.round(anchor.x)},${Math.round(anchor.y)}` : 'none'
  repeats = key === lastAnchor ? repeats + 1 : 0
  lastAnchor = key
  return repeats
}

/**
 * The translation that puts a slice where a paste goes. With an anchor the
 * slice's top-left corner lands on it; without one (no pointer to follow) the
 * copy lands one step down and right of the original, which is also where a
 * duplicate goes.
 */
export function pasteDelta(slice: ClipboardSlice, anchor: Point | null, step: number): Point {
  const shift = step * PASTE_OFFSET
  if (!anchor) return { x: shift + PASTE_OFFSET, y: shift + PASTE_OFFSET }
  const origin = sliceOrigin(slice)
  return { x: anchor.x - origin.x + shift, y: anchor.y - origin.y + shift }
}

/**
 * New nodes and edges for a slice, moved by `delta`. Every node gets a fresh id
 * and every edge a fresh id with its ends remapped to the new nodes, so the
 * pasted set is wired to itself and to nothing else. The nodes come back
 * selected, which is what lets the next Delete, cut or Ctrl+D act on the paste.
 * The slice itself is left untouched, so it can be pasted again.
 */
export function instantiateSlice(
  slice: ClipboardSlice,
  delta: Point,
): { nodes: BlockFlowNode[]; edges: FlowEdge[] } {
  const idMap = new Map<string, string>()
  for (const n of slice.nodes) idMap.set(n.id, randId())
  return {
    nodes: slice.nodes.map((n) => ({
      id: idMap.get(n.id) as string,
      type: 'block' as const,
      position: { x: n.position.x + delta.x, y: n.position.y + delta.y },
      selected: true,
      data: cloneData(n.data),
    })),
    edges: slice.edges.flatMap((e) => {
      const source = idMap.get(e.source)
      const target = idMap.get(e.target)
      // Captured edges are internal by construction; this only holds if a slice
      // was built some other way.
      if (!source || !target) return []
      return [{ ...e, id: randId(), source, target, selected: false, data: cloneEdgeData(e.data) }]
    }),
  }
}

function cloneData(data: NodeData): NodeData {
  const copy: NodeData = { ...data, config: structuredClone(data.config ?? {}) }
  delete copy._animDelay
  return copy
}

function cloneEdgeData(data: FlowEdge['data']): FlowEdge['data'] {
  if (!data) return data
  const copy = { ...data }
  delete copy._animDelay
  return copy
}

/** What a key press asks of the clipboard, or null when it asks nothing. */
export type ClipboardAction = 'copy' | 'cut' | 'paste' | 'duplicate'

const KEY_ACTIONS: Record<string, ClipboardAction> = {
  c: 'copy',
  x: 'cut',
  v: 'paste',
  d: 'duplicate',
}

/**
 * Ctrl or Cmd with C, X, V or D, unless the focus is somewhere text is typed.
 * In a field those keys belong to the field (copying a config value must not
 * copy the node), the same guard the undo and Tab handlers use. Shift and Alt
 * make it a different chord and are left alone.
 */
export function clipboardAction(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  focused: Element | null,
): ClipboardAction | null {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return null
  const action = KEY_ACTIONS[e.key.toLowerCase()]
  if (!action) return null
  const tag = focused?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return null
  if (focused?.hasAttribute('contenteditable')) return null
  return action
}
