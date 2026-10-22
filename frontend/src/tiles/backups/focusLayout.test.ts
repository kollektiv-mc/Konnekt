import { describe, it, expect } from 'vitest'
import { SPHERE_STROKE_PX, strokeForScale } from './focusLayout'

describe('strokeForScale', () => {
  it('multiplies back to the on-screen width at any scale', () => {
    for (const scale of [0.1, 0.26, 0.4, 1, 2]) {
      expect(strokeForScale(scale) * scale).toBeCloseTo(SPHERE_STROKE_PX)
    }
  })

  it('thickens the stroke as the sphere shrinks', () => {
    expect(strokeForScale(0.26)).toBeGreaterThan(strokeForScale(0.4))
  })

  it('holds a custom on-screen width', () => {
    expect(strokeForScale(0.5, 2)).toBe(4)
  })

  it('falls back to the plain width for a scale that is not positive', () => {
    expect(strokeForScale(0)).toBe(SPHERE_STROKE_PX)
    expect(strokeForScale(-1)).toBe(SPHERE_STROKE_PX)
  })
})
