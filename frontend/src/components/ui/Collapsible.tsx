import { useEffect, useRef, useState } from 'react'
import { DURATION_MS } from '../../styles/tokens'

interface CollapsibleProps {
  open: boolean
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
export function Collapsible({ open, children, className }: CollapsibleProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState(open ? 'none' : '0px')

  // Which toggle the release timer below belongs to. Its cleanup already
  // clears it; this is the second lock, so a timer that somehow outlives its
  // own cleanup still cannot write over a later state.
  const gen = useRef(0)

  useEffect(() => {
    const inner = innerRef.current
    const box = outerRef.current
    if (!inner || !box) return
    const mine = ++gen.current
    const target = open ? `${inner.scrollHeight}px` : '0px'

    // A transition needs a starting value the browser has actually computed.
    // An open panel sits at `max-height: none`, which does not interpolate, and
    // a panel toggled twice in a frame can have its old value never computed at
    // all — either way the change arrives with nothing to travel from and the
    // panel jumps.
    //
    // The close used to hand that to two nested animation frames: set the
    // measured height, wait two frames for it to be painted, then set zero.
    // That holds while frames are cheap and stops holding when they are not.
    // Under a 6x CPU throttle it failed on 74 of 220 closes, and the open path,
    // which trusted the previous value to have been painted, failed twice at
    // 10x. Clicking during another section's animation is the same coalescing
    // on a real machine, which is when it was reported.
    //
    // So: pin where it is, read a layout property to make the browser compute
    // that there and then, write where it is going. No frame budget can reorder
    // a synchronous flush, and the two directions are one path rather than two
    // with different failure modes.
    //
    // The pin is the height it is *at*, not the one it would be. Those agree
    // for a settled panel and do not for one caught mid-travel, where pinning
    // the far end would snap it there before animating back.
    //
    // Both writes go to the DOM, not just the pin. React skips a re-render when
    // the state it is handed matches what it holds, and a skipped render is a
    // style prop that never reaches the element — which would leave the pin
    // standing as the panel's final height. The state update still follows, so
    // any later render agrees with it.
    box.style.maxHeight = `${box.getBoundingClientRect().height}px`
    void box.offsetHeight
    box.style.maxHeight = target
    setMaxHeight(target)

    if (!open) return
    // Release to `none` once open so children that grow afterward (e.g. nested
    // sections) aren't re-clipped by a stale measured height. The transition
    // end is what normally does it (see onTransitionEnd below); this only
    // covers the cases where none arrives.
    const t = setTimeout(() => {
      if (gen.current === mine) setMaxHeight('none')
    }, RELEASE_FALLBACK_MS)
    return () => clearTimeout(t)
  }, [open])

  return (
    <div
      ref={outerRef}
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
