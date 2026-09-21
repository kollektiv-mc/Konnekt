/**
 * Firefox's wheel-scroll physics, ported.
 *
 * Chromium, and so WebView2, animates every mouse-wheel notch with a fixed
 * ease-out over a fixed duration, so a run of notches is a run of identical
 * little glides that each start from rest. Gecko's `ScrollAnimationMSDPhysics`
 * instead treats the scroll position as a mass on a critically damped spring
 * whose resting point is the destination: a notch moves the resting point, the
 * mass keeps whatever velocity it had, and the spring's stiffness follows the
 * rhythm of the notches (see `chooseSpringConstant`). Stock Firefox ships it
 * off (`general.smoothScroll.msdPhysics.enabled` is Nightly-only); Zen turns
 * it on, and that is the whole difference the two feel like.
 *
 * The constants are Gecko's defaults from `StaticPrefList.yaml`, and the
 * stiffness schedule is `ComputeSpringConstant` verbatim. Where Gecko
 * integrates the spring numerically (`AxisPhysicsModel`), this uses the closed
 * form of the critically damped case, which is exact and needs no timestep.
 * The wheel path only ever asks for a damping ratio of 1, so the general case
 * is not carried.
 *
 * Pure: nothing here touches the DOM. `lib/springScroll.ts` drives it.
 */

/** `general.smoothScroll.msdPhysics.*` defaults, Gecko's `StaticPrefList.yaml`. */
export const MSD_PREFS = {
  /** A gap between notches at or past this is a fresh gesture. */
  continuousMotionMaxDeltaMS: 120,
  /** Stiffness for the first notch of a gesture. */
  motionBeginSpringConstant: 1250,
  /** A gap has to be at least this long before it can count as slowing down. */
  slowdownMinDeltaMS: 12,
  /** ...and at least this many times the previous gap. */
  slowdownMinDeltaRatio: 1.3,
  /** Stiffness once the notches are slowing down: settle quickly. */
  slowdownSpringConstant: 2000,
  /** Stiffness for a steady run of notches. */
  regularSpringConstant: 1000,
} as const

export type MsdPrefs = typeof MSD_PREFS

/**
 * One CSS pixel: the smallest movement the screen can show, which is what the
 * finish rule measures against. Gecko passes it in app units; here it is px.
 */
export const SMALLEST_VISIBLE_INCREMENT = 1

/**
 * Gecko's `ComputeSpringConstant`. `deltaMS` is the time since the previous
 * notch, or `null` for the first notch of an animation; `previousDeltaMS` is
 * the gap before that one, 0 when there was none.
 */
export function chooseSpringConstant(
  deltaMS: number | null,
  previousDeltaMS: number,
  prefs: MsdPrefs = MSD_PREFS,
): number {
  if (deltaMS === null || deltaMS >= prefs.continuousMotionMaxDeltaMS) {
    return prefs.motionBeginSpringConstant
  }
  if (
    previousDeltaMS > 0 &&
    deltaMS >= prefs.slowdownMinDeltaMS &&
    deltaMS >= previousDeltaMS * prefs.slowdownMinDeltaRatio
  ) {
    // The notches are spacing out: the gesture is ending, so a stiffer spring
    // reaches the destination before the hand has left the wheel.
    return prefs.slowdownSpringConstant
  }
  return prefs.regularSpringConstant
}

/**
 * Gecko's `ClampVelocityToMaximum` (bug 1866904): the most velocity the spring
 * could have gained on its own from rest at this distance. Any more, and a
 * critically damped system can still overshoot.
 */
export function clampVelocity(
  velocity: number,
  position: number,
  destination: number,
  springConstant: number,
): number {
  const limit = Math.sqrt(springConstant) * Math.abs(destination - position)
  return Math.min(limit, Math.max(-limit, velocity))
}

/**
 * A unit mass on a critically damped spring, in closed form.
 *
 * With k the spring constant and w = sqrt(k), the position is
 * `destination + (A + B t) e^(-w t)` where A is the starting offset and
 * B = v0 + w A. It never oscillates, and never overshoots unless started with
 * velocity past what `clampVelocity` allows.
 */
