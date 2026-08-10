import { verticalCompactor } from 'react-grid-layout'

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
