import type { Vector3 } from 'three'

// Every damping rate in the worlds scene, in one table. The *_LAMBDA values are
// MathUtils.damp / exp-decay lambdas (per second): bigger settles faster. They are
// feel tuning for this one scene, not design tokens (tokens.source.json is vendored
// and shared).
export const MOTION = {
  // Camera
  // Eye + target follow, the single spring for every camera transition (seconds,
  // see springDamp). 0.45 reaches 95% of the way in about 1.07s, from rest.
  CAM_SMOOTH_TIME: 0.45,
  HUD_LAMBDA: 4.5, // view-offset shift for the HUD panel, hand-matched to its 250ms CSS slide
  ZOOM_LAMBDA: 3.2, // zoomRef (0 overview, 1 focused), drives the star fade
  // Galaxy layout
  SCALE_LAMBDA: 6, // zoom-to-fit layout scale
  // Scene entrance
  STAR_ENTRANCE_LAMBDA: 8, // star field fade-in
  SCENE_REVEAL_LAMBDA: 10, // scene content scales 0.82 to 1 on reveal
  // Planets and moons
  PLANET_HOVER_LAMBDA: 10,
  MOON_HOVER_LAMBDA: 10,
  PLANET_ZOOM_LAMBDA: 3.5, // per-planet moon-system scale in/out
  LABEL_DIR_LAMBDA: 5, // moon label direction
  LABEL_OFFSET_LAMBDA: 5, // moon label distance from surface
  // Cube bodies (the Sun now). Constant angular speeds in rad/s, not damps: a slow tumble on two
  // axes, deliberately off the 2:1 so the face the camera sees never settles into a pattern.
  CUBE_SPIN_X: 0.11,
  CUBE_SPIN_Y: 0.17,
} as const

// The OS reduced-motion preference. The scene's one reader, so a body that tumbles asks here
// rather than spelling the query again. jsdom has no matchMedia, hence the optional call.
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false
}

// One frame of a cube's tumble, in place. Under reduced motion the cube holds the pose it has,
// so it stops where it is rather than snapping back to a start angle.
export function advanceTumble(
  rotation: { x: number; y: number },
  delta: number,
  reduced: boolean,
): void {
  if (reduced) return
  const dt = clampDelta(delta)
  rotation.x += MOTION.CUBE_SPIN_X * dt
  rotation.y += MOTION.CUBE_SPIN_Y * dt
}

// Longest frame step the scene will integrate. A stalled tab or long GC pause
// would otherwise hand every damp an enormous delta and teleport the camera.
export const MAX_DELTA = 1 / 30

export function clampDelta(delta: number): number {
  return Math.min(Math.max(delta, 0), MAX_DELTA)
}

// Frame-rate independent exponential approach factor, 1 - e^(-lambda * dt),
// for use with lerp. Equivalent to what MathUtils.damp applies internally.
export function dampFactor(lambda: number, delta: number): number {
  return 1 - Math.exp(-lambda * delta)
}

// One step of a critically damped spring pulling `current` toward `target`, in
// place. `velocity` is the spring's state and must persist between frames.
// Unlike an exponential damp, which leaves at full speed and reads as a snap,
// this starts from rest, eases in and out, and carries its velocity through a
// retarget, so changing focus mid-flight bends the path instead of kinking it.
// The closed-form solution, so it is frame-rate independent for any delta.
export function springDamp(
  current: Vector3,
  target: Vector3,
  velocity: Vector3,
  smoothTime: number,
  delta: number,
): void {
  const omega = 2 / smoothTime
  const decay = Math.exp(-omega * delta)
  for (const axis of ['x', 'y', 'z'] as const) {
    const offset = current[axis] - target[axis]
    const temp = (velocity[axis] + omega * offset) * delta
    velocity[axis] = (velocity[axis] - omega * temp) * decay
    current[axis] = target[axis] + (offset + temp) * decay
  }
}
