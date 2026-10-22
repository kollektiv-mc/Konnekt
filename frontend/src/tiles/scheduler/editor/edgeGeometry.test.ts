import { describe, it, expect } from 'vitest'
import {
  curvedEdgePath,
  edgePath,
  edgeWaypoints,
  insertWaypoint,
  withWaypoints,
} from './edgeGeometry'
import type { Point } from '../../../lib/sortable'

const S = { x: 0, y: 0 }
const T = { x: 100, y: 0 }

describe('edgePath', () => {
  it('draws a straight line when there are no corners', () => {
    expect(edgePath([S, T])).toBe('M0,0 L100,0')
  })

  it('rounds a single corner with a quadratic curve through it', () => {
    expect(edgePath([S, { x: 50, y: 0 }, { x: 50, y: 50 }], 8)).toBe('M0,0 L42,0 Q50,0 50,8 L50,50')
  })

  it('threads several corners in order', () => {
    const d = edgePath([S, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 100, y: 40 }], 0)
    expect(d).toBe('M0,0 L40,0 L40,40 L100,40')
  })

  it('shrinks the radius so a corner never overshoots a short segment', () => {
    // Segment in is 4 long, so the radius clamps to 2 rather than 8.
    expect(edgePath([S, { x: 4, y: 0 }, { x: 4, y: 50 }], 8)).toBe('M0,0 L2,0 Q4,0 4,2 L4,50')
  })

  it('keeps a corner sharp when two points coincide', () => {
    expect(edgePath([S, { x: 0, y: 0 }, T])).toBe('M0,0 L0,0 L100,0')
  })

  it('is empty for no points', () => {
    expect(edgePath([])).toBe('')
  })
})

// One cubic segment of a curvedEdgePath, with its start carried over from the
// segment before so each one is self-contained.
interface Cubic {
  p0: Point
  c1: Point
  c2: Point
  p1: Point
}

function parseCurve(d: string): Cubic[] {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const out: Cubic[] = []
  let cur = { x: nums[0], y: nums[1] }
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const c1 = { x: nums[i], y: nums[i + 1] }
    const c2 = { x: nums[i + 2], y: nums[i + 3] }
    const p1 = { x: nums[i + 4], y: nums[i + 5] }
    out.push({ p0: cur, c1, c2, p1 })
    cur = p1
  }
  return out
}

function at(c: Cubic, t: number): Point {
  const u = 1 - t
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return {
    x: w[0] * c.p0.x + w[1] * c.c1.x + w[2] * c.c2.x + w[3] * c.p1.x,
    y: w[0] * c.p0.y + w[1] * c.c1.y + w[2] * c.c2.y + w[3] * c.p1.y,
  }
}

