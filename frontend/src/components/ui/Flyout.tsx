import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MENU_LAYER_ATTR } from '../../hooks/useOutsideDismiss'
import { placeFlyout } from '../../lib/flyoutPlacement'
import type { FlyoutAnchor, FlyoutSize } from '../../lib/flyoutPlacement'

const FOCUSABLE = 'button:not(:disabled), input'

interface FlyoutProps {
  anchor: FlyoutAnchor
  /** The accessible name of the fly-out's menu. */
  label: string
  /** The panel's surface and size; position is this component's. */
  className: string
  children: ReactNode
  onKeyDown?: (e: React.KeyboardEvent) => void
  /** An exit is playing: out of the tab order and the accessibility tree. */
  leaving?: boolean
  /** Move focus into the panel as it mounts, for a fly-out opened from the keyboard. */
  focusOnOpen?: boolean
  onAnimationEnd?: (e: React.AnimationEvent) => void
}

/**
 * A panel beside a menu row, for a menu whose own panel clips its overflow.
 *
 * Portalled to `body` and fixed on `z-popover`, so nothing in the tile (its
 * overflow, its scroll) can cut it, and measured after it mounts so the flip
 * and the clamp use its real size, not a constant that drifts from the CSS. It
 * is hidden for that first frame rather than drawn once in the wrong place.
 * `ContextMenu` and the scheduler's edit menu share it.
 *
 * It carries `MENU_LAYER_ATTR`, so a menu that closes on an outside press
 * counts a press in here as a press in the menu.
 */
export function Flyout({
  anchor,
  label,
  className,
  children,
  onKeyDown,
  leaving = false,
  focusOnOpen = false,
  onAnimationEnd,
}: FlyoutProps) {
  const own = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<FlyoutSize | null>(null)

  // Re-measured when the contents change, since they are what sets its size.
  useLayoutEffect(() => {
    const el = own.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setSize((prev) =>
      prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
    )
  }, [children])

  const { x, y, side } = placeFlyout(anchor, size ?? { w: 0, h: 0 }, {
    w: window.innerWidth,
    h: window.innerHeight,
  })

  useLayoutEffect(() => {
    if (focusOnOpen) own.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [focusOnOpen])

  // Up and down walk the panel's own controls: its rows are in a portal at the
  // end of the document, where Tab would never find them in order.
  const walk = (e: React.KeyboardEvent) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    if (e.target instanceof HTMLInputElement) return
    const items = Array.from(own.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return createPortal(
    <div
      ref={own}
      role="menu"
      aria-label={label}
      aria-hidden={leaving || undefined}
      {...{ [MENU_LAYER_ATTR]: '' }}
      onKeyDown={walk}
      onAnimationEnd={onAnimationEnd}
      className={`z-popover fixed ${className}`}
      // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (flipped and clamped against window dimensions); the origin is the side it grows from
      style={{
        left: x,
        top: y,
        visibility: size ? undefined : 'hidden',
        transformOrigin: side === 'right' ? 'top left' : 'top right',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
