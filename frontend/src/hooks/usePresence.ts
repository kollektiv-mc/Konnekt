import { useCallback, useEffect, useState } from 'react'
import type { AnimationEvent } from 'react'

// What ends an exit, per kind. A dialog's is the panel's keyframes (style.css),
// the longer of the pair, so its end is the end of the exit. A menu's is the
// one `menu-out` keyframe (scheduler.css), at the faster duration. The
// fallback is used where the token cannot be read (jsdom loads no stylesheet),
// and is kept in step with the token.
const KINDS = {
  dialog: {
    out: 'modal-panel-out',
    token: '--duration-panel',
    fallbackMs: 280,
    inClass: 'modal-panel-in',
    outClass: 'modal-panel-out',
  },
  menu: {
    out: 'menu-out',
    token: '--duration-fast',
    fallbackMs: 150,
    inClass: 'menu-in',
    outClass: 'menu-out',
  },
} as const

export type PresenceKind = keyof typeof KINDS
// Past the animation's own end, so animationend wins whenever it fires.
const SLACK_MS = 60

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

// A CSS time in milliseconds. The built stylesheet is minified, which writes
// the token's 280ms as .28s, so the unit has to be read rather than assumed:
// parsing it as milliseconds cut every exit to the slack alone.
export function cssTimeMs(value: string): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n) || n <= 0) return NaN
  return value.trim().endsWith('ms') ? n : n * 1000
}

function exitMs(kind: PresenceKind): number {
  const { token, fallbackMs } = KINDS[kind]
  const ms = cssTimeMs(getComputedStyle(document.documentElement).getPropertyValue(token))
  return (Number.isFinite(ms) ? ms : fallbackMs) + SLACK_MS
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
 *
 * `kind` 'menu' is the same for a menu or a fly-out: its panel takes
 * `panelClass` (`menu-in` / `menu-out`), and the exit is one `--duration-fast`
 * long. A menu whose panel animates by a transition of its own (`Popover`)
 * takes only `mounted` from it, to keep its rows drawn while that plays; no
 * animation event arrives, so the timeout is what unmounts them.
 */
export function usePresence(open: boolean, kind: PresenceKind = 'dialog') {
  const [mounted, setMounted] = useState(open)
  // Derived during render rather than in an effect, so an opening dialog is
  // drawn in the frame it is asked for, and a reduced-motion one is gone in it.
  if (open && !mounted) setMounted(true)
  if (!open && mounted && reducedMotion()) setMounted(false)

  const leaving = !open && mounted

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setMounted(false), exitMs(kind))
    return () => clearTimeout(timer)
  }, [leaving, kind])

  const onAnimationEnd = useCallback(
    (e: AnimationEvent) => {
      if (leaving && e.animationName === KINDS[kind].out) setMounted(false)
    },
    [leaving, kind],
  )

  return {
    mounted: open || mounted,
    leaving,
    inert: leaving,
    onAnimationEnd,
    overlayClass: leaving ? 'modal-overlay-out pointer-events-none' : 'modal-overlay-in',
    panelClass: leaving ? `${KINDS[kind].outClass} pointer-events-none` : KINDS[kind].inClass,
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
