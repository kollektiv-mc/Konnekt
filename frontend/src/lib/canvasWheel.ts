/**
 * Canvas-first wheel scrolling: who gets a vertical wheel event when the
 * pointer is over a tile that has a scrollable pane inside it.
 *
 * The dashboard canvas is the page's only scroller, but tiles cover nearly all
 * of it and their inner panes take the wheel, so the page rarely moved. The
 * rule is: the canvas takes the wheel while it can still move in that
 * direction, and the innermost pane under the pointer takes it once it cannot.
 *
 * This module is the pure half: scroll state in, owner out. The DOM half
 * (reading scroll metrics, finding the pane, moving the canvas) is
 * `hooks/useCanvasFirstWheel.ts`.
 *
 * Rules, each pinned in `canvasWheel.test.ts`:
 *
 * - A gesture is a run of wheel events less than `WHEEL_GESTURE_IDLE_MS` apart
 *   in one direction. A reversal of direction starts a new gesture.
 * - A new gesture goes to the canvas if the canvas can move in that direction,
 *   otherwise to the pane. There is deliberately no dwell rule ("a gesture that
 *   starts after the canvas has rested goes to the pane"): on a dashboard that
 *   is nearly all panes, a dwell makes the canvas feel unscrollable the moment
 *   you pause, which is the bug this fixes.
 * - Ownership holds for the whole gesture, with one exception: a canvas-owned
 *   gesture that reaches the canvas limit hands over to the pane at once, and
 *   a pane-owned gesture never goes back, so one fling cannot bounce between
 *   the two.
 * - A pane-owned gesture with no pane able to move is held (swallowed), not
 *   left to the browser, so native scroll chaining cannot push the canvas
 *   mid-fling.
 */

/** A gap between wheel events longer than this ends the gesture. */
export const WHEEL_GESTURE_IDLE_MS = 180

export type WheelOwner = 'canvas' | 'pane' | 'hold' | 'none'

/** The three numbers that decide whether an element can move vertically. */
export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export interface WheelGesture {
  owner: 'canvas' | 'pane'
  /** Sign of the deltaY that started the gesture, 1 down or -1 up. */
  direction: 1 | -1
  /** `timeStamp` of the latest event in the gesture. */
  lastAt: number
}

export interface WheelDecision {
  owner: WheelOwner
  /** Carry into the next call; null when nothing owns a gesture. */
  gesture: WheelGesture | null
}

/** Sub-pixel slack: scrollTop is fractional on zoomed or scaled displays. */
const EDGE_EPSILON = 1

/** Whether an element can move in the direction of `deltaY`. */
export function canScrollBy(m: ScrollMetrics, deltaY: number): boolean {
  if (deltaY === 0) return false
  const max = m.scrollHeight - m.clientHeight
  if (max <= EDGE_EPSILON) return false
  return deltaY > 0 ? m.scrollTop < max - EDGE_EPSILON : m.scrollTop > EDGE_EPSILON
}

const LINE_PX = 16

/** A wheel event's vertical delta in pixels, whatever unit it arrived in. */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * LINE_PX
  if (deltaMode === 2) return deltaY * pageHeight
  return deltaY
}

interface PickInput {
  canvas: ScrollMetrics
  /**
   * The innermost pane under the pointer that can move in this direction, or
   * null when none can.
   */
  pane: ScrollMetrics | null
  /** Pixels, already normalised; sign gives the direction. */
  deltaY: number
  /** The event's `timeStamp`, in ms. */
  now: number
  gesture: WheelGesture | null
}

/**
 * Decide who handles one wheel event.
 *
 * `canvas` means the caller scrolls the canvas and cancels the event; `pane`
 * means leave it to the browser, which scrolls the pane; `hold` means cancel it
 * and move nothing; `none` means there is nothing to do and the browser may
 * have it.
 */
export function pickWheelOwner({ canvas, pane, deltaY, now, gesture }: PickInput): WheelDecision {
  if (deltaY === 0) return { owner: 'none', gesture }

  const direction: 1 | -1 = deltaY > 0 ? 1 : -1
  const live =
    gesture !== null &&
    gesture.direction === direction &&
    now - gesture.lastAt < WHEEL_GESTURE_IDLE_MS

  const canvasCan = canScrollBy(canvas, deltaY)
  let owner: 'canvas' | 'pane'
  if (!live) owner = canvasCan ? 'canvas' : 'pane'
  else if (gesture.owner === 'canvas') owner = canvasCan ? 'canvas' : 'pane'
  else owner = 'pane'

  const next: WheelGesture = { owner, direction, lastAt: now }
  if (owner === 'canvas') return { owner: 'canvas', gesture: next }
  if (pane !== null) return { owner: 'pane', gesture: next }
  // Nothing to move. A fling that was already the pane's must not leak into
  // the canvas by chaining; a fresh one (canvas at its limit, no pane) has
  // nothing to protect, so the browser may have it.
  return { owner: live && gesture.owner === 'pane' ? 'hold' : 'none', gesture: next }
}
