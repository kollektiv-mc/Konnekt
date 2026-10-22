import { describe, it, expect } from 'vitest'
import { edgePath, edgeWaypoints, insertWaypoint, withWaypoints } from './edgeGeometry'

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
