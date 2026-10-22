import { STATUS_DEFAULTS } from '../styles/tokens'

/*
 * The geometry and timeline of the startup splash: the Konnekt mark
 * (docs/brand/README.md) built up in motion. The block spins in as a real
 * cube seen from the isometric angle, and the node flies one lap of the orbit
 * drawing it, so the last frame is the static mark exactly.
 *
 * Everything is in the mark's own 24-unit grid; the numbers are those of
 * docs/brand/mark-on-dark.svg.
 */

export type Point = readonly [number, number]

const CUBE = { cx: 12, cy: 11.16, r: 6.81 }
export const ORBIT = { cx: 12, cy: 13.2056, rx: 9.6008, ry: 5.5396 }
export const STROKE = 1.8
export const GAP = 1.1
export const NODE_R = 1.9

/** The node's resting place on the orbit: 150°, front left. */
const NODE_T = (150 * Math.PI) / 180

/*
 * The brand faces, by the design sheet's colour table: accent, then success
 * as the dark theme and the light theme define it. They are the mark's
 * colours rather than roles, so a skin's accent does not reach them.
 */
export const FACE = {
  top: STATUS_DEFAULTS.dark.accent,
  left: STATUS_DEFAULTS.dark.success,
  right: STATUS_DEFAULTS.light.success,
}

// The isometric view: looking down at atan(1/√2), turned 45° about the
// vertical axis. A unit cube seen that way projects to a regular hexagon whose
// radius is √(8/3) half-edges.
const ELEVATION = Math.atan(1 / Math.SQRT2)
const REST_AZIMUTH = Math.PI / 4
const HEX_SCALE = CUBE.r / Math.sqrt(8 / 3)

// Corners of a cube of half-edge 1, y up, and its four sides and top as
// corner indices in order around each face. The bottom never faces the view.
const CORNERS: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, -1, 1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, 1, -1],
  [1, 1, 1],
  [-1, 1, 1],
]
const TOP = [4, 5, 6, 7]
const SIDES: readonly { corners: readonly number[]; normal: readonly [number, number] }[] = [
  { corners: [1, 2, 6, 5], normal: [1, 0] },
  { corners: [3, 0, 4, 7], normal: [-1, 0] },
  { corners: [2, 3, 7, 6], normal: [0, 1] },
  { corners: [0, 1, 5, 4], normal: [0, -1] },
]

export interface CubeFace {
  points: Point[]
  fill: string
}

export interface CubeView {
  /** The block's outline, which carries the gap and the base fill. */
  hull: Point[]
  faces: CubeFace[]
}

/**
 * The block turned to `azimuth` (radians; the mark rests at π/4) and lowered
 * by `drop` units. Sides are shaded by how far they face left or right, so a
 * side turning through the front passes between the two side greens.
 */
export function cubeView(azimuth: number, drop: number): CubeView {
  const cos = Math.cos(azimuth)
  const sin = Math.sin(azimuth)
  const project = ([x, y, z]: readonly [number, number, number]): Point => {
    const vx = x * cos - z * sin
    const vz = x * sin + z * cos
    const sy = -y * Math.cos(ELEVATION) + vz * Math.sin(ELEVATION)
    return [CUBE.cx + vx * HEX_SCALE, CUBE.cy + sy * HEX_SCALE + drop]
  }
  const projected = CORNERS.map(project)
  const faces: CubeFace[] = []
  for (const side of SIDES) {
    const [nx, nz] = side.normal
    if (nx * sin + nz * cos <= 1e-9) continue
    const facing = nx * cos - nz * sin
    // -√½ is the left side at rest and +√½ the right one.
    const k = Math.min(1, Math.max(0, (facing + Math.SQRT1_2) / (2 * Math.SQRT1_2)))
    faces.push({
      points: side.corners.map((i) => projected[i]),
      fill: mix(FACE.left, FACE.right, k),
    })
  }
  faces.push({ points: TOP.map((i) => projected[i]), fill: FACE.top })
  return { hull: convexHull(projected), faces }
}

/** A point on the orbit at parameter `t`: 0 is the right end, π/2 the front. */
export function orbitPoint(t: number): Point {
  return [ORBIT.cx + ORBIT.rx * Math.cos(t), ORBIT.cy + ORBIT.ry * Math.sin(t)]
}

/**
 * The orbit drawn from parameter `from` to `to`, as a path. An arc's centre is
 * re-derived from its end points, so they carry full precision: two decimals
 * put visible steps where a nearly half arc meets the rest of the ring.
 */
export function orbitPath(from: number, to: number): string {
  const span = to - from
  if (span <= 0) return ''
  if (span >= 2 * Math.PI - 1e-6) {
    const [ax, ay] = orbitPoint(from)
    const [bx, by] = orbitPoint(from + Math.PI)
    const arc = (x: number, y: number) => `A${ORBIT.rx} ${ORBIT.ry} 0 1 1 ${x} ${y}`
    return `M${ax} ${ay}${arc(bx, by)}${arc(ax, ay)}Z`
  }
  const [ax, ay] = orbitPoint(from)
  const [bx, by] = orbitPoint(to)
  return `M${ax} ${ay}A${ORBIT.rx} ${ORBIT.ry} 0 ${span > Math.PI ? 1 : 0} 1 ${bx} ${by}`
}

