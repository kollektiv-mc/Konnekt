import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  MAX_DELTA,
  MOTION,
  REDUCED_MOTION_QUERY,
  advanceTumble,
  clampDelta,
  dampFactor,
  prefersReducedMotion,
  springDamp,
} from './motion'

describe('clampDelta', () => {
  it('passes a normal frame through', () => {
    expect(clampDelta(1 / 60)).toBe(1 / 60)
  })

  it('caps a long frame at MAX_DELTA', () => {
    expect(clampDelta(2)).toBe(MAX_DELTA)
    expect(clampDelta(MAX_DELTA)).toBe(MAX_DELTA)
  })

  it('never returns a negative step', () => {
    expect(clampDelta(-0.5)).toBe(0)
  })
})

describe('dampFactor', () => {
  it('is 0 for no time and approaches 1 for a long one', () => {
    expect(dampFactor(MOTION.HUD_LAMBDA, 0)).toBe(0)
    expect(dampFactor(MOTION.HUD_LAMBDA, 100)).toBeCloseTo(1, 10)
  })

  it('matches 1 - e^(-lambda dt)', () => {
    expect(dampFactor(4.5, 0.016)).toBeCloseTo(1 - Math.exp(-4.5 * 0.016), 12)
  })

  it('is bounded for a clamped delta, so one frame cannot overshoot', () => {
    expect(dampFactor(MOTION.HUD_LAMBDA, clampDelta(5))).toBeLessThan(0.2)
  })
})

// Runs the spring from `from` toward a fixed `to` for `seconds` at `fps`.
function fly(from: number, to: number, seconds: number, fps: number) {
  const current = new THREE.Vector3(from, 0, 0)
  const target = new THREE.Vector3(to, 0, 0)
  const velocity = new THREE.Vector3()
  const frames = Math.round(seconds * fps)
  for (let i = 0; i < frames; i++) {
    springDamp(current, target, velocity, MOTION.CAM_SMOOTH_TIME, 1 / fps)
  }
  return { current, velocity }
}

describe('springDamp', () => {
  it('leaves from rest instead of snapping', () => {
    // The first 60fps frame covers a fraction of what the old exponential damp did.
    const spring = fly(0, 1, 1 / 60, 60).current.x
    const exponential = dampFactor(4.5, 1 / 60)
    expect(spring).toBeGreaterThan(0)
    expect(spring).toBeLessThan(exponential / 5)
  })

  it('takes about a second to cover 95% of the way, and settles', () => {
    expect(fly(0, 1, 0.9, 60).current.x).toBeLessThan(0.95)
    expect(fly(0, 1, 1.2, 60).current.x).toBeGreaterThan(0.95)
    const settled = fly(0, 1, 5, 60)
    expect(settled.current.x).toBeCloseTo(1, 4)
    expect(settled.velocity.x).toBeCloseTo(0, 4)
  })

  it('never overshoots a fixed target from rest', () => {
    const current = new THREE.Vector3()
    const target = new THREE.Vector3(1, -2, 3)
    const velocity = new THREE.Vector3()
    for (let i = 0; i < 300; i++) {
      springDamp(current, target, velocity, MOTION.CAM_SMOOTH_TIME, 1 / 60)
      expect(current.x).toBeLessThanOrEqual(1)
      expect(current.y).toBeGreaterThanOrEqual(-2)
      expect(current.z).toBeLessThanOrEqual(3)
    }
  })

  it('lands in the same place whatever the frame rate', () => {
    expect(fly(0, 1, 0.5, 30).current.x).toBeCloseTo(fly(0, 1, 0.5, 144).current.x, 10)
  })

  it('keeps its velocity through a retarget', () => {
    const { current, velocity } = fly(0, 1, 0.3, 60)
    const before = velocity.x
    springDamp(current, new THREE.Vector3(2, 0, 0), velocity, MOTION.CAM_SMOOTH_TIME, 1 / 60)
    expect(velocity.x).toBeGreaterThan(before * 0.9)
  })
})

describe('advanceTumble', () => {
  it('turns both axes by their rate over the step', () => {
    const rot = { x: 0, y: 0 }
    advanceTumble(rot, 1 / 60, false)
    expect(rot.x).toBeCloseTo(MOTION.CUBE_SPIN_X / 60, 12)
    expect(rot.y).toBeCloseTo(MOTION.CUBE_SPIN_Y / 60, 12)
  })

  it('holds the pose it has under reduced motion', () => {
    const rot = { x: 0.3, y: 0.7 }
    advanceTumble(rot, 1 / 60, true)
    expect(rot).toEqual({ x: 0.3, y: 0.7 })
  })

  it('clamps a stalled frame like every other step in the scene', () => {
    const rot = { x: 0, y: 0 }
    advanceTumble(rot, 5, false)
    expect(rot.y).toBeCloseTo(MOTION.CUBE_SPIN_Y * MAX_DELTA, 12)
  })
})

describe('prefersReducedMotion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('reads the reduce query', () => {
    const matchMedia = vi.fn((q: string) => ({ matches: q === REDUCED_MOTION_QUERY }))
    vi.stubGlobal('matchMedia', matchMedia)
    expect(prefersReducedMotion()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })
})
