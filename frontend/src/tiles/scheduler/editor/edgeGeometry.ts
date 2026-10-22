// Pure geometry for the scheduler's wires: a straight line, or a polyline
// through the corner points (waypoints) the author has added. Deliberately free
// of @xyflow imports so graphMapping, which the whole editor leans on, can read
// waypoints without pulling the library into a module that does not need it.

export interface Point {
  x: number
  y: number
}

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
