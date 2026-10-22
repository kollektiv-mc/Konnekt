import { describe, expect, it } from 'vitest'
import { FACE_GLOW, faceIntensities } from './faceGlow'

describe('FACE_GLOW', () => {
  it('has one scale per cube face', () => {
    expect(FACE_GLOW).toHaveLength(6)
  })

  it('averages to 1, so the cube is as bright overall as a flat one', () => {
    const mean = FACE_GLOW.reduce((sum, s) => sum + s, 0) / FACE_GLOW.length
    expect(mean).toBeCloseTo(1, 10)
  })

  it('gives opposite faces different scales', () => {
    for (let axis = 0; axis < 6; axis += 2) {
      expect(FACE_GLOW[axis]).not.toBe(FACE_GLOW[axis + 1])
    }
  })

  it('keeps every face lit and the spread subtle', () => {
    expect(Math.min(...FACE_GLOW)).toBeGreaterThan(0.6)
    expect(Math.max(...FACE_GLOW)).toBeLessThan(1.3)
  })
})

describe('faceIntensities', () => {
  it('scales the base intensity per face', () => {
    expect(faceIntensities(2, [1, 0.5])).toEqual([2, 1])
  })

  it('uses the default face scales', () => {
    expect(faceIntensities(1.2)).toHaveLength(6)
    expect(faceIntensities(1.2)[0]).toBeCloseTo(1.2 * FACE_GLOW[0], 12)
  })
})
