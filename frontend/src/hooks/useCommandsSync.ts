import { useEffect } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useCommandsStore } from '../stores/useCommandsStore'
import { EVENTS } from '../lib/constants'

/**
 * Keeps the Commands tile's buttons in step with Kommands.
 *
 * Mounted **once, in `App`**, for the same reason `useServerStatus` is: two
 * components read this store (the compact panel, which the console tile embeds,
 * and the maximized library), tiles are removable from the canvas, and hanging
 * app-wide freshness on one tile's mount is how five tiles once ended up reading
 * a permanently stale value.
 *
 * Two triggers, one mechanism behind them:
 *
 * - `commands:changed` fires when the backend's poll actually applied a linked
 *   update. It carries no payload worth applying — the merge already happened on
 *   disk, and a second implementation of it here would drift — so this re-reads.
 * - Window focus asks the backend to look now rather than waiting out its 30s
 *   timer. That timer is deliberately slack; this is the path that makes "edit
 *   in Kommands, tab back" feel immediate. If the poll finds a change it emits
 *   the event above, so the reload still happens in exactly one place.
 */
export function useCommandsSync(): void {
  useEffect(() => {
    const reload = useCommandsStore.getState().reload
    const refresh = useCommandsStore.getState().refreshKommands

    // Guarded like every other listener in the app, and for the reason
    // lib/ipc.ts gives: the generated runtime binding dereferences
    // `window.runtime` synchronously, so with no Wails process behind the page
    // it throws a TypeError rather than rejecting. Thrown from an effect body
    // that reaches the app-level ErrorBoundary, and this hook is mounted in
    // `App`, so the unguarded call replaced the entire window with "render
    // error" in the browser-only `frontend-dev` preset.
    //
    // The focus listener stays outside the try: it is a DOM event, it is what
    // makes the preset's own reload path work, and `refresh` handles its own
    // failure.
    let off: (() => void) | undefined
    try {
      off = EventsOn(EVENTS.COMMANDS_CHANGED, () => {
        void reload()
      })
    } catch {
      /* non-Wails context */
    }
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      try {
        off?.()
      } catch {
        /* teardown no-op */
      }
      window.removeEventListener('focus', onFocus)
    }
  }, [])
}
