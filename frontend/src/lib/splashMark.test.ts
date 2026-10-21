import { describe, expect, it } from 'vitest'
import {
  cubeView,
  FACE,
  orbitPath,
  orbitPoint,
  RESTING_FRAME,
  SPLASH_MS,
  splashClock,
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

  it('eases the node in and out of its lap', () => {
    const at = (ms: number) => splashFrame(SPLASH_MS.orbitStart + ms).nodeT
    const land = SPLASH_MS.orbit
    const mid = at(land / 2 + 1) - at(land / 2)
    expect(at(1) - at(0)).toBeLessThan(mid / 10)
    expect(at(land) - at(land - 1)).toBeLessThan(mid / 10)
  })

  it('has the block still by the time the node lands', () => {
    const landing = splashFrame(SPLASH_MS.orbitStart + SPLASH_MS.orbit)
    // Within a tenth of a degree of rest, which no frame can show.
    expect(Math.abs(landing.azimuth - RESTING_FRAME.azimuth)).toBeLessThan(Math.PI / 1800)
    expect(landing.drop).toBeLessThan(0.01)
  })

  it('fades the overlay after the node lands', () => {
    expect(SPLASH_MS.fadeStart).toBeGreaterThan(SPLASH_MS.orbitStart + SPLASH_MS.orbit)
    expect(SPLASH_MS.fadeStart).toBeGreaterThanOrEqual(SPLASH_MS.cube)
    expect(SPLASH_MS.fade).toBeGreaterThan(0)
  })
})

describe('splash clock', () => {
  const feed = (clock: (now: number) => number, frames: number[]) => frames.map(clock)

  it('holds until frames have run on time for a while', () => {
    const out = feed(splashClock(), [0, 16, 32, 48, 64, 80, 96, 112])
    expect(out.slice(0, 6)).toEqual([-1, -1, -1, -1, -1, -1])
    expect(out.slice(6)).toEqual([0, 16])
  })

  it('starts after a long frame resets the count', () => {
    const out = feed(splashClock(), [0, 16, 32, 232, 248, 264, 280, 296, 312, 328])
    expect(out.at(-2)).toBe(-1)
    expect(out.at(-1)).toBe(0)
  })

  it('stops holding once a busy start has run long', () => {
    const out = feed(splashClock(), [0, 100, 200, 300, 400, 500, 600, 700])
    expect(out.at(-2)).toBe(-1)
    expect(out.at(-1)).toBe(0)
  })

  it('pauses on a late frame rather than jumping', () => {
    const out = feed(splashClock(), [0, 16, 32, 48, 64, 80, 96, 296, 312])
    expect(out.slice(-2)).toEqual([34, 50])
  })
})
