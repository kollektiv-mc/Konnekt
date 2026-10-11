import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fitOrbitScale } from './fit'
import { OVERVIEW_EYE, OVERVIEW_TARGET } from './overview'

function overviewCamera(aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000)
  cam.position.copy(OVERVIEW_EYE)
  cam.lookAt(OVERVIEW_TARGET)
  cam.updateMatrixWorld()
  return cam
}

// The NDC extent of the body's silhouette at every sampled orbit angle, the
// largest absolute x and y reached.
function reach(cam: THREE.Camera, scale: number, rx: number, rz: number, pad: number) {
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
  let x = 0
  let y = 0
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2
    const c = new THREE.Vector3(Math.cos(a) * rx * scale, 0, Math.sin(a) * rz * scale)
    for (const [axis, sign] of [
      [right, 1],
      [right, -1],
      [up, 1],
      [up, -1],
    ] as const) {
      const p = c
        .clone()
        .addScaledVector(axis, pad * scale * sign)
        .project(cam)
      x = Math.max(x, Math.abs(p.x))
      y = Math.max(y, Math.abs(p.y))
    }
  }
  return { x, y }
}

// One world, the screenshot's case: orbit 7.3 by 4.0, a mid-sized planet.
const RX = 7.3
const RZ = RX * 0.55
const PAD = 0.4 * 1.51 * 1.05 + 0.1

describe('fitOrbitScale', () => {
  for (const aspect of [1.5, 1, 0.6, 2.4]) {
    it(`keeps the whole planet on screen at aspect ${aspect}, and no further out than needed`, () => {
      const cam = overviewCamera(aspect)
      const s = fitOrbitScale(cam, RX, RZ, PAD, 0.08, 0.05, 5)
      const at = reach(cam, s, RX, RZ, PAD)
      expect(Math.max(at.x, at.y)).toBeLessThanOrEqual(0.92 + 0.005)
      // Tight: one step larger and something crosses the margin.
      const over = reach(cam, s * 1.02, RX, RZ, PAD)
      expect(Math.max(over.x, over.y)).toBeGreaterThan(0.92)
    })
  }

  it('returns max when even max fits', () => {
    expect(fitOrbitScale(overviewCamera(1.5), 0.5, 0.3, 0.1, 0.08, 0.25, 1.6)).toBe(1.6)
  })

  it('returns min when even min does not fit', () => {
    expect(fitOrbitScale(overviewCamera(1.5), 500, 300, 1, 0.08, 0.25, 1.6)).toBe(0.25)
  })

  it('zooms out further for a bigger planet on the same orbit', () => {
    const cam = overviewCamera(1.5)
    const small = fitOrbitScale(cam, RX, RZ, 0.2, 0.08, 0.05, 5)
    const big = fitOrbitScale(cam, RX, RZ, 1, 0.08, 0.05, 5)
    expect(big).toBeLessThan(small)
  })
})
