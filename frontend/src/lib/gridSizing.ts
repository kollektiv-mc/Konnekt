import { verticalCompactor } from 'react-grid-layout'
import type { Layout, LayoutItem } from 'react-grid-layout'

// Single shared compactor — the grid itself and useLayoutStore's load-time
// normalization both import this, so they can never disagree about how a
// layout resolves. react-grid-layout's default, best-tested mode. A prior
// round used `noCompactor` (free placement + push) instead, on the theory
// that it would let a tile rest at an arbitrary row; that mode turned out to
// have real, upstream-confirmed collision/gap bugs (see HEALTH_LOG.md's
// "crate-drag placement, rebuilt" entry) — `moveElementAwayFromCollision`'s
// `compactType === null` branch resolves a collision without recursively
// re-verifying it, so a push cascading into a second collision is left
// overlapping. The `'vertical'` branch recurses back into `moveElement`, so
// it actually cascades correctly.
export const GRID_COMPACTOR = verticalCompactor

// Every tile is this size by default, and can be resized within min..max —
// the same range for every tile, deliberately, so there is no per-tile
// sizing logic left to get wrong (no "what size fits here" question to
// answer during a drag, unlike the sm/md/lg bucket system this replaced).
// `w: 3` tiles two-per-row on the 6-column grid (see constants.ts's COLS).
export const TILE_SIZE = { w: 3, h: 8 } as const
export const TILE_MIN = { w: 2, h: 4 } as const
export const TILE_MAX = { w: 6, h: 16 } as const

/** Whether two grid items occupy any cell in common. */
export function collides(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// The board as it would settle with `ghost` dropped at the cell it currently
// holds. The ghost is the item under the user's hand, so it wins that cell and
// whatever it overlaps yields downward — exactly how an existing tile's
// occupants yield when you drag it over them.
//
// Compaction alone cannot express that. It resolves contention by sort order
// (y, then x), so a tile even one column to the ghost's left always won and the
// ghost was the one shoved below it — which is why a tile straddling the middle
// columns made the whole right-hand side of its row unreachable from the crate,
// while dragging an already-placed tile there worked fine. Moving the losers
// below the ghost first is only what flips that ordering; the compactor still
// does every bit of the actual collision resolution, and pulls the displaced
// tiles back up as far as they legitimately fit afterwards.
export function withGhost(layout: Layout, ghost: LayoutItem, cols: number): LayoutItem[] {
  const yielded = layout.map((l) => (collides(l, ghost) ? { ...l, y: ghost.y + ghost.h } : l))
  return [...GRID_COMPACTOR.compact([...yielded, ghost], cols)]
}
