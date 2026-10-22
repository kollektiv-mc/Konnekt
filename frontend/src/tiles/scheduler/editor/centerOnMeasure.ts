import type { Node, NodeChange } from '@xyflow/react'

type Size = { width: number; height: number }

/**
 * The first measurement of each pending node in a batch of changes, taking
 * those ids off `pending` so a later resize (a collapse, say) leaves the node
 * where it is.
 *
 * A block dropped on the canvas or picked from the quick-add list is placed at
 * the pointer, but a node's position is its top-left corner and its size is not
 * known until it renders (it grows with its ports). So it is added at the
 * pointer and shifted back by half its size on its first measurement, in the
 * render that measurement makes it visible, so it never shows at the corner.
 *
 * Taking the ids here rather than in `centerNodes` keeps that a pure state
 * updater, which StrictMode may run twice.
 */
export function takeMeasured<N extends Node>(
  changes: NodeChange<N>[],
  pending: Set<string>,
): Map<string, Size> {
  const sizes = new Map<string, Size>()
  for (const c of changes) {
    if (c.type === 'dimensions' && c.dimensions && pending.has(c.id)) {
      sizes.set(c.id, c.dimensions)
      pending.delete(c.id)
    }
  }
  return sizes
}

/**
 * Moves each measured node back by half its size, so its centre is where its
 * corner was. With a snap grid the result lands on the grid, as a dragged node
 * would: React Flow snaps only what the pointer moves, never a position set.
 */
export function centerNodes<N extends Node>(
  nodes: N[],
  sizes: Map<string, Size>,
  snap?: [number, number],
): N[] {
  const [sx, sy] = snap ?? [1, 1]
  return nodes.map((n) => {
    const size = sizes.get(n.id)
    if (!size) return n
    return {
      ...n,
      position: {
        x: Math.round((n.position.x - size.width / 2) / sx) * sx,
        y: Math.round((n.position.y - size.height / 2) / sy) * sy,
      },
    }
  })
}
