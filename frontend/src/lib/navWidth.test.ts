import { describe, it, expect } from 'vitest'
import {
  clampNavWidth,
  navWidthMax,
  NAV_WIDTH_DEFAULT,
  NAV_WIDTH_MIN,
  NAV_WIDTH_MAX_FRACTION,
} from './navWidth'

// main.go's MinWidth. 30% of it is comfortably above NAV_WIDTH_MIN, which is
// what makes the floor and the ceiling non-overlapping in the real app.
const MIN_WINDOW = 1024

describe('navWidthMax', () => {
  it('is the configured share of the window', () => {
    expect(navWidthMax(1440)).toBe(Math.round(1440 * NAV_WIDTH_MAX_FRACTION))
  })

  it('leaves room for the floor at the app minimum window width', () => {
    expect(navWidthMax(MIN_WINDOW)).toBeGreaterThan(NAV_WIDTH_MIN)
  })
})

describe('clampNavWidth', () => {
  it('passes a width that is already inside the range through', () => {
    expect(clampNavWidth(240, 1440)).toBe(240)
  })

  it('raises a width below the floor', () => {
    expect(clampNavWidth(40, 1440)).toBe(NAV_WIDTH_MIN)
  })

  it('caps a width at 30% of the window', () => {
    expect(clampNavWidth(900, 1440)).toBe(432)
  })

  // The width outlives the window it was sized in: settings persist, window
  // sizes do not. A 432px navbar stored from a 1440px window would be 45% of a
  // 960px one.
  it('re-clamps a width stored by a wider window', () => {
    expect(clampNavWidth(432, 960)).toBe(288)
  })

  // Only reachable from a window narrower than the app allows, but the ceiling
  // is the invariant with a reason behind it, so it wins.
  it('lets the ceiling win when it falls below the floor', () => {
    expect(clampNavWidth(NAV_WIDTH_DEFAULT, 400)).toBe(120)
  })

  // A settings file written before navWidth existed unmarshals it as 0, which
  // means "never set" rather than "collapsed".
  it('treats a zero as unset and resolves it to the default', () => {
    expect(clampNavWidth(0, 1440)).toBe(NAV_WIDTH_DEFAULT)
  })

  it('resolves a negative or non-finite width to the default', () => {
    expect(clampNavWidth(-50, 1440)).toBe(NAV_WIDTH_DEFAULT)
    expect(clampNavWidth(Number.NaN, 1440)).toBe(NAV_WIDTH_DEFAULT)
  })

  // A width read while the window is being torn down, or in a test that never
  // set one up. Applying a 0 ceiling would collapse the navbar to nothing.
  it('ignores an unusable window width rather than collapsing', () => {
    expect(clampNavWidth(240, 0)).toBe(240)
    expect(clampNavWidth(240, Number.NaN)).toBe(240)
  })

  it('always returns a whole number of pixels', () => {
    expect(clampNavWidth(240.6, 1440)).toBe(241)
    expect(Number.isInteger(clampNavWidth(1000, 999))).toBe(true)
  })
})
