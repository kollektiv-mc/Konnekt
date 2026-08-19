import { useEffect, useRef, useState } from 'react'
import { DURATION_MS } from '../../styles/tokens'

interface CollapsibleProps {
  open: boolean
  children: React.ReactNode
  className?: string
}

// WebKit-safe vertical collapse: animates `max-height` between 0 and the
// *measured* content height (not a fixed magic number), so open/close travel
// the same distance and feel symmetric. `grid-template-rows: 0fr/1fr` would
// be simpler but leaves a residual sliver on Wails' WebKit WebView (see the
// backups-tile revert in git history, "Fixes #5") — max-height is the
// deliberate choice here.
export function Collapsible({ open, children, className }: CollapsibleProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState(open ? 'none' : '0px')

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const h = el.scrollHeight
    if (open) {
      setMaxHeight(`${h}px`)
      // Release to `none` once open so children that grow afterward (e.g.
      // nested sections) aren't re-clipped by a stale measured height.
      // Must outlast the max-height transition below, which reads --duration-panel.
      // Same token, so the two cannot drift apart.
      const t = setTimeout(() => setMaxHeight('none'), DURATION_MS.panel)
      return () => clearTimeout(t)
    }
    setMaxHeight(`${h}px`)
    // Force a reflow frame at the measured height before collapsing to 0,
    // so the close direction actually animates instead of jumping from `none`.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setMaxHeight('0px'))
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  return (
    <div
      className={`ui-collapsible overflow-hidden ${className ?? ''}`}
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
