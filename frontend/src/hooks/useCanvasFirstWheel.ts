import { useEffect } from 'react'
import type { RefObject } from 'react'
import {
  canScrollBy,
  pickWheelOwner,
  wheelDeltaPx,
  type ScrollMetrics,
  type WheelGesture,
} from '../lib/canvasWheel'

function metrics(el: HTMLElement): ScrollMetrics {
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
}

function scrollsVertically(el: HTMLElement): boolean {
  const { overflowY } = getComputedStyle(el)
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
}

/**
 * The scrollable panes between `target` and `canvas` (exclusive), innermost
 * first. Only ones with something to scroll count, so a pane that fits its
 * content is not an owner.
 */
function panesUnder(target: EventTarget | null, canvas: HTMLElement): HTMLElement[] {
  const panes: HTMLElement[] = []
  let el = target instanceof Element ? target : null
  while (el && el !== canvas) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight && scrollsVertically(el)) {
      panes.push(el)
    }
    el = el.parentElement
  }
  return panes
}

/**
 * Canvas-first wheel scrolling for the dashboard canvas (see
 * `lib/canvasWheel.ts` for the rules).
 *
 * One non-passive listener on the canvas element itself, so it needs no
 * cooperation from tiles and stays out of the way of everything that is not
 * inside it: the maximized panel is a sibling of the canvas, and dialogs and
 * menus portal to `body`, so neither ever reaches this listener.
 *
 * Left alone on purpose: an event something inside already claimed
 * (`defaultPrevented`: the backups carousel, the worlds scene), horizontal and
 * shift or ctrl wheels, and events with no vertical component.
 *
 * Moving the canvas never touches a pane's `scrollTop`, so the console's
 * follow-tail logic neither detaches nor re-arms from it.
 */
export function useCanvasFirstWheel(canvasRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let gesture: WheelGesture | null = null
    // The outermost pane the current gesture started over. Leaving it (the
    // pointer moved to another tile, or off all panes) ends the gesture.
    let region: HTMLElement | null = null

    function onWheel(e: WheelEvent) {
      if (!canvas || e.defaultPrevented || e.ctrlKey || e.shiftKey) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const deltaY = wheelDeltaPx(e.deltaY, e.deltaMode, canvas.clientHeight)
      if (deltaY === 0) return

      const panes = panesUnder(e.target, canvas)
      const outer = panes.length > 0 ? panes[panes.length - 1] : null
      if (outer !== region) {
        region = outer
        gesture = null
      }
      const pane = panes.find((p) => canScrollBy(metrics(p), deltaY)) ?? null

      const decision = pickWheelOwner({
        canvas: metrics(canvas),
        pane: pane ? metrics(pane) : null,
        deltaY,
        now: e.timeStamp,
        gesture,
      })
      gesture = decision.gesture

      if (decision.owner === 'canvas') {
        e.preventDefault()
        canvas.scrollTop += deltaY
      } else if (decision.owner === 'hold') {
        e.preventDefault()
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvasRef])
}
