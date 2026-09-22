import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight } from '../../lib/icons'
import { Icon } from './Icon'

export interface MenuItem {
  id: string
  label: string
  /** A second, quieter line under the label. */
  hint?: string
  /** Rendered as a radio item with a check when true, and unchecked when false. */
  checked?: boolean
  onSelect?: () => void
  /** A fly-out of further items; an item with children has no `onSelect`. */
  children?: MenuItem[]
}

export interface MenuPosition {
  x: number
  y: number
}

interface Props {
  /** Where the pointer was, in viewport coordinates. */
  at: MenuPosition
  items: MenuItem[]
  onClose: () => void
  /** The accessible name of the menu. */
  label: string
}

const PANEL_W = 184
const ITEM_H = 34
const EDGE = 8
// The panel's inner padding, which is also what keeps the corners concentric:
// the panel is radius-sm (3px) and a row sits 4px inside it, so the row's own
// corner has to be 3 − 4, which is none. A rounded row inside a near-square
// panel is the mismatch a nested radius always produces.
const PAD = 4
// Room between a panel and its fly-out.
const GAP = 4

/** Keeps a panel of `count` rows inside the viewport. */
function clamp(x: number, y: number, count: number): MenuPosition {
  const h = count * ITEM_H + EDGE
  return {
    x: Math.max(EDGE, Math.min(x, window.innerWidth - PANEL_W - EDGE)),
    y: Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE)),
  }
}

// The suite's floating-layer surface, per kollektiv/design/README.md: opaque
// `bg-overlay` (bg-elevated composited over the base, so it reads as the same
// panel wherever it lands and stays legible over a busy tile), and no shadow
// or blur. The suite has no shadow tokens, deliberately: elevation is the
// surface. The README pairs that surface with a hairline border; this menu
// goes without one, on purpose, since the opaque surface already separates it
// from anything behind it and the line read as a bevel on a panel this small.
// The near-square corner is radius-sm. Whether the other floating panels
// follow is #415's question; they still carry a drop shadow from before.
//
// Rows are inset from the panel edge on every side, so a hovered row is a
// highlight inside the panel rather than a stripe that reaches its edge on
// the sides and stops short of it at the top and bottom.
const PANEL = 'fixed z-popover bg-overlay overflow-hidden rounded-sm p-1'

function Row({
  item,
  onOpen,
  onDone,
}: {
  item: MenuItem
  onOpen?: () => void
  onDone: () => void
}) {
  const radio = item.checked !== undefined
  const parent = item.children !== undefined
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? item.checked : undefined}
      aria-haspopup={parent ? 'menu' : undefined}
      onMouseEnter={onOpen}
      onClick={() => {
        if (parent) {
          onOpen?.()
          return
        }
        item.onSelect?.()
        onDone()
      }}
      className={`hover:bg-hover flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-colors ${
        item.checked ? 'text-accent' : 'text-text-primary'
      }`}
    >
      {radio && (
        <Icon
          icon={Check}
          size="xs"
          className={`text-accent ${item.checked ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs">{item.label}</span>
        {item.hint && <span className="text-text-faint text-2xs">{item.hint}</span>}
      </span>
      {parent && <Icon icon={ChevronRight} size="xs" className="text-text-faint" />}
    </button>
  )
}

/**
 * A menu at the pointer: what a right-click opens.
 *
 * Portaled to `body` on `z-popover`, the way the scheduler's quick-add menu
 * is, so it escapes whatever stacking context the click happened in and sits
 * over a maximized tile. The backdrop is the same layer and an earlier
 * sibling, so one value orders the two (lib/layers.ts). A right-click on the
 * backdrop closes it rather than opening a second one; Escape closes it too.
 *
 * An item with `children` opens a fly-out beside it on hover or click. The
 * fly-out sits `GAP` past the panel's right edge, level with its row, and is
 * clamped like the panel. Opening is idempotent: hovering the row again while
 * its fly-out is open leaves the fly-out where it is, rather than measuring a
 * second anchor and nudging it. One level: nothing here needs a third.
 *
 * The backdrop stops its events. The menu is a portal, and React bubbles a
 * portal's synthetic events to its React ancestors, so without that a
 * right-click on the backdrop reached the header that opened the menu and
 * reopened it at the new pointer position, with the fly-out still where it
 * was measured. A right-click on the backdrop closes this menu and is then
 * replayed, as a native event, at whatever is under the pointer, so
 * right-clicking another tile's header opens that tile's menu in one gesture.
 */
export function ContextMenu({ at, items, onClose, label }: Props) {
  const [open, setOpen] = useState<{ id: string; at: MenuPosition } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const pos = clamp(at.x, at.y, items.length)

  const openFlyout = (id: string) => {
    setOpen((prev) => {
      if (prev?.id === id) return prev
      const panel = panelRef.current?.getBoundingClientRect()
      const row = rows.current.get(id)?.getBoundingClientRect()
      const x = panel ? panel.right + GAP : pos.x + PANEL_W + GAP
      const y = row ? row.top - PAD : pos.y
      return { id, at: { x, y } }
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const child = open ? items.find((i) => i.id === open.id) : undefined
  const childPos =
    child?.children && open ? clamp(open.at.x, open.at.y, child.children.length) : null

  return createPortal(
    <>
      <div
        className="z-popover fixed inset-0"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const { clientX, clientY } = e
          onClose()
          requestAnimationFrame(() => {
            const target = document.elementFromPoint?.(clientX, clientY)
            target?.dispatchEvent(
              new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }),
            )
          })
        }}
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label={label}
        className={`${PANEL} w-[184px]`}
        // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
        style={{ left: pos.x, top: pos.y }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            ref={(el) => {
              if (el) rows.current.set(item.id, el)
              else rows.current.delete(item.id)
            }}
            onMouseEnter={item.children ? () => openFlyout(item.id) : () => setOpen(null)}
          >
            <Row
              item={item}
              onDone={onClose}
              onOpen={item.children ? () => openFlyout(item.id) : undefined}
            />
          </div>
        ))}
      </div>
      {child?.children && childPos && (
        <div
          role="menu"
          aria-label={child.label}
          className={`${PANEL} w-[184px]`}
          // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
          style={{ left: childPos.x, top: childPos.y }}
        >
          {child.children.map((item) => (
            <Row key={item.id} item={item} onDone={onClose} />
          ))}
        </div>
      )}
    </>,
    document.body,
  )
}
