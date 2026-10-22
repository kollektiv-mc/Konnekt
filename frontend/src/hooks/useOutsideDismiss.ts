import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Marks a layer that is portalled out of the menu it belongs to (a fly-out).
 * A press inside one is a press inside the menu, though the DOM says it is
 * outside every ref the menu holds.
 */
export const MENU_LAYER_ATTR = 'data-menu-layer'

/**
 * Closes a menu on a press outside it, with no backdrop in the way.
 *
 * A backdrop (`fixed inset-0`) eats the press that dismisses, so reaching a
 * neighbouring button or the canvas took two clicks, one to close and one to
 * act. This listens on the document instead, in the capture phase, and neither
 * stops nor prevents the event: the press that closes the menu is also the one
 * that selects the node, starts the pan or opens the next menu.
 *
 * `inside` are the elements a press may land on without dismissing: the panel
 * and the button that opens it. The trigger is on the list so that its own
 * click can toggle the menu shut rather than the press closing it and the click
 * opening it again.
 *
 * Escape closes it too, ahead of the maximized tile's own window listener
 * (which would close the tile), so one Escape closes one thing. Escape typed
 * into a field, or inside a fly-out, is left to that field or fly-out: each
 * backs out of its own state and stops the event, which a listener in front of
 * it would pre-empt.
 */
export function useOutsideDismiss(
  active: boolean,
  onDismiss: () => void,
  inside: (RefObject<HTMLElement | null> | undefined)[],
  /**
   * The menu has no fields of its own to back out of, so Escape closes it even
   * from one: the quick-add list keeps focus in its search box, and left to
   * the field the keystroke went on to close the maximized tile as well.
   */
  escapeFromFields = false,
) {
  // Held in a ref so the listeners stay put across renders, which hand this a
  // fresh array and a fresh callback each time.
  const latest = useRef({ onDismiss, inside })
  latest.current = { onDismiss, inside }

  useEffect(() => {
    if (!active) return
    const isInside = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false
      if (target.closest(`[${MENU_LAYER_ATTR}]`)) return true
      return latest.current.inside.some((ref) => ref?.current?.contains(target))
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target)) latest.current.onDismiss()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target
      if (!escapeFromFields && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement))
        return
      if (t instanceof Element && t.closest(`[${MENU_LAYER_ATTR}]`)) return
      e.stopPropagation()
      latest.current.onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, escapeFromFields])
}
