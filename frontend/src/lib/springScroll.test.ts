import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { classifyWheel, findScrollTarget, installSpringScroll } from './springScroll'

// jsdom lays nothing out, so a scroller is given its geometry by hand:
// `scrollTop` clamps to the range a real element would, and the two heights
// are whatever the test says they are.
function makeScroller(parent: Node, scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div')
  el.style.overflowY = 'auto'
  let top = 0
  Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { get: () => clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = Math.min(scrollHeight - clientHeight, Math.max(0, v))
    },
  })
  parent.appendChild(el)
  return el
}

function wheel(target: Element, init: WheelEventInit & { wheelDeltaY?: number }): WheelEvent {
  const { wheelDeltaY, ...rest } = init
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...rest })
  if (wheelDeltaY !== undefined) Object.defineProperty(e, 'wheelDeltaY', { value: wheelDeltaY })
  target.dispatchEvent(e)
  return e
}

describe('classifyWheel', () => {
  it('reads a stepped wheel off the legacy 120-per-notch field when there is one', () => {
    expect(classifyWheel(wheel(document.body, { deltaY: 100, wheelDeltaY: -120 }))).toBe('notch')
    expect(classifyWheel(wheel(document.body, { deltaY: 33, wheelDeltaY: -120 }))).toBe('notch')
    expect(classifyWheel(wheel(document.body, { deltaY: 200, wheelDeltaY: -240 }))).toBe('notch')
    expect(classifyWheel(wheel(document.body, { deltaY: 25, wheelDeltaY: -30 }))).toBe('precision')
    expect(classifyWheel(wheel(document.body, { deltaY: 100, wheelDeltaY: -100 }))).toBe(
      'precision',
    )
  })

  it('falls back to the size and shape of the delta without it', () => {
    expect(classifyWheel(wheel(document.body, { deltaY: 100 }))).toBe('notch')
    expect(classifyWheel(wheel(document.body, { deltaY: -100 }))).toBe('notch')
    expect(classifyWheel(wheel(document.body, { deltaY: 3.5 }))).toBe('precision')
    expect(classifyWheel(wheel(document.body, { deltaY: 12 }))).toBe('precision')
  })

  it('takes line and page deltas as a stepped device', () => {
    expect(
      classifyWheel(wheel(document.body, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE })),
    ).toBe('notch')
    expect(
      classifyWheel(wheel(document.body, { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE })),
    ).toBe('notch')
  })
})

describe('findScrollTarget', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('picks the nearest scroller with room in that direction, chaining outward at an end', () => {
    const outer = makeScroller(document.body, 2000, 500)
    const inner = makeScroller(outer, 300, 100)
    const leaf = document.createElement('span')
    inner.appendChild(leaf)

    expect(findScrollTarget(leaf, 1)).toBe(inner)
    // Both at the top: nothing can move up, so nothing is chosen.
    expect(findScrollTarget(leaf, -1)).toBeNull()
    // With the inner one at its top, scrolling up chains past it.
    outer.scrollTop = 500
    expect(findScrollTarget(leaf, -1)).toBe(outer)
    inner.scrollTop = 200
    expect(findScrollTarget(leaf, 1)).toBe(outer)
    expect(findScrollTarget(leaf, -1)).toBe(inner)
  })

  it('ignores an element that only overflows visibly, and a target that is not an element', () => {
    const outer = makeScroller(document.body, 2000, 500)
    const plain = document.createElement('div')
    Object.defineProperty(plain, 'scrollHeight', { get: () => 900 })
    Object.defineProperty(plain, 'clientHeight', { get: () => 100 })
    outer.appendChild(plain)
    expect(findScrollTarget(plain, 1)).toBe(outer)
    expect(findScrollTarget(null, 1)).toBeNull()
    expect(findScrollTarget(document.createTextNode('x'), 1)).toBeNull()
  })

  it('lets an in-flight destination stand in for the position', () => {
    const outer = makeScroller(document.body, 2000, 500)
    const inner = makeScroller(outer, 300, 100)
    expect(findScrollTarget(inner, 1, (el) => (el === inner ? 200 : null))).toBe(outer)
  })
})

