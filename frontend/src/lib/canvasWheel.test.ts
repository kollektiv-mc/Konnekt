import { describe, it, expect } from 'vitest'
import {
  WHEEL_GESTURE_IDLE_MS,
  canScrollBy,
  pickWheelOwner,
  wheelDeltaPx,
  type ScrollMetrics,
  type WheelGesture,
} from './canvasWheel'

const mid: ScrollMetrics = { scrollTop: 100, scrollHeight: 1000, clientHeight: 500 }
const top: ScrollMetrics = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 }
const bottom: ScrollMetrics = { scrollTop: 500, scrollHeight: 1000, clientHeight: 500 }
const fits: ScrollMetrics = { scrollTop: 0, scrollHeight: 500, clientHeight: 500 }

describe('canScrollBy', () => {
  it('moves both ways mid-range', () => {
    expect(canScrollBy(mid, 10)).toBe(true)
    expect(canScrollBy(mid, -10)).toBe(true)
  })
  it('stops at each edge in that direction only', () => {
    expect(canScrollBy(top, -10)).toBe(false)
    expect(canScrollBy(top, 10)).toBe(true)
    expect(canScrollBy(bottom, 10)).toBe(false)
    expect(canScrollBy(bottom, -10)).toBe(true)
  })
  it('tolerates a fractional scrollTop at the bottom', () => {
    expect(canScrollBy({ ...bottom, scrollTop: 499.4 }, 10)).toBe(false)
  })
  it('cannot move when content fits or delta is zero', () => {
    expect(canScrollBy(fits, 10)).toBe(false)
    expect(canScrollBy(fits, -10)).toBe(false)
    expect(canScrollBy(mid, 0)).toBe(false)
  })
})

describe('wheelDeltaPx', () => {
  it('passes pixels through and scales lines and pages', () => {
    expect(wheelDeltaPx(30, 0, 800)).toBe(30)
    expect(wheelDeltaPx(3, 1, 800)).toBe(48)
    expect(wheelDeltaPx(1, 2, 800)).toBe(800)
  })
})

describe('pickWheelOwner', () => {
  const pane = mid

  it('gives a fresh gesture to the canvas while it can move, whatever pane is under the pointer', () => {
    const d = pickWheelOwner({ canvas: mid, pane, deltaY: 40, now: 1000, gesture: null })
    expect(d.owner).toBe('canvas')
    expect(d.gesture).toEqual({ owner: 'canvas', direction: 1, lastAt: 1000 })
  })

  it('gives a fresh gesture to the pane when the canvas cannot move that way', () => {
    expect(pickWheelOwner({ canvas: bottom, pane, deltaY: 40, now: 0, gesture: null }).owner).toBe(
      'pane',
    )
    expect(pickWheelOwner({ canvas: top, pane, deltaY: -40, now: 0, gesture: null }).owner).toBe(
      'pane',
    )
  })

  it('gives the pane the wheel from the first event when the canvas has nothing to scroll', () => {
    expect(pickWheelOwner({ canvas: fits, pane, deltaY: 40, now: 0, gesture: null }).owner).toBe(
      'pane',
    )
  })

  it('keeps the canvas on the same gesture while it can move', () => {
    const g: WheelGesture = { owner: 'canvas', direction: 1, lastAt: 1000 }
    const d = pickWheelOwner({ canvas: mid, pane, deltaY: 40, now: 1016, gesture: g })
    expect(d.owner).toBe('canvas')
    expect(d.gesture?.lastAt).toBe(1016)
  })

  it('hands over to the pane mid-gesture at the canvas limit, and the pane keeps it', () => {
    const g: WheelGesture = { owner: 'canvas', direction: 1, lastAt: 1000 }
    const d = pickWheelOwner({ canvas: bottom, pane, deltaY: 40, now: 1016, gesture: g })
    expect(d.owner).toBe('pane')
    // The canvas somehow regains room (content grew): the fling stays the pane's.
    const again = pickWheelOwner({ canvas: mid, pane, deltaY: 40, now: 1032, gesture: d.gesture })
    expect(again.owner).toBe('pane')
  })

  it('does not flip a pane-owned gesture to the canvas', () => {
    const g: WheelGesture = { owner: 'pane', direction: -1, lastAt: 1000 }
    expect(pickWheelOwner({ canvas: mid, pane, deltaY: -40, now: 1100, gesture: g }).owner).toBe(
      'pane',
    )
  })

  it('starts a new gesture after the idle gap, canvas first again', () => {
    const g: WheelGesture = { owner: 'pane', direction: 1, lastAt: 1000 }
    const now = 1000 + WHEEL_GESTURE_IDLE_MS
    expect(pickWheelOwner({ canvas: mid, pane, deltaY: 40, now, gesture: g }).owner).toBe('canvas')
  })

  it('treats a gap just under the idle timeout as the same gesture', () => {
    const g: WheelGesture = { owner: 'pane', direction: 1, lastAt: 1000 }
    const now = 1000 + WHEEL_GESTURE_IDLE_MS - 1
    expect(pickWheelOwner({ canvas: mid, pane, deltaY: 40, now, gesture: g }).owner).toBe('pane')
  })

  it('treats a reversal as a new gesture', () => {
    const g: WheelGesture = { owner: 'pane', direction: 1, lastAt: 1000 }
    const d = pickWheelOwner({ canvas: mid, pane, deltaY: -40, now: 1010, gesture: g })
    expect(d.owner).toBe('canvas')
    expect(d.gesture?.direction).toBe(-1)
  })

  it('holds a pane-owned fling when no pane can move, instead of chaining into the canvas', () => {
    const g: WheelGesture = { owner: 'pane', direction: 1, lastAt: 1000 }
    expect(
      pickWheelOwner({ canvas: bottom, pane: null, deltaY: 40, now: 1016, gesture: g }).owner,
    ).toBe('hold')
  })

  it('leaves a fresh gesture with no pane and no canvas room to the browser', () => {
    expect(
      pickWheelOwner({ canvas: bottom, pane: null, deltaY: 40, now: 0, gesture: null }).owner,
    ).toBe('none')
  })

  it('scrolls the canvas when the pointer is over no pane at all', () => {
    expect(
      pickWheelOwner({ canvas: mid, pane: null, deltaY: 40, now: 0, gesture: null }).owner,
    ).toBe('canvas')
  })

  it('ignores a zero delta and keeps the gesture', () => {
    const g: WheelGesture = { owner: 'canvas', direction: 1, lastAt: 5 }
    const d = pickWheelOwner({ canvas: mid, pane, deltaY: 0, now: 10, gesture: g })
    expect(d).toEqual({ owner: 'none', gesture: g })
  })
})
