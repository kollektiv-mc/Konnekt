import { describe, expect, it } from 'vitest'
import { MAX_DELTA, MOTION, clampDelta, dampFactor } from './motion'

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
    expect(dampFactor(MOTION.CAM_LAMBDA, 0)).toBe(0)
    expect(dampFactor(MOTION.CAM_LAMBDA, 100)).toBeCloseTo(1, 10)
  })

  it('matches 1 - e^(-lambda dt)', () => {
    expect(dampFactor(4.5, 0.016)).toBeCloseTo(1 - Math.exp(-4.5 * 0.016), 12)
  })

  it('is bounded for a clamped delta, so one frame cannot overshoot', () => {
    expect(dampFactor(MOTION.CAM_LAMBDA, clampDelta(5))).toBeLessThan(0.2)
  })
})
