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
