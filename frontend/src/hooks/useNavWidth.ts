import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import { clampNavWidth, NAV_WIDTH_DEFAULT } from '../lib/navWidth'

const viewportWidth = () => (typeof window === 'undefined' ? 0 : window.innerWidth)

/**
 * The left navbar's width, and the drag that changes it.
 *
 * Two sources feed one number. The persisted width in `AppSettings` is what the
 * user chose; the live drag value is what they are choosing right now. The drag
 * wins while it is happening and is dropped on release, at which point the
 * committed setting is already the same value.
 *
 * The commit lands once, on mouseup, rather than per mousemove — a drag is
 * upwards of a hundred frames and every one of them would be a
 * `SaveAppSettings` round trip. This is the same split `TileCrate` makes for
 * `crateOrder`: local state during the gesture, one write at the end.
 *
 * Nothing here reverts a refused write by hand. Clearing the drag value hands
 * rendering back to the store, and the store has already put the old width back
 * and recorded why (see its `update`), so the navbar snaps back on its own.
 *
 * The committed width is *derived* during render rather than copied into state
 * by an effect. An effect runs after the paint, so releasing the handle painted
 * one frame at the old stored width before the new one arrived — a visible
 * snap back and forth on every resize. Deriving it means the release renders
 * once, at the width it was released at.
 */
export function useNavWidth() {
  const stored = useSettingsStore((s) => s.settings.navWidth)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [viewport, setViewport] = useState(viewportWidth)

  const storedRef = useRef(stored)
  storedRef.current = stored

  // A width outlives the window it was chosen in. Re-clamping on resize is what
  // stops a navbar sized in a maximized window from taking half of a restored
  // one. Deliberately not persisted: the stored width is still what the user
  // asked for, so widening the window again brings it back rather than leaving
  // it stuck at whatever the narrowest moment allowed.
  //
  // Held only when the clamp would actually land somewhere new. Most windows
  // are wide enough that it never bites, and every other resize would then be
  // a re-render of the whole app for a width that did not change.
  useEffect(() => {
    const onResize = () => {
      const next = viewportWidth()
      setViewport((prev) =>
        clampNavWidth(storedRef.current, next) === clampNavWidth(storedRef.current, prev)
          ? prev
          : next,
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const width = dragWidth ?? clampNavWidth(stored, viewport)

  const widthRef = useRef(width)
  widthRef.current = width

  const commit = useCallback((next: number) => {
    // Swallowed on purpose: the store reverts `navWidth` and records the reason
    // itself, and this hook renders from that value, so the revert is already
    // the whole undo. Kept only so a mouse handler cannot raise an unhandled
    // rejection.
    useSettingsStore
      .getState()
      .update({ navWidth: next })
      .catch(() => {})
  }, [])

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault() // stop the drag from selecting the text it passes over
      const startX = e.clientX
      const startWidth = widthRef.current
      const at = (clientX: number) => clampNavWidth(startWidth + clientX - startX, viewportWidth())

      const onMove = (ev: MouseEvent) => setDragWidth(at(ev.clientX))
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const next = at(ev.clientX)
        setDragWidth(null)
        commit(next)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [commit],
  )

  const onHandleDoubleClick = useCallback(() => {
    commit(clampNavWidth(NAV_WIDTH_DEFAULT, viewportWidth()))
  }, [commit])

  return { width, onHandleMouseDown, onHandleDoubleClick }
}
