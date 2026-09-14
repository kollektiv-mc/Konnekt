import { useEffect, useRef } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { GetConsoleHistory } from '../../wailsjs/go/main/App'
import { useConsoleStore } from '../stores/useConsoleStore'
import type { IncomingLine } from '../stores/useConsoleStore'
import { EVENTS } from '../lib/constants'
import { readOr } from '../lib/ipc'

/** A log:line payload, which carries the id of the server it came from (#233). */
type IncomingLineEvent = IncomingLine & { serverID?: string }

/**
 * Keeps `useConsoleStore` holding the active server's output.
 *
 * Mounted **once, in `App`**, for the same reason `useServerStatusSync` is: the
 * console store outlives the console tile, so lines keep accumulating while the
 * tile is off the canvas and are all there when it comes back. Lifted out of
 * `App` as a hook so this logic can be tested without rendering the whole app,
 * matching `useServerStatusSync` and `useCommandsSync`.
 *
 * Two jobs, and the second is what #234 was about.
 *
 * **Batching.** Lines are buffered and flushed on a 150ms interval, so the
 * console re-renders at most ~7x/sec rather than once per line. A busy server
 * emits faster than React can paint.
 *
 * **One console, one server.** Konnekt runs one server at a time today, but the
 * sidebar selection can point somewhere else while a server is still up, and
 * that server goes on emitting. Those lines used to land in the console under
 * the selected server's name, and a switch never cleared what was already
 * there, so the pane could hold two servers' output spliced together with
 * nothing to say so. Now a line is dropped unless it belongs to the active
 * server, and a switch replaces the buffer with `GetConsoleHistory` for the
 * server being switched to. Nothing is lost by dropping: each `serverInstance`
 * keeps its own ring buffer (#232), so switching back replays it.
 */
export function useConsoleSync(serverId: string) {
  // The listener is subscribed once and deliberately not rebuilt per switch:
  // tearing it down and resubscribing would drop any line arriving in the gap.
  // A ref is how one long-lived listener reads the current id.
  const activeIdRef = useRef(serverId)
  activeIdRef.current = serverId

  const pending = useRef<IncomingLine[]>([])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      // `source` marks a line Konnekt narrated rather than server output (#113)
      // and `outcome` says how that went; both are absent on server lines.
      cleanup = EventsOn(EVENTS.LOG_LINE, (data: IncomingLineEvent) => {
        // An absent or empty id means the line belongs to no server in
        // particular and is kept, matching useMods and useServerStatusSync.
        // That is what the bootstrap instance narrates before any server has
        // started, so dropping it would silence the console on a fresh launch
        // (see NewServerService in backend/services/server.go).
        if (data.serverID && data.serverID !== activeIdRef.current) return
        pending.current.push(data)
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const batch = pending.current
      if (batch.length === 0) return
      pending.current = []
      useConsoleStore.getState().batchAppend(batch)
    }, 150)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    // Clear first, including anything buffered but not yet flushed: a line the
    // previous server emitted a moment before the switch must not arrive after
    // the replay and sit at the bottom of the new server's console.
    useConsoleStore.getState().clear()
    pending.current = []
    if (!serverId) return

    let cancelled = false
    readOr(() => GetConsoleHistory(serverId), null).then((history) => {
      // Two switches in quick succession resolve in no guaranteed order, so a
      // stale reply must not overwrite a newer one.
      if (cancelled || !history) return
      useConsoleStore.getState().loadHistory(history as IncomingLine[])
    })
    return () => {
      cancelled = true
    }
  }, [serverId])
}
