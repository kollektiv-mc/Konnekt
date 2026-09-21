import { describe, it, expect } from 'vitest'
import {
  chooseSpringConstant,
  clampVelocity,
  CriticallyDampedSpring,
  MSD_PREFS,
  SpringScrollAnimation,
} from './springPhysics'

const { motionBeginSpringConstant, regularSpringConstant, slowdownSpringConstant } = MSD_PREFS

describe('CriticallyDampedSpring', () => {
  it('starts where it was told to, and settles at the destination', () => {
    const spring = new CriticallyDampedSpring(0, 100, 0, regularSpringConstant)
    expect(spring.positionAt(0)).toBe(0)
    expect(spring.velocityAt(0)).toBe(0)
    expect(spring.positionAt(2)).toBeCloseTo(100, 6)
    expect(spring.isFinished(2)).toBe(true)
  })

  it('reports its initial velocity back', () => {
    const spring = new CriticallyDampedSpring(0, 100, 250, regularSpringConstant)
    expect(spring.velocityAt(0)).toBeCloseTo(250, 9)
  })

  it('never overshoots or reverses from rest', () => {
    const spring = new CriticallyDampedSpring(0, 100, 0, regularSpringConstant)
    let previous = 0
    for (let ms = 1; ms <= 1000; ms++) {
      const position = spring.positionAt(ms / 1000)
      expect(position).toBeGreaterThanOrEqual(previous)
      expect(position).toBeLessThanOrEqual(100)
      previous = position
    }
  })

  it('velocity is the derivative of position', () => {
    const spring = new CriticallyDampedSpring(20, -80, 30, slowdownSpringConstant)
    for (const t of [0.005, 0.02, 0.1, 0.3]) {
      const h = 1e-6
      const numeric = (spring.positionAt(t + h) - spring.positionAt(t - h)) / (2 * h)
      expect(spring.velocityAt(t)).toBeCloseTo(numeric, 3)
    }
  })

  it('is not finished while still moving fast, even when close', () => {
    // 1000px/s through a point 0.5px short of the destination.
    const spring = new CriticallyDampedSpring(99.5, 100, 1000, regularSpringConstant)
    expect(spring.isFinished(0)).toBe(false)
  })
})

describe('chooseSpringConstant', () => {
  it('is the motion-begin stiffness for the first notch of an animation', () => {
    expect(chooseSpringConstant(null, 0)).toBe(motionBeginSpringConstant)
  })

  it('starts over after a pause at or past continuousMotionMaxDeltaMS', () => {
    expect(chooseSpringConstant(120, 30)).toBe(motionBeginSpringConstant)
    expect(chooseSpringConstant(500, 30)).toBe(motionBeginSpringConstant)
  })

  it('is the regular stiffness through a steady run of notches', () => {
    expect(chooseSpringConstant(30, 30)).toBe(regularSpringConstant)
    expect(chooseSpringConstant(35, 30)).toBe(regularSpringConstant)
  })

  it('stiffens when the notches space out enough to be a slowdown', () => {
    // 39ms after a 30ms gap: 1.3x the previous, and past the 12ms floor.
    expect(chooseSpringConstant(39, 30)).toBe(slowdownSpringConstant)
    // Under the floor: two notches 10ms apart after a 5ms gap are not a slowdown.
    expect(chooseSpringConstant(10, 5)).toBe(regularSpringConstant)
    // Second notch ever: no previous gap to compare against.
    expect(chooseSpringConstant(60, 0)).toBe(regularSpringConstant)
  })
})

describe('clampVelocity', () => {
  it('caps at what the spring could have gained on its own from rest', () => {
    const limit = Math.sqrt(regularSpringConstant) * 100
    expect(clampVelocity(1e9, 0, 100, regularSpringConstant)).toBeCloseTo(limit, 9)
    expect(clampVelocity(-1e9, 0, 100, regularSpringConstant)).toBeCloseTo(-limit, 9)
    expect(clampVelocity(50, 0, 100, regularSpringConstant)).toBe(50)
  })
})

describe('SpringScrollAnimation', () => {
  it('is at rest with no destination before the first notch', () => {
    const animation = new SpringScrollAnimation()
    expect(animation.destination).toBeNull()
    expect(animation.isFinished(0)).toBe(true)
  })

  it('takes the current position from the caller for the first notch only', () => {
    const animation = new SpringScrollAnimation()
    animation.update(0, 400, 300)
    expect(animation.positionAt(0)).toBe(300)
    expect(animation.destination).toBe(400)
  })

  it('a second notch continues from where the first has got to, keeping its velocity', () => {
    const animation = new SpringScrollAnimation()
    animation.update(0, 100, 0)
    const midway = animation.positionAt(40)
    const velocity = animation.velocityAt(40)
    expect(midway).toBeGreaterThan(0)
    expect(velocity).toBeGreaterThan(0)

    animation.update(40, 200, -1)
    expect(animation.positionAt(40)).toBeCloseTo(midway, 9)
    expect(animation.velocityAt(40)).toBeCloseTo(velocity, 9)

    // Against a cold start from the same point, the carried velocity is ahead.
    const cold = new SpringScrollAnimation()
    cold.update(40, 200, midway)
    expect(animation.positionAt(56)).toBeGreaterThan(cold.positionAt(56))
  })

  it('a run of notches never overshoots the latest destination', () => {
    const animation = new SpringScrollAnimation()
    let destination = 0
    for (let notch = 0; notch < 8; notch++) {
      destination += 100
      animation.update(notch * 30, destination, 0)
    }
    for (let ms = 210; ms <= 1500; ms++) {
      expect(animation.positionAt(ms)).toBeLessThanOrEqual(destination + 1e-9)
    }
    expect(animation.isFinished(1500)).toBe(true)
    expect(animation.positionAt(1500)).toBeCloseTo(destination, 3)
  })

  it('a stale timestamp reads as no time passed rather than negative time', () => {
    const animation = new SpringScrollAnimation()
    animation.update(1000, 100, 0)
    expect(animation.positionAt(900)).toBe(0)
  })
})
