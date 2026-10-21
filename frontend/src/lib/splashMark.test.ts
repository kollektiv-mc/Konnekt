import { describe, expect, it } from 'vitest'
import {
  cubeView,
  FACE,
  orbitPath,
  orbitPoint,
  RESTING_FRAME,
  SPLASH_MS,
  splashFrame,
} from './splashMark'

// docs/brand/mark-on-dark.svg, to the two decimals it is written with.
const HEXAGON = [
  [12, 4.36],
  [17.9, 7.76],
  [17.9, 14.57],
  [12, 17.97],
  [6.1, 14.57],
  [6.1, 7.76],
]

const near = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02

describe('splash mark', () => {
  it('comes to rest as the static mark', () => {
    const { hull, faces } = cubeView(RESTING_FRAME.azimuth, RESTING_FRAME.drop)
    expect(hull).toHaveLength(6)
    for (const corner of HEXAGON) expect(hull.some((p) => near(p, corner))).toBe(true)
    expect(faces.map((f) => f.fill)).toEqual(['rgb(22 163 74)', 'rgb(34 197 94)', FACE.top])
    expect(near(orbitPoint(RESTING_FRAME.nodeT), [3.69, 15.98])).toBe(true)
    expect(RESTING_FRAME.cubeOpacity).toBe(1)
    expect(RESTING_FRAME.nodeScale).toBe(1)
  })

  it('draws the whole orbit by the time the node lands', () => {
    const end = splashFrame(SPLASH_MS.orbitStart + SPLASH_MS.orbit)
    expect(end.nodeT - end.orbitFrom).toBeCloseTo(2 * Math.PI)
    expect(orbitPath(end.orbitFrom, end.nodeT)).toMatch(/Z$/)
    expect(orbitPath(0, 0)).toBe('')
  })

  it('starts with the block hidden, low and turned', () => {
    const first = splashFrame(0)
    expect(first.cubeOpacity).toBe(0)
    expect(first.drop).toBeGreaterThan(0)
    expect(first.azimuth).not.toBeCloseTo(RESTING_FRAME.azimuth)
    expect(first.nodeScale).toBe(0)
  })

  it('shows a side and the top at every turn', () => {
    for (let a = 0; a < 2 * Math.PI; a += 0.1) {
      const { faces, hull } = cubeView(a, 0)
      expect(faces.length).toBeGreaterThanOrEqual(2)
      expect(faces.length).toBeLessThanOrEqual(3)
      expect(hull.length).toBeGreaterThanOrEqual(4)
    }
  })

  it('fades the overlay after the node lands', () => {
    expect(SPLASH_MS.fadeStart).toBeGreaterThan(SPLASH_MS.orbitStart + SPLASH_MS.orbit)
    expect(SPLASH_MS.fadeStart).toBeGreaterThanOrEqual(SPLASH_MS.cube)
    expect(SPLASH_MS.total).toBeGreaterThan(SPLASH_MS.fadeStart)
  })
})
