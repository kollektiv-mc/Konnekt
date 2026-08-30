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

    const off = EventsOn(EVENTS.COMMANDS_CHANGED, () => {
      void reload()
    })
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [])
}
