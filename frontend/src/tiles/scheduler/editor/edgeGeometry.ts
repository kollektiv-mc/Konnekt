// Pure geometry for the scheduler's wires: a straight line, or a polyline
// through the corner points (waypoints) the author has added, or a smooth curve
// through the same points (#692). Deliberately free
// of @xyflow imports so graphMapping, which the whole editor leans on, can read
// waypoints without pulling the library into a module that does not need it.

import type { Point } from '../../../lib/sortable'

// How far a corner is rounded off, in canvas units. Clamped per corner to half
// of each adjoining segment, so two close corners never overshoot each other.
export const CORNER_RADIUS = 8

// Waypoints travel on `edge.data.waypoints` (the models.Edge field in the
// editor's own shape). Read defensively: data is an untyped record and a corner
// that is not a pair of finite numbers would put NaN into the path.
export function edgeWaypoints(data: unknown): Point[] {
  const raw = (data as { waypoints?: unknown } | undefined)?.waypoints
  if (!Array.isArray(raw)) return []
  const out: Point[] = []
  for (const p of raw) {
    const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown }
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      out.push({ x, y })
    }
  }
  return out
}

// `data` with its waypoints replaced. An empty list removes the key, so an edge
// whose last corner was deleted is indistinguishable from one that never had any.
export function withWaypoints(
  data: Record<string, unknown> | undefined,
  waypoints: Point[],
): Record<string, unknown> {
  const next = { ...data }
  if (waypoints.length > 0) next.waypoints = waypoints
  else delete next.waypoints
  return next
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100)

// An SVG path from `points[0]` to the last point. Two points is the straight
// line; more are joined by lines with a quadratic curve rounding each corner.
export function edgePath(points: Point[], radius = CORNER_RADIUS): string {
  const first = points[0]
  if (!first) return ''
  let d = `M${fmt(first.x)},${fmt(first.y)}`
  for (let i = 1; i < points.length; i++) {
    const cur = points[i]
    const next = points[i + 1]
    if (!next) {
      d += ` L${fmt(cur.x)},${fmt(cur.y)}`
      break
    }
    const prev = points[i - 1]
    const dIn = Math.hypot(prev.x - cur.x, prev.y - cur.y)
    const dOut = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, dIn / 2, dOut / 2)
    if (r < 0.5) {
      d += ` L${fmt(cur.x)},${fmt(cur.y)}`
      continue
    }
    const inX = cur.x + ((prev.x - cur.x) / dIn) * r
    const inY = cur.y + ((prev.y - cur.y) / dIn) * r
    const outX = cur.x + ((next.x - cur.x) / dOut) * r
    const outY = cur.y + ((next.y - cur.y) / dOut) * r
    d += ` L${fmt(inX)},${fmt(inY)} Q${fmt(cur.x)},${fmt(cur.y)} ${fmt(outX)},${fmt(outY)}`
  }
  return d
}

// The shortest a curve's horizontal lead off a port may be, so a corner stacked
// right above or below a port still gets a visible run out of it rather than a
// cusp. Capped per segment at half its length, like the corner radius above.
const MIN_LEAD = 16

// How far a control point sits from its port along the horizontal, for a gap of
// `dx` between the two ends of the segment: half the gap going forward, which
// is what React Flow's own bezier does, and a square-root growth when the
// target lies behind the source, so a backwards wire loops out and returns
// without a lead that grows with the distance.
function controlOffset(dx: number): number {
  return dx >= 0 ? dx / 2 : 0.25 * 25 * Math.sqrt(-dx)
}

// A unit vector along (dx, dy), or the zero vector for a zero length.
function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy)
  return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len }
}

// An SVG path from `points[0]` to the last point that is smooth everywhere and
// leaves the first and enters the last horizontally, so two wires from one
// output part from the port itself instead of sharing a run. It is a chain of
// cubic beziers, one per segment, through every point in between:
//
// - at an interior point both neighbouring segments take the direction from the
//   previous point to the next, so the curve has no corner there (what a
//   Catmull-Rom spline does), and the handle on each side is a third of its own
//   segment, which keeps a short segment next to a long one from overshooting;
// - at the two ends the handle is horizontal and sized like React Flow's
//   default bezier, so a wire with no corners is that bezier.
export function curvedEdgePath(points: Point[]): string {
  const first = points[0]
  if (!first) return ''
  let d = `M${fmt(first.x)},${fmt(first.y)}`
  const last = points.length - 1
  // A segment that ends at a corner rather than at the other port takes the
  // bezier offset floored so it stays visible and capped so it never runs past
  // the middle of the segment; one that runs port to port takes it as it is.
  const lead = (dx: number, len: number) =>
    last === 1 ? controlOffset(dx) : Math.min(Math.max(controlOffset(dx), MIN_LEAD), len / 2)
  for (let i = 0; i < last; i++) {
    const a = points[i]
    const b = points[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) continue

    let c1: Point = { x: a.x + lead(b.x - a.x, len), y: a.y }
    if (i > 0) {
      const dir = unit(b.x - points[i - 1].x, b.y - points[i - 1].y)
      c1 = { x: a.x + (dir.x * len) / 3, y: a.y + (dir.y * len) / 3 }
    }
    let c2: Point = { x: b.x - lead(b.x - a.x, len), y: b.y }
    if (i + 1 < last) {
      const dir = unit(points[i + 2].x - a.x, points[i + 2].y - a.y)
      c2 = { x: b.x - (dir.x * len) / 3, y: b.y - (dir.y * len) / 3 }
    }
    d += ` C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(b.x)},${fmt(b.y)}`
  }
  return d
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// The waypoint list with `at` inserted into whichever segment of
// source -> ...waypoints -> target lies nearest to it, so the new corner lands
// between the two points it should sit between rather than at the end.
export function insertWaypoint(
  source: Point,
  waypoints: Point[],
  target: Point,
  at: Point,
): Point[] {
  const points = [source, ...waypoints, target]
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const dist = distanceToSegment(at, points[i], points[i + 1])
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return [...waypoints.slice(0, best), at, ...waypoints.slice(best)]
}