export class CriticallyDampedSpring {
  private readonly omega: number
  private readonly a: number
  private readonly b: number

  constructor(
    readonly start: number,
    readonly destination: number,
    initialVelocity: number,
    springConstant: number,
  ) {
    this.omega = Math.sqrt(springConstant)
    this.a = start - destination
    this.b = initialVelocity + this.omega * this.a
  }

  /** Position after `seconds`. */
  positionAt(seconds: number): number {
    const decay = Math.exp(-this.omega * seconds)
    return this.destination + (this.a + this.b * seconds) * decay
  }

  /** Velocity after `seconds`, in units per second. */
  velocityAt(seconds: number): number {
    const decay = Math.exp(-this.omega * seconds)
    return (this.b - this.omega * (this.a + this.b * seconds)) * decay
  }

  /**
   * Gecko's `AxisPhysicsMSDModel::IsFinished`: within one increment of the
   * destination and moving slower than two increments a second.
   */
  isFinished(seconds: number, increment = SMALLEST_VISIBLE_INCREMENT): boolean {
    return (
      Math.abs(this.destination - this.positionAt(seconds)) < increment &&
      Math.abs(this.velocityAt(seconds)) <= increment * 2
    )
  }
}

/**
 * One axis of Gecko's `ScrollAnimationMSDPhysics`: a spring that is rebuilt
 * on every notch from wherever the previous one has got to, keeping its
 * velocity, with a stiffness chosen from the notch cadence.
 *
 * Times are milliseconds on one monotonic clock (`performance.now()` and the
 * `requestAnimationFrame` timestamp share it). One instance is one animation:
 * once it has finished, the next notch starts a new one, and with it the
 * `motionBegin` stiffness, which is what Gecko does too.
 */
export class SpringScrollAnimation {
  private spring: CriticallyDampedSpring | null = null
  private startTime = 0
  private previousEventTime: number | null = null
  private previousDeltaMS = 0
  private prefs: MsdPrefs

  constructor(prefs: MsdPrefs = MSD_PREFS) {
    this.prefs = prefs
  }

  /** Where the animation is heading, or `null` before the first notch. */
  get destination(): number | null {
    return this.spring ? this.spring.destination : null
  }

  /**
   * A notch: retarget to `destination`. `currentPosition` is only read for the
   * first notch; after that the spring's own position and velocity at `timeMS`
   * are the starting point, so a run of notches is one continuous motion.
   */
  update(timeMS: number, destination: number, currentPosition: number): void {
    const springConstant = this.computeSpringConstant(timeMS)
    let position = currentPosition
    let velocity = 0
    if (this.spring) {
      position = this.positionAt(timeMS)
      velocity = this.velocityAt(timeMS)
    }
    this.startTime = timeMS
    this.spring = new CriticallyDampedSpring(
      position,
      destination,
      clampVelocity(velocity, position, destination, springConstant),
      springConstant,
    )
  }

  positionAt(timeMS: number): number {
    if (!this.spring) return 0
    return this.spring.positionAt(this.elapsed(timeMS))
  }

  velocityAt(timeMS: number): number {
    if (!this.spring) return 0
    return this.spring.velocityAt(this.elapsed(timeMS))
  }

  isFinished(timeMS: number): boolean {
    return !this.spring || this.spring.isFinished(this.elapsed(timeMS))
  }

  /** Seconds since the last retarget, never negative: a stale timestamp reads as "now". */
  private elapsed(timeMS: number): number {
    return Math.max(0, timeMS - this.startTime) / 1000
  }

  private computeSpringConstant(timeMS: number): number {
    if (this.previousEventTime === null) {
      this.previousEventTime = timeMS
      this.previousDeltaMS = 0
      return chooseSpringConstant(null, 0, this.prefs)
    }
    const deltaMS = timeMS - this.previousEventTime
    const previousDeltaMS = this.previousDeltaMS
    this.previousEventTime = timeMS
    this.previousDeltaMS = deltaMS
    return chooseSpringConstant(deltaMS, previousDeltaMS, this.prefs)
  }
}
