import { useCallback, useEffect, useState } from 'react'
import type { AnimationEvent } from 'react'

// The keyframes that end a dialog's exit (style.css). The panel's is the longer
// of the pair, so its end is the end of the exit.
const PANEL_OUT = 'modal-panel-out'
// Used where the token cannot be read (jsdom loads no stylesheet), and kept in
// step with --duration-panel.
const FALLBACK_MS = 280
// Past the animation's own end, so animationend wins whenever it fires.
const SLACK_MS = 60

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function exitMs(): number {
  const ms = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--duration-panel'),
  )
  return (Number.isFinite(ms) && ms > 0 ? ms : FALLBACK_MS) + SLACK_MS
}

/**
 * Keeps a dialog mounted for as long as its exit animation runs. `open` going
 * false starts the exit: `leaving` is true, the dialog gets the `-out` classes
 * and ignores the pointer, and it unmounts once the panel's animation ends (or
 * when a timeout of about the same length fires, so a missing `animationend`
 * can never leave it on screen). `open` going true again mid-exit cancels it.
 * With reduced motion there is no animation to wait for, so it goes at once.
 *
 * Put `overlayClass` and `panelClass` on the backdrop and the panel, `inert` on
 * the outermost element (it is what keeps a focused button from being pressed
 * a second time by the keyboard during the exit), hang `onAnimationEnd` on the
 * panel (or an ancestor of it), and render nothing while `mounted` is false. Escape and close handlers belong to `open`, not
 * `mounted`, so they are already off by the time `leaving` is true.
 */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open)
  // Derived during render rather than in an effect, so an opening dialog is
  // drawn in the frame it is asked for, and a reduced-motion one is gone in it.
  if (open && !mounted) setMounted(true)
  if (!open && mounted && reducedMotion()) setMounted(false)

  const leaving = !open && mounted

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setMounted(false), exitMs())
    return () => clearTimeout(timer)
  }, [leaving])

  const onAnimationEnd = useCallback(
    (e: AnimationEvent) => {
      if (leaving && e.animationName === PANEL_OUT) setMounted(false)
    },
    [leaving],
  )

  return {
    mounted: open || mounted,
    leaving,
    inert: leaving,
    onAnimationEnd,
    overlayClass: leaving ? 'modal-overlay-out pointer-events-none' : 'modal-overlay-in',
    panelClass: leaving ? 'modal-panel-out pointer-events-none' : 'modal-panel-in',
  }
}

/**
 * The last non-null `value`, for a dialog whose parent clears what it shows the
 * moment it closes: the exit still has to draw the content the dialog had.
 */
export function useRetained<T>(value: T | null): T | null {
  const [kept, setKept] = useState(value)
  if (value !== null && value !== kept) setKept(value)
  return value ?? kept
}
