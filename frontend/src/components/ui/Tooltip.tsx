import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { placeTooltip } from './tooltipPlacement'

/** How long the pointer has to rest on the anchor before the tooltip appears. */
export const TOOLTIP_DELAY_MS = 1000
const TOOLTIP_GAP_PX = 8

interface AnchorProps {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void
  'aria-describedby'?: string
}

interface Props {
  /** One short line. Empty or missing renders the child untouched. */
  text: string | null | undefined
  /** A single element that takes pointer handlers (a div, a button). */
  children: ReactElement<AnchorProps>
}

// `hovered` is the element under the pointer, `shown` flips once the delay has
// passed. One object so that dismissing is a single `null`, with no way to be
// left showing a card for an anchor nothing is hovering any more.
interface Hover {
  el: HTMLElement
  shown: boolean
}

/**
 * A styled replacement for the native `title` tooltip: it waits a full second
 * of hover, so a pointer crossing a list never flashes one, then fades in
 * beside the anchor. It goes away the moment the pointer leaves or presses,
 * the anchor's scroller moves, a wheel turns, a drag starts or Escape is hit.
 *
 * The anchor is the single child, which gets `onPointerEnter`/`onPointerLeave`
 * (composed with its own, never replacing them) and `aria-describedby` while
 * the card is up. No ref is taken: the element comes off the enter event, so a
 * child that already owns a ref needs no merging. The card is portalled to
 * body and fixed, because the rows it describes sit in clipped, scrolling
 * panels and, for the quick-add menu, in a portal of their own.
 */
export function Tooltip({ text, children }: Props) {
  const id = useId()
  const [hover, setHover] = useState<Hover | null>(null)

  // Text going empty mid-hover drops the listeners with it.
  const el = text ? (hover?.el ?? null) : null
  // Everything that dismisses a tooltip is a window listener, attached only
  // while an anchor is hovered, so a tooltip nobody is waiting on costs nothing.
  useEffect(() => {
    if (!el) return
    const dismiss = () => setHover(null)
    const timer = setTimeout(() => setHover((h) => h && { ...h, shown: true }), TOOLTIP_DELAY_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    // A scroll event does not bubble, so it is caught in the capture phase, and
    // only the scrollers that actually move the anchor count: a console
    // tailing in another tile must not cancel this card.
    const onScroll = (e: Event) => {
      const t = e.target
      if (t === document || (t instanceof Node && t.contains(el))) dismiss()
    }
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('dragstart', dismiss, true)
    window.addEventListener('wheel', dismiss, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('dragstart', dismiss, true)
      window.removeEventListener('wheel', dismiss, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [el])

  if (!text) return children

  const shown = hover?.shown ?? false
  const own = children.props
  const describedBy = [own['aria-describedby'], shown ? id : undefined].filter(Boolean).join(' ')

  const anchor = cloneElement(children, {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      own.onPointerEnter?.(e)
      setHover({ el: e.currentTarget, shown: false })
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      own.onPointerLeave?.(e)
      setHover(null)
    },
    'aria-describedby': describedBy || undefined,
  })

  return (
    <>
      {anchor}
      {hover &&
        shown &&
        createPortal(<Bubble id={id} text={text} anchor={hover.el} />, document.body)}
    </>
  )
}

function Bubble({ id, text, anchor }: { id: string; text: string; anchor: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  // Measured before paint so the flip and clamp use the card's real size and
  // it is never drawn at the wrong place for a frame.
  useLayoutEffect(() => {
    const card = ref.current
    if (!card) return
    const { width, height } = card.getBoundingClientRect()
    const size = { w: width, h: height }
    const next = placeTooltip(
      anchor.getBoundingClientRect(),
      size,
      {
        w: window.innerWidth,
        h: window.innerHeight,
      },
      TOOLTIP_GAP_PX,
    )
    setPos((prev) => (prev.left === next.left && prev.top === next.top ? prev : next))
  }, [anchor, text])

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      // Opacity only, on the shared fade and its token, off under reduced motion.
      className="border-border-subtle bg-overlay border-hairline z-popover text-text-secondary text-2xs pointer-events-none fixed w-max max-w-60 animate-[lazy-panel-fade-in_var(--duration-fast)_ease-out_both] rounded-lg px-2.5 py-1.5 motion-reduce:animate-none"
      // eslint-disable-next-line no-restricted-syntax -- anchored to the hovered row's measured viewport position
      style={{ left: pos.left, top: pos.top }}
    >
      {text}
    </div>
  )
}
