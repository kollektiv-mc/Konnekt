// Every damping rate in the worlds scene, in one table. These are MathUtils.damp /
// exp-decay lambdas (per second): bigger settles faster. They are feel tuning for
// this one scene, not design tokens (tokens.source.json is vendored and shared).
export const MOTION = {
  // Camera
  CAM_LAMBDA: 4.5, // eye + target follow, the single time-constant for every camera transition
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
} as const

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
