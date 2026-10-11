import * as THREE from 'three'

// Points sampled around the orbit, and the halving steps of the search. 48
// samples put neighbours under 8 degrees apart, finer than a body's own width.
const SAMPLES = 48
const STEPS = 24

const view = new THREE.Vector3()
const point = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3()
const center = new THREE.Vector3()

// Whether a sphere of radius `pad`, centred on `center`, lies inside the
// viewport shrunk by `margin` (a fraction of each half-axis). Its silhouette
// is approximated by the centre offset along the camera's own right and up.
function sphereInView(
  camera: THREE.Camera,
  center: THREE.Vector3,
  pad: number,
  limit: number,
): boolean {
  for (const [axis, sign] of [
    [right, 1],
    [right, -1],
    [up, 1],
    [up, -1],
  ] as const) {
    point.copy(center).addScaledVector(axis, pad * sign)
    view.copy(point).applyMatrix4(camera.matrixWorldInverse)
    if (view.z >= 0) return false // behind the camera
    view.applyMatrix4(camera.projectionMatrix)
    if (Math.abs(view.x) > limit || Math.abs(view.y) > limit) return false
  }
  return true
}

function orbitInView(
  camera: THREE.Camera,
  scale: number,
  orbitRX: number,
  orbitRZ: number,
  pad: number,
  limit: number,
): boolean {
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2
    center.set(Math.cos(a) * orbitRX * scale, 0, Math.sin(a) * orbitRZ * scale)
    if (!sphereInView(camera, center, pad * scale, limit)) return false
  }
  return true
}

// The largest scale in [min, max] at which a body of radius `pad` stays wholly
// on screen anywhere on an elliptical orbit of radii orbitRX/orbitRZ around the
// origin, with `margin` of each half-viewport left clear. Measured by projecting
// through `camera` (posed, with its matrices current), because the visible width
// of a tilted view depends on depth: a ground-plane bounding box of the viewport
// takes the far edge's width for the whole orbit and lets a planet at its side
// run off. Returns min when even min does not fit.
export function fitOrbitScale(
  camera: THREE.Camera,
  orbitRX: number,
  orbitRZ: number,
  pad: number,
  margin: number,
  min: number,
  max: number,
): number {
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
  const limit = 1 - margin
  if (orbitInView(camera, max, orbitRX, orbitRZ, pad, limit)) return max
  let lo = min
  let hi = max
  for (let i = 0; i < STEPS; i++) {
    const mid = (lo + hi) / 2
    if (orbitInView(camera, mid, orbitRX, orbitRZ, pad, limit)) lo = mid
    else hi = mid
  }
  return lo
}
