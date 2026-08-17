import { useCallback, useEffect } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { GetServerStatus } from '../../../wailsjs/go/main/App'
import { useServerStore } from '../../stores/useServerStore'
import { EVENTS } from '../../lib/constants'
import type { ServerStatus } from '../../types'

/**
 * Server status for the stats tile.
 *
 * Event-driven, not polled. `stats.go`'s ticker emits server:status every 10s
 * whether the server is running or not, carrying the same models.ServerStatus
 * that GetServerStatus() returns — so the pushed payload and the fetched one
 * cannot drift apart, and a stop still reaches the UI.
 *
 * Note this is *not* stats:snapshot. That event carries no running/uptime/
 * maxPlayers and is gated on the server being up, so it can never report a
 * server going offline (see backend/services/events.go).
 *
 * server:started/server:stopped refetch immediately rather than waiting up to a
 * full tick, so a start or stop shows at once.
 */
export function useServerStatus(serverId: string) {
  const status = useServerStore((s) => s.status)
  const setStatus = useServerStore((s) => s.setStatus)

  const refresh = useCallback(async () => {
    try {
      const s = await GetServerStatus(serverId)
      if (s) setStatus(s)
    } catch {
      /* Server unreachable — keep the last known status rather than blanking it. */
    }
  }, [serverId, setStatus])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    let offs: Array<() => void> = []
    try {
      offs = [
        EventsOn(EVENTS.SERVER_STATUS, (s?: ServerStatus) => {
          if (s) setStatus(s)
        }),
        EventsOn(EVENTS.SERVER_STARTED, refresh),
        EventsOn(EVENTS.SERVER_STOPPED, refresh),
      ]
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        offs.forEach((off) => off())
      } catch {
        /* teardown no-op */
      }
    }
  }, [refresh, setStatus])

  return { status, refresh }
}