/**
 * Everything but the node's disc, as a clip path for the orbit's front. The
 * node goes behind the block on the orbit's centre line, but the front pass
 * reaches above that line, so near either end a node just gone behind sits
 * partly under it and would be cut flat. The disc is a second subpath, a hole
 * under the even-odd clip rule; the front pass's own clips are rects, and a
 * clip cannot both cut a hole and stop at an edge the hole crosses.
 */
export function exceptDisc({ x, y, r }: { x: number; y: number; r: number }): string {
  return `M-4 -4h32v32h-32zM${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`
}

/** Milliseconds: when each part starts and how long it runs. */
export const SPLASH_MS = {
  /** The block's turn; its quint ease has it still by the time the node lands. */
  cube: 1000,
  cubeFadeIn: 200,
  orbitStart: 120,
  orbit: 733,
  /** The finished mark holds, then the overlay fades. */
  fadeStart: 1200,
  fade: 250,
  /** Under reduced motion: the finished mark, held and faded. */
  still: 600,
}

// The block turns half a revolution on its way in, and rises this far.
const SPIN = Math.PI
const RISE = 3
// The node's lap as a share of its time: speeding up until ACCEL, at full
// speed until BRAKE, then slowing to rest on an ease-out of power LANDING.
// A power of 2, even braking, reads as stopping short; 3 lets it drift in.
const ACCEL = 0.2
const BRAKE = 0.4
const LANDING = 3

export interface SplashFrame {
  azimuth: number
  drop: number
  cubeOpacity: number
  /** The orbit is drawn from `orbitFrom` to `nodeT`, where the node is. */
  orbitFrom: number
  nodeT: number
  nodeScale: number
}

/** The mark `ms` into the splash. Past the end it is the static mark. */
export function splashFrame(ms: number): SplashFrame {
  const c = clamp01(ms / SPLASH_MS.cube)
  const o = clamp01((ms - SPLASH_MS.orbitStart) / SPLASH_MS.orbit)
  const start = NODE_T - 2 * Math.PI
  return {
    azimuth: REST_AZIMUTH - SPIN * (1 - easeOutQuint(c)),
    drop: RISE * (1 - easeOutQuint(c)),
    cubeOpacity: clamp01(ms / SPLASH_MS.cubeFadeIn),
    orbitFrom: start,
    nodeT: start + 2 * Math.PI * accelCruiseBrake(o),
    nodeScale: easeOutCubic(clamp01((ms - SPLASH_MS.orbitStart) / 200)),
  }
}

/** The static mark, for reduced motion and the last frame. */
export const RESTING_FRAME = splashFrame(SPLASH_MS.cube + SPLASH_MS.orbitStart + SPLASH_MS.orbit)

/*
 * The splash mounts in the same frame as the dashboard, whose first render and
 * first data arrive as a burst of long tasks in the next few hundred
 * milliseconds. Played from mount, the animation spends that burst skipping
 * ahead in jumps. So its clock holds at zero, on a blank overlay, until frames
 * have run on time for a while, and once running never advances by more than
 * a slow frame: a late frame then pauses the motion instead of jumping it.
 */
// Two 60Hz frames: a frame within it is on time, and once running the
// timeline advances by no more than it.
const SLOW_FRAME_MS = 34
const CALM_FRAMES = 6
const MAX_HOLD_MS = 700

/**
 * A clock for the splash timeline, fed each frame's rAF timestamp. Returns the
 * timeline's milliseconds, or -1 while it is still holding for the start.
 */
export function splashClock(): (now: number) => number {
  let last: number | undefined
  let held = 0
  let calm = 0
  let ms = -1
  return (now) => {
    const step = last === undefined ? 0 : now - last
    last = now
    if (ms < 0) {
      held += step
      calm = step > 0 && step <= SLOW_FRAME_MS ? calm + 1 : 0
      if (calm >= CALM_FRAMES || held >= MAX_HOLD_MS) ms = 0
      return ms
    }
    ms += Math.min(step, SLOW_FRAME_MS)
    return ms
  }
}

function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (pts: Point[]) => {
    const out: Point[] = []
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-9)
        out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

function mix(a: string, b: string, k: number): string {
  const ca = rgb(a)
  const cb = rgb(b)
  const channel = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * k)
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function easeOutCubic(x: number): number {
  return 1 - (1 - x) ** 3
}

function easeOutQuint(x: number): number {
  return 1 - (1 - x) ** 5
}

// The node's lap: even acceleration from rest, a stretch at full speed, then
// an ease-out to rest. The full speed is the one that makes the lap end at 1,
// and each phase starts at the speed the last one ended on, so no kink shows.
function accelCruiseBrake(x: number): number {
  const v = 1 / (BRAKE - ACCEL / 2 + (1 - BRAKE) / LANDING)
  if (x <= ACCEL) return (v * x * x) / (2 * ACCEL)
  if (x <= BRAKE) return v * (x - ACCEL / 2)
  const tail = 1 - BRAKE
  return (
    v * (BRAKE - ACCEL / 2) + ((v * tail) / LANDING) * (1 - (1 - (x - BRAKE) / tail) ** LANDING)
  )
}
