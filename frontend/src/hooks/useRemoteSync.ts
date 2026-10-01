import { useEffect } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useRemoteStore } from '../stores/useRemoteStore'
import { EVENTS } from '../lib/constants'
import { isRemoteBrowser } from '../lib/ipc'

/**
 * Keeps `useRemoteStore` in step with the backend.
 *
 * Mounted **once, in `App`**, like `useCommandsSync`: the Settings pane, the
 * prompts and the title bar's indicator all read the store, and a device
 * waiting for approval has to raise its prompt whether or not Settings is open.
 *
 * `remote:changed` carries no payload. It says something changed (the listener
 * started or idled out, a device is waiting, a session began, an admin call
 * wants an answer) and this re-reads, so there is one description of the state
 * and it is the backend's.
 *
 * In a browser served by the listener this does nothing: the event never
 * crosses the wire and the getter is one a remote client cannot call.
 */
export function useRemoteSync(): void {
  useEffect(() => {
    if (isRemoteBrowser()) return
    const refresh = useRemoteStore.getState().refresh
    void refresh()
    let off = () => {}
    try {
      off = EventsOn(EVENTS.REMOTE_CHANGED, () => {
        void refresh()
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        off()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])
}