describe('curvedEdgePath', () => {
  it("is React Flow's default bezier when there are no corners", () => {
    expect(curvedEdgePath([S, { x: 100, y: 100 }])).toBe('M0,0 C50,0 50,100 100,100')
  })

  it('leaves the source and enters the target horizontally', () => {
    const [seg] = parseCurve(curvedEdgePath([S, { x: 200, y: -80 }]))
    expect(seg.c1.y).toBe(seg.p0.y)
    expect(seg.c2.y).toBe(seg.p1.y)
    expect(seg.c1.x).toBeGreaterThan(seg.p0.x)
    expect(seg.c2.x).toBeLessThan(seg.p1.x)
  })

  it('keeps a lead out of the port when the target lies behind the source', () => {
    const [seg] = parseCurve(
      curvedEdgePath([
        { x: 200, y: 0 },
        { x: 100, y: 60 },
      ]),
    )
    expect(seg.c1.x).toBeGreaterThan(200)
    expect(seg.c2.x).toBeLessThan(100)
  })

  it('parts two wires from one output straight away', () => {
    const up = parseCurve(curvedEdgePath([S, { x: 200, y: -60 }]))[0]
    const down = parseCurve(curvedEdgePath([S, { x: 200, y: 60 }]))[0]
    const a = at(up, 0.2)
    const b = at(down, 0.2)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(8)
    // Both leave level, and still ahead of the port rather than stacked on it.
    expect(a.x).toBeGreaterThan(0)
    expect(a.x).toBeCloseTo(b.x)
  })

  it('passes through every corner, in order', () => {
    const corners = [
      { x: 60, y: -40 },
      { x: 140, y: 50 },
    ]
    const segs = parseCurve(curvedEdgePath([S, ...corners, { x: 220, y: 0 }]))
    expect(segs.map((c) => c.p1)).toEqual([...corners, { x: 220, y: 0 }])
    expect(segs[0].p0).toEqual(S)
  })

  it('has no corner at a corner point: both sides leave along one line', () => {
    const w = { x: 100, y: 50 }
    const [first, second] = parseCurve(curvedEdgePath([S, w, { x: 220, y: -30 }]))
    const into = { x: w.x - first.c2.x, y: w.y - first.c2.y }
    const out = { x: second.c1.x - w.x, y: second.c1.y - w.y }
    // The path is rounded to 2 decimals, so compare the angle, not the raw product.
    const sin =
      (into.x * out.y - into.y * out.x) / (Math.hypot(into.x, into.y) * Math.hypot(out.x, out.y))
    expect(sin).toBeCloseTo(0, 3)
    expect(into.x * out.x + into.y * out.y).toBeGreaterThan(0)
  })

  it('keeps the end handles horizontal with corners too', () => {
    const segs = parseCurve(curvedEdgePath([S, { x: 100, y: 80 }, { x: 200, y: 0 }]))
    expect(segs[0].c1.y).toBe(0)
    expect(segs[1].c2.y).toBe(0)
  })

  it('still leaves a visible run when a corner sits straight above the port', () => {
    const [seg] = parseCurve(curvedEdgePath([S, { x: 0, y: -100 }, { x: 100, y: -100 }]))
    expect(seg.c1.x).toBeGreaterThan(0)
  })

  it('skips a corner that sits on top of the previous point', () => {
    const segs = parseCurve(curvedEdgePath([S, S, { x: 100, y: 40 }]))
    expect(segs).toHaveLength(1)
  })

  it('is just the start for one point and empty for none', () => {
    expect(curvedEdgePath([S])).toBe('M0,0')
    expect(curvedEdgePath([])).toBe('')
  })
})

describe('edgeWaypoints', () => {
  it('reads corner points off edge data', () => {
    expect(edgeWaypoints({ waypoints: [{ x: 1, y: 2 }] })).toEqual([{ x: 1, y: 2 }])
  })

  it('is empty for an edge saved before corners existed', () => {
    expect(edgeWaypoints(undefined)).toEqual([])
    expect(edgeWaypoints({ kind: 'control' })).toEqual([])
  })

  it('drops entries that are not a pair of finite numbers', () => {
    const data = { waypoints: [{ x: 1, y: 2 }, { x: NaN, y: 0 }, null, { x: '3', y: 4 }, {}] }
    expect(edgeWaypoints(data)).toEqual([{ x: 1, y: 2 }])
  })
})

describe('withWaypoints', () => {
  it('sets the list and keeps the rest of the data', () => {
    expect(withWaypoints({ kind: 'data' }, [{ x: 1, y: 1 }])).toEqual({
      kind: 'data',
      waypoints: [{ x: 1, y: 1 }],
    })
  })

  it('removes the key when the list empties, so no empty list is persisted', () => {
    const next = withWaypoints({ kind: 'data', waypoints: [{ x: 1, y: 1 }] }, [])
    expect('waypoints' in next).toBe(false)
    expect(next.kind).toBe('data')
  })
})

describe('insertWaypoint', () => {
  it('adds the only corner to a straight edge', () => {
    expect(insertWaypoint(S, [], T, { x: 50, y: 10 })).toEqual([{ x: 50, y: 10 }])
  })

  it('places a corner in the segment nearest the cursor', () => {
    const wp = [
      { x: 50, y: 0 },
      { x: 50, y: 100 },
    ]
    // Near the middle segment (50,0 -> 50,100) goes between the two.
    expect(insertWaypoint(S, wp, { x: 100, y: 100 }, { x: 52, y: 50 })).toEqual([
      { x: 50, y: 0 },
      { x: 52, y: 50 },
      { x: 50, y: 100 },
    ])
    // Near the last segment goes after both.
    expect(insertWaypoint(S, wp, { x: 100, y: 100 }, { x: 80, y: 99 })).toEqual([
      ...wp,
      { x: 80, y: 99 },
    ])
    // Near the first segment goes before both.
    expect(insertWaypoint(S, wp, { x: 100, y: 100 }, { x: 20, y: 1 })).toEqual([
      { x: 20, y: 1 },
      ...wp,
    ])
  })
})
