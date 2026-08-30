import type { TileProps } from '../../types'
import { Vitals } from './Vitals'
import { OverviewPanel } from './OverviewPanel'

/**
 * Two different jobs at two sizes.
 *
 * Compact is the server's vitals, unchanged from when this tile was called
 * Stats: a status pill and three readouts, straight out of `useServerStore`.
 * Maximized is a roll-up of every other tile's compact summary — the state of
 * the whole server now, as against the Performance tile's one process over
 * time. #211 is the record of why the tile could not simply be made
 * maximizable as it stood: a bigger Stats screen would have been a
 * near-duplicate of Performance's compact view.
 *
 * The split is what keeps the roll-up affordable. Every summary in it fetches
 * on mount, so hanging them off `maximized` means they cost nothing until the
 * user actually asks for the panel, rather than firing a burst of Go calls
 * whenever Overview happens to sit on the canvas — which, on a fresh install,
 * it does (`lib/constants.ts`'s `ALL_TILE_IDS`).
 *
 * `serverId` reaches the summaries through the panel; the vitals themselves
 * are a pure reader of the shared store, hydrated once in App by
 * `hooks/useServerStatus.ts`.
 */
export function OverviewTile({ serverId, maximized }: TileProps) {
  if (!maximized) return <Vitals />
  return <OverviewPanel serverId={serverId} />
}
