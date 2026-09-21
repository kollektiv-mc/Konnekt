import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  /** The id of an item whose fly-out is open from the first paint. */
  openChild?: string
}

const PANEL_W = 184
const ITEM_H = 34
const EDGE = 8

/** Keeps a panel of `count` rows inside the viewport. */
function clamp(x: number, y: number, count: number): MenuPosition {
  const h = count * ITEM_H + EDGE
  return {
    x: Math.max(EDGE, Math.min(x, window.innerWidth - PANEL_W - EDGE)),
    y: Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE)),
  }
}

const PANEL =
  'fixed z-popover bg-elevated border-hairline border-border-subtle overflow-hidden rounded-lg py-1 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md'

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
 * An item with `children` opens a fly-out beside it on hover or click, or
 * from the first paint when it is `openChild`, so a menu whose only entry is
 * a group does not ask for a second motion before it shows anything. The
 * fly-out is positioned from the row it belongs to, measured when it opens,
 * and clamped like the panel. One level: nothing here needs a third.
 *
 * The backdrop stops its events. The menu is a portal, and React bubbles a
 * portal's synthetic events to its React ancestors, so without that a
 * right-click on the backdrop reached the header that opened the menu and
 * reopened it at the new pointer position, with the fly-out still where it
 * was measured. A right-click on the backdrop closes this menu and is then
 * replayed, as a native event, at whatever is under the pointer, so
 * right-clicking another tile's header opens that tile's menu in one gesture.
 */
export function ContextMenu({ at, items, onClose, label, openChild }: Props) {
  const [open, setOpen] = useState<{ id: string; at: MenuPosition } | null>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const pos = clamp(at.x, at.y, items.length)

  useLayoutEffect(() => {
    if (!openChild) return
    const row = rows.current.get(openChild)
    if (!row) return
    const r = row.getBoundingClientRect()
    setOpen({ id: openChild, at: { x: r.right + 2, y: r.top - 4 } })
  }, [openChild])

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
            onMouseEnter={
              item.children
                ? (e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setOpen({ id: item.id, at: { x: r.right + 2, y: r.top - 4 } })
                  }
                : () => setOpen(null)
            }
          >
            <Row
              item={item}
              onDone={onClose}
              onOpen={
                item.children
                  ? () => {
                      if (open?.id !== item.id) {
                        // Click on a parent before any hover: anchor beside the
                        // panel's own edge, since no row has been measured yet.
                        setOpen({ id: item.id, at: { x: pos.x + PANEL_W + 2, y: pos.y } })
                      }
                    }
                  : undefined
              }
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
