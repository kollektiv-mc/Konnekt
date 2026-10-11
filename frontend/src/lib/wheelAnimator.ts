/**
 * The seam between code that decides where a wheel notch goes and the spring
 * that animates it (`lib/springScroll.ts`).
 *
 * The spring is loaded through a dynamic import to keep it out of the entry
 * chunk, so nothing can import it statically to ask it to animate. It
 * registers itself here on install instead, and a caller that finds nothing
 * registered (the chunk has not arrived, or it was uninstalled) moves the
 * element itself.
 */

export interface WheelAnimator {
  /**
   * Animate `el` by this wheel event's delta. Returns false, having done
   * nothing, when the event is not one the spring animates: a precision
   * touchpad, reduced motion, or the Settings toggle off.
   */
  scrollBy(el: HTMLElement, e: WheelEvent): boolean
  /** Where `el` is bound for, or null when it is not animating. */
  destinationOf(el: HTMLElement): number | null
}

let current: WheelAnimator | null = null

export function setWheelAnimator(animator: WheelAnimator | null): void {
  current = animator
}

export function getWheelAnimator(): WheelAnimator | null {
  return current
}
