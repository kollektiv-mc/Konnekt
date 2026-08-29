import { TILE_REGISTRY } from '../tiles/registry'

/**
 * Every registry id, in `order`'s relative sequence, with stale ids (removed
 * from the registry since this was persisted) dropped and newly-registered
 * tiles appended at the end in registry order.
 */
export function normalizeCrateOrder(order: readonly string[]): string[] {
  const known = TILE_REGISTRY.map((t) => t.id)
  const knownSet = new Set(known)
  const kept = order.filter((id) => knownSet.has(id))
  const keptSet = new Set(kept)
  const missing = known.filter((id) => !keptSet.has(id))
  return [...kept, ...missing]
}

/**
 * Move `id` to `toIndex` within the subsequence of `order` selected by
 * `groupIds` (e.g. utility vs. maximizable tiles), leaving every id outside
 * that group in its current slot untouched.
 */
export function reorderWithinGroup(
  order: readonly string[],
  groupIds: ReadonlySet<string>,
  id: string,
  toIndex: number,
): string[] {
  const groupSeq = order.filter((x) => groupIds.has(x) && x !== id)
  const clamped = Math.max(0, Math.min(toIndex, groupSeq.length))
  groupSeq.splice(clamped, 0, id)
  let gi = 0
  return order.map((x) => (groupIds.has(x) ? groupSeq[gi++] : x))
}

/** The vertical extent of one rendered crate row. */
export interface RowBox {
  top: number
  height: number
}

/**
 * Which gap in a list of rows a pointer at `clientY` is currently pointing at.
 *
 * `rows` are the *siblings* of the row being dragged, in the order they are
 * rendered, so the returned index is directly the `toIndex` for
 * `reorderWithinGroup`: 0 is above the first sibling, `rows.length` is below
 * the last. A row is passed once the pointer is beyond its midpoint, which is
 * what makes the gap flip over at the visual halfway point rather than at an
 * edge.
 *
 * A null row is one whose element could not be measured — mid-teardown, or
 * never mounted. It counts as passed so the index stays aligned with its
 * position in `rows`; the alternative is an index that silently refers to a
 * different gap than the one under the pointer.
 */
export function dropIndexAt(rows: readonly (RowBox | null)[], clientY: number): number {
  let index = 0
  for (const row of rows) {
    if (row && clientY <= row.top + row.height / 2) break
    index++
  }
  return index
}
