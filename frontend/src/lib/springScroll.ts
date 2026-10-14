/**
 * Mouse-wheel scrolling on Firefox's spring physics, app-wide.
 *
 * One non-passive `wheel` listener on the document. For a notch of a stepped
 * mouse wheel it finds the scroller the notch would have moved, takes the
 * scroll over from the browser, and drives that element's `scrollTop` with
 * `lib/springPhysics.ts` from a `requestAnimationFrame` loop. Everything else
 * is left to the browser, on purpose:
 *
 * - A precision touchpad. Its deltas already follow the fingers, and Firefox
 *   does not animate them either (on Windows they arrive as pan gestures and
 *   go straight to the compositor). `classifyWheel` tells the two apart.
 * - A wheel event something else has already claimed. The backups carousel,
 *   the worlds scene and the scheduler's graph editor each `preventDefault`
 *   the wheel for their own zoom or paging; the listener is on the bubble
 *   phase so theirs run first, and `defaultPrevented` is honoured.
 * - Ctrl or Shift held (zoom, horizontal), a horizontal delta, the OS
 *   reduced-motion preference, and the Settings toggle being off.
 *
 * Scroll chaining: a notch at the end of an inner scroller moves the next one
 * out, as the browser would. During an animation the element's *destination*
 * stands in for its position when deciding that, so a run of notches that
 * reaches the bottom of the console keeps going into the canvas rather than
 * queuing more distance the console cannot travel.
 *
 * Anything else moving the element mid-flight (a scrollbar drag, a
 * programmatic scroll such as the console following its tail) wins: a frame
 * that finds `scrollTop` away from where the last frame left it stops the
 * animation rather than fighting.
 */

import { SpringScrollAnimation } from './springPhysics'

export type WheelKind = 'notch' | 'precision'

/** A wheel tick in Chromium's legacy `wheelDelta` units, one notch. */
const LEGACY_WHEEL_TICK = 120

/**
 * Chromium's pixel delta for one notch at Windows' default three lines, and
 * the smallest delta the fallback below still takes for a notch: a precision
 * touchpad rarely moves this far in one event and a stepped wheel never
 * moves less at any lines-per-notch setting above one.
 */
const NOTCH_DELTA_FLOOR = 40

/** Pixels per line for a `DOM_DELTA_LINE` event, which Chromium never sends. */
const LINE_HEIGHT_PX = 16

/**
 * Whether a wheel event came from a stepped wheel or a precision device.
 *
 * Chromium keeps the legacy `wheelDeltaY` at 120 per notch whatever the OS
 * lines-per-notch setting scales `deltaY` to, while a precision touchpad's
 * arrives as an arbitrary fraction of that. Line and page deltas only ever
 * come from a stepped device. The last line is a fallback for an engine that
 * carries neither, where an integral delta of at least a notch is the best
 * available tell.
 */
export function classifyWheel(e: WheelEvent): WheelKind {
  if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return 'notch'
  const legacy = (e as WheelEvent & { wheelDeltaY?: unknown }).wheelDeltaY
  if (typeof legacy === 'number' && legacy !== 0) {
    return legacy % LEGACY_WHEEL_TICK === 0 ? 'notch' : 'precision'
  }
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= NOTCH_DELTA_FLOOR
    ? 'notch'
    : 'precision'
}

/** `scrollHeight - clientHeight`: the furthest `scrollTop` can go. */
function maxScrollTop(el: Element): number {
  return el.scrollHeight - el.clientHeight
}

function isVerticalScroller(el: Element): boolean {
  if (maxScrollTop(el) <= 1) return false
  const { overflowY } = getComputedStyle(el)
  if (el === el.ownerDocument.scrollingElement) {
    return overflowY !== 'hidden' && overflowY !== 'clip'
  }
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
}

/**
 * The element a wheel notch at `start` would scroll in `direction`: the
 * nearest vertical scroller with room left that way, where `destinationOf`
 * can substitute an in-flight destination for the element's position.
 */
