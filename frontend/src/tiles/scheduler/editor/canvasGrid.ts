// The editor's background grid, in one place so the dots that are drawn and the
// grid that nodes and corner points snap to cannot drift apart. Free of @xyflow
// imports, like edgeGeometry.ts, so the numbers can be read from anywhere.

import type { Point } from '../../../lib/sortable'

// Distance between two dots, in canvas units.
export const GRID_GAP = 20

// The dot's diameter in canvas units (the Background's `size`).
export const GRID_DOT_SIZE = 1

// Where React Flow's Background puts its dots, measured against 12.12.0's
// pattern code and a pixel scan of the rendered canvas: at the middle of each
// cell, half a gap in from the origin and nudged half a dot further because the
// dot is drawn from the cell's corner. So with no offset a node snapped to a
// multiple of the gap sits between four dots rather than on one. Shifting the
// pattern by half a gap plus half a dot puts a dot on every multiple of the gap,
// which is where React Flow's snapping lands.
export const GRID_DOT_OFFSET = GRID_GAP / 2 + GRID_DOT_SIZE / 2

// React Flow's `snapGrid`, equal to the dots' spacing on both axes.
export const SNAP_GRID: [number, number] = [GRID_GAP, GRID_GAP]

// `p` moved to the nearest grid point, the same rounding React Flow applies to a
// dragged node (`|| 0` keeps a tiny negative from becoming -0).
export function snapPoint(p: Point, gap = GRID_GAP): Point {
  return { x: Math.round(p.x / gap) * gap || 0, y: Math.round(p.y / gap) * gap || 0 }
}