describe('installSpringScroll', () => {
  let now = 0
  let frames: FrameRequestCallback[] = []
  let uninstall: () => void = () => {}
  let enabled = true

  // The frame loop and the notch clock share one fake timeline: a frame is
  // run by hand at whatever time the test says it is.
  const advance = (ms: number) => {
    now += ms
    const due = frames
    frames = []
    for (const cb of due) cb(now)
  }

  beforeEach(() => {
    now = 0
    frames = []
    enabled = true
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      // Ids are 1-based positions in the pending list, as push returns them.
      frames.splice(id - 1, 1)
    })
    uninstall = installSpringScroll({ enabled: () => enabled })
  })

  afterEach(() => {
    uninstall()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('takes a notch over from the browser and glides the scroller to it', () => {
    const el = makeScroller(document.body, 2000, 500)
    const e = wheel(el, { deltaY: 100 })
    expect(e.defaultPrevented).toBe(true)
    expect(el.scrollTop).toBe(0)

    advance(16)
    const early = el.scrollTop
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(100)
    for (let i = 0; i < 60; i++) advance(16)
    expect(el.scrollTop).toBe(100)
    expect(frames).toHaveLength(0)
  })

  it('accumulates a run of notches into one motion and clamps at the end', () => {
    const el = makeScroller(document.body, 700, 500)
    wheel(el, { deltaY: 100 })
    advance(16)
    wheel(el, { deltaY: 100 })
    advance(16)
    wheel(el, { deltaY: 100 })
    for (let i = 0; i < 60; i++) advance(16)
    expect(el.scrollTop).toBe(200)
  })

  it('leaves the browser to it when it should', () => {
    const el = makeScroller(document.body, 2000, 500)
    expect(wheel(el, { deltaY: 3.5 }).defaultPrevented).toBe(false)
    expect(wheel(el, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false)
    expect(wheel(el, { deltaY: 100, shiftKey: true }).defaultPrevented).toBe(false)
    expect(wheel(el, { deltaY: 100, deltaX: 20 }).defaultPrevented).toBe(false)
    expect(wheel(el, { deltaY: -100 }).defaultPrevented).toBe(false)
    enabled = false
    expect(wheel(el, { deltaY: 100 }).defaultPrevented).toBe(false)
    enabled = true
    expect(frames).toHaveLength(0)
  })

  it('defers to a handler that already claimed the event', () => {
    const el = makeScroller(document.body, 2000, 500)
    const own = document.createElement('div')
    el.appendChild(own)
    own.addEventListener('wheel', (e) => e.preventDefault())
    wheel(own, { deltaY: 100 })
    expect(frames).toHaveLength(0)
  })

  it('stops when something else moves the scroller mid-flight', () => {
    const el = makeScroller(document.body, 2000, 500)
    wheel(el, { deltaY: 100 })
    advance(16)
    el.scrollTop = 900
    advance(16)
    expect(el.scrollTop).toBe(900)
    expect(frames).toHaveLength(0)
  })

  it('chains a notch that arrives at an inner scroller already bound for its end', () => {
    const outer = makeScroller(document.body, 2000, 500)
    const inner = makeScroller(outer, 600, 500)
    wheel(inner, { deltaY: 100 })
    wheel(inner, { deltaY: 100 })
    for (let i = 0; i < 60; i++) advance(16)
    expect(inner.scrollTop).toBe(100)
    expect(outer.scrollTop).toBe(100)
  })

  it('uninstall stops the animation where it is', () => {
    const el = makeScroller(document.body, 2000, 500)
    wheel(el, { deltaY: 100 })
    advance(16)
    const partway = el.scrollTop
    uninstall()
    advance(16)
    expect(el.scrollTop).toBe(partway)
  })
})