export function findScrollTarget(
  start: EventTarget | null,
  direction: 1 | -1,
  destinationOf: (el: Element) => number | null = () => null,
): HTMLElement | null {
  let el: Element | null = start instanceof Element ? start : null
  while (el) {
    if (el instanceof HTMLElement && isVerticalScroller(el)) {
      const position = destinationOf(el) ?? el.scrollTop
      const room = direction > 0 ? maxScrollTop(el) - position : position
      if (room > 0.5) return el
    }
    el = el.parentElement
  }
  return null
}

/** `deltaY` in pixels for the element that is about to scroll. */
function pixelDelta(e: WheelEvent, el: HTMLElement): number {
  switch (e.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return e.deltaY * LINE_HEIGHT_PX
    case WheelEvent.DOM_DELTA_PAGE:
      return e.deltaY * el.clientHeight
    default:
      return e.deltaY
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * One element's animation. `lastWritten` is the `scrollTop` the previous
 * frame set, so the next frame can tell its own movement from somebody
 * else's. Past the tolerance, the browser's own rounding of a fractional
 * `scrollTop` is the only difference expected.
 */
class ElementScroller {
  private animation = new SpringScrollAnimation()
  private frameId = 0
  private lastWritten: number | null = null

  constructor(
    readonly el: HTMLElement,
    private readonly onSettled: (scroller: ElementScroller) => void,
  ) {}

  /** The in-flight destination, or `null` when this element is at rest. */
  get destination(): number | null {
    return this.frameId ? this.animation.destination : null
  }

  notch(delta: number, now: number): void {
    const from = this.destination ?? this.el.scrollTop
    const destination = Math.min(maxScrollTop(this.el), Math.max(0, from + delta))
    this.animation.update(now, destination, this.el.scrollTop)
    if (!this.frameId) this.frameId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    if (this.frameId) cancelAnimationFrame(this.frameId)
    this.frameId = 0
    this.lastWritten = null
    this.animation = new SpringScrollAnimation()
    this.onSettled(this)
  }

  private readonly frame = (now: number): void => {
    this.frameId = 0
    const { el } = this
    const movedByOthers =
      this.lastWritten !== null && Math.abs(el.scrollTop - this.lastWritten) > 1.5
    if (!el.isConnected || movedByOthers) {
      this.stop()
      return
    }
    const position = this.animation.positionAt(now)
    el.scrollTop = position
    this.lastWritten = el.scrollTop
    // Clamped by the browser: the content shrank under the animation, and
    // the spring's own position would keep travelling past the new end.
    const clamped = Math.abs(this.lastWritten - position) > 1.5
    if (clamped || this.animation.isFinished(now)) {
      if (!clamped) el.scrollTop = this.animation.destination ?? el.scrollTop
      this.stop()
      return
    }
    this.frameId = requestAnimationFrame(this.frame)
  }
}

export interface SpringScrollOptions {
  /** Read per notch, so a Settings change applies to the next notch. */
  enabled: () => boolean
  /** The document to listen on; the global one by default. */
  target?: Document
}

/**
 * Installs the listener. Returns the uninstall, which also stops every
 * animation in flight.
 */
export function installSpringScroll({
  enabled,
  target = document,
}: SpringScrollOptions): () => void {
  const scrollers = new Map<HTMLElement, ElementScroller>()
  const settled = (scroller: ElementScroller) => {
    scrollers.delete(scroller.el)
  }
  const destinationOf = (el: Element): number | null =>
    el instanceof HTMLElement ? (scrollers.get(el)?.destination ?? null) : null

  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented || !enabled() || prefersReducedMotion()) return
    if (e.ctrlKey || e.shiftKey || e.deltaY === 0 || e.deltaX !== 0) return
    if (classifyWheel(e) !== 'notch') return
    const el = findScrollTarget(e.target, e.deltaY > 0 ? 1 : -1, destinationOf)
    if (!el) return
    e.preventDefault()
    let scroller = scrollers.get(el)
    if (!scroller) {
      scroller = new ElementScroller(el, settled)
      scrollers.set(el, scroller)
    }
    scroller.notch(pixelDelta(e, el), performance.now())
  }

  target.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    target.removeEventListener('wheel', onWheel)
    // stop() removes the entry it is on; a Map iterator is defined to cope.
    for (const scroller of scrollers.values()) scroller.stop()
  }
}
