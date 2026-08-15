---
paths:
  - "frontend/src/tiles/**"
  - "frontend/src/lib/gridSizing.ts"
  - "frontend/src/Dashboard.tsx"
---

# Tile system

Adding a new tile:
1. Create `frontend/src/tiles/MyTile/index.tsx` and `types.ts`
2. Register it in `frontend/src/tiles/registry.ts` with `id`, `label`, `icon`,
   optionally `maximizable`, and `component` — extend this file, never
   restructure it. There is no sizing decision to make: every tile shares the
   same size (see below).
3. No changes to core layout system required

Every tile is the same size — one shared default, and one shared min/max
resize range, from `lib/gridSizing.ts`'s `TILE_SIZE`/`TILE_MIN`/`TILE_MAX`.
This is deliberate, not a placeholder: it removes an entire class of
per-tile-sizing code (what size should a dragged-in tile become at this
spot?) that turned out to be where the real bugs lived — see
`agent_docs/HEALTH_LOG.md`'s "crate-drag placement, rebuilt" entry.

The grid uses `GridLayout` + `useContainerWidth` from react-grid-layout's
modern (non-`/legacy`) API, configured with `gridSizing.ts`'s
`GRID_COMPACTOR` — react-grid-layout's own `verticalCompactor`, its default
and best-tested mode. A tile always floats to the topmost open row; nothing
rests at an arbitrary row the way a `compactType: null` free-placement grid
would. That trade was made on purpose after `null` compaction proved to have
real, upstream-confirmed collision and gap bugs in react-grid-layout itself
(same entry as above) — with every tile the same size, "floats to the top"
is a much smaller loss than it would be with varied tile sizes.

The crate-drag ghost is a plain, non-`static` entry appended to the same
layout array real tiles render from, then run through `GRID_COMPACTOR`
**in `Dashboard.tsx`'s own code** before being handed to `<GridLayout>` —
not left to react-grid-layout's internal (invisible-to-us) compaction alone.
`compact()` is a pure function of its input, so compacting the same array
twice (once here, once again internally for display) is idempotent; doing it
here first is what lets the on-drop commit read the *actual* landing
positions back out via a ref, rather than recomputing them separately at
`mouseup` and risking the two disagreeing.

Assembling that array is `gridSizing.ts`'s `withGhost`, and the ordering step
in it is load-bearing: it moves whatever the ghost overlaps *below* the ghost
before compacting. Compaction resolves contention by sort order (y, then x),
so without that step a tile even one column to the ghost's left wins the cell
and the ghost is the one shoved down — which made the right-hand side of a row
unreachable from the crate whenever a tile straddled the middle columns, while
dragging an already-placed tile onto the same cell worked fine. The ghost is
the item under the user's hand, so it takes the cell and the occupants yield,
matching what a native tile drag already did. The compactor still performs
every bit of the actual collision resolution.
