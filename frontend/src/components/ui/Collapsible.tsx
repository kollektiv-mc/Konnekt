import { useEffect, useRef, useState } from 'react'
import { DURATION_MS } from '../../styles/tokens'

interface CollapsibleProps {
  open: boolean
  /**
   * Height the panel keeps when closed, instead of disappearing entirely.
   *
   * For a panel inside a bordered card: with nothing left, the header's rule
   * and the card's own bottom border end up a pixel apart and read as one
   * thick line rather than as a closed panel. A few pixels of the panel still
   * showing is the difference between a rendering artefact and a deliberate
   * sliver of something folded away behind the header.
   */
  collapsedHeight?: number
  children: React.ReactNode
  className?: string
}

// Net for the release below, not the thing that normally performs it: a
// transition that never runs fires no `transitionend`, and an open panel left
// capped at its measured height would re-clip children that grow afterwards.
// Deliberately longer than the transition, so the real event wins the race in
// every case where there is one — a fallback that fires first is not a fallback,
// it is the old bug with extra steps.
const RELEASE_FALLBACK_MS = DURATION_MS.panel + 120

// WebKit-safe vertical collapse: animates `max-height` between 0 and the
// *measured* content height (not a fixed magic number), so open/close travel
// the same distance and feel symmetric. `grid-template-rows: 0fr/1fr` would
// be simpler but leaves a residual sliver on Wails' WebKit WebView (see the
// backups-tile revert in git history, "Fixes #5") — max-height is the
// deliberate choice here.
export function Collapsible({ open, collapsedHeight = 0, children, className }: CollapsibleProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const closedHeight = `${collapsedHeight}px`
  const [maxHeight, setMaxHeight] = useState(open ? 'none' : closedHeight)

  // Which toggle each queued callback belongs to. Cancelling handles is not
  // enough on its own and this is the bug that made a fast reopen swallow an
  // animation: the collapse below queues a frame that queues *another* frame,
  // and by the time a cleanup runs the outer handle may already have fired,
  // leaving the inner one scheduled under a handle nothing is holding. That
  // stale frame then wrote `0px` over a panel that was opening again, and the
  // open path's release timer 280ms later snapped it back up with no motion at
  // all. Every callback now carries the generation it was queued in and drops
  // out once a later toggle has bumped it, so a stale frame cannot write
  // whether or not its handle was reachable.
  const gen = useRef(0)

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const mine = ++gen.current
    const h = el.scrollHeight

    if (open) {
      setMaxHeight(`${h}px`)
      // Release to `none` once open so children that grow afterward (e.g.
      // nested sections) aren't re-clipped by a stale measured height. The
      // transition end is what normally does it (see onTransitionEnd below);
      // this only covers the cases where none arrives.
      const t = setTimeout(() => {
        if (gen.current === mine) setMaxHeight('none')
      }, RELEASE_FALLBACK_MS)
      return () => clearTimeout(t)
    }

    setMaxHeight(`${h}px`)
    // Force a reflow frame at the measured height before collapsing to 0,
    // so the close direction actually animates instead of jumping from `none`.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (gen.current === mine) setMaxHeight(closedHeight)
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [open, closedHeight])

  return (
    <div
      className={`ui-collapsible overflow-hidden ${className ?? ''}`}
      // The cap comes off when the open transition genuinely finishes, rather
      // than when a timer started one commit earlier guesses that it has. That
      // timer always fired a frame or two early — it starts at commit, the
      // transition starts at the next style flush — so the last pixels of every
      // open were a jump rather than a glide.
      onTransitionEnd={(e) => {
        if (e.target !== e.currentTarget || e.propertyName !== 'max-height') return
        if (open) setMaxHeight('none')
      }}
      // eslint-disable-next-line no-restricted-syntax -- maxHeight is a measured runtime value (WebKit-safe collapse; see comment above), not visible to Tailwind's static scanner
      style={{
        maxHeight,
        transition: 'max-height var(--duration-panel) var(--ease-standard)',
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
