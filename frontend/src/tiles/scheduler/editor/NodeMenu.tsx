import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOutsideDismiss } from '../../../hooks/useOutsideDismiss'
import { NO_GRAPH_KEYS } from './blockMeta'
import { EditMenuRows } from './EditMenu'
import type { EditRow } from './editMenuRows'
import { placeQuickAdd, type Point, type Size } from './quickAddPlacement'

// First-paint guess only; the panel is measured before the browser paints.
const INITIAL_PANEL: Size = { w: 224, h: 0 }

interface Props {
  rows: EditRow[]
  /** Where the pointer was, in viewport coordinates. */
  screenPos: Point
  onClose: () => void
  /** An exit is playing (NodeMenuHost keeps the menu mounted for it). */
  leaving?: boolean
}

/**
 * The edit menu at the pointer, for a right-click on a block (#181). The rows
 * are the toolbar's (`editMenuRows`, rendered by `EditMenuRows`), so only the
 * surface is its own: a fixed panel portalled to `body`, placed by the same
 * helper the quick-add list uses so it flips and clamps at the window's edges.
 */
export function NodeMenu({ rows, screenPos, onClose, leaving = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelSize, setPanelSize] = useState<Size>(INITIAL_PANEL)

  // Measured before paint so the flip and the clamp use the real size.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPanelSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }))
  }, [rows.length])

  const { primaryLeft, primaryTop } = placeQuickAdd(screenPos, panelSize, {
    w: window.innerWidth,
    h: window.innerHeight,
  })

  // A press outside closes it with no backdrop to eat that press, and Escape
  // closes it ahead of the maximized tile's own listener. A fly-out is
  // portalled out of the panel; it carries MENU_LAYER_ATTR and counts as inside.
  useOutsideDismiss(!leaving, onClose, [panelRef])

  // Grows from the corner it opened at, the far one where it flipped.
  const originX = primaryLeft < screenPos.x ? 'right' : 'left'
  const originY = primaryTop < screenPos.y ? 'bottom' : 'top'

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label="Edit"
      aria-hidden={leaving || undefined}
      inert={leaving}
      // Portalled out of the canvas, so the canvas's own contextmenu guard does
      // not cover it: keep the WebView's native menu off the rows too.
      onContextMenu={(e) => e.preventDefault()}
      // Both menu classes live in scheduler.css; NO_GRAPH_KEYS because React Flow
      // binds Delete to the document, wherever in the tree the menu is (#159).
      className={`z-popover bg-overlay border-hairline border-border-subtle fixed w-56 overflow-hidden rounded-lg ${NO_GRAPH_KEYS} ${leaving ? 'menu-out pointer-events-none' : 'menu-in'}`}
      // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
      style={{ left: primaryLeft, top: primaryTop, transformOrigin: `${originX} ${originY}` }}
    >
      <EditMenuRows rows={rows} active={!leaving} onDone={onClose} />
    </div>,
    document.body,
  )
}
