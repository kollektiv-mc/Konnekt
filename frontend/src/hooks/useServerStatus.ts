import { useCallback, useEffect } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { GetServerStatus } from '../../wailsjs/go/main/App'
import { useServerStore } from '../stores/useServerStore'
import { EVENTS } from '../lib/constants'
import type { ServerStatus } from '../types'

/**
 * Keeps `useServerStore` holding the active server's status.
 *
 * Mounted **once, in `App`** — not per tile. It used to live in the stats tile,
 * which made the whole store's freshness depend on that one tile being on the
 * canvas. Six components read `status.running` (stats, mods, worlds, config and
 * both backups views) and tiles are removable, so taking Stats off the canvas
 * left every one of them reading the store's default `running: false` forever.
 * The visible cost was `BackupsSummary` skipping its "stop the server first"
 * dialog and backing up a live world (HEALTH_LOG.md, 2026-08-20).
 *
 * That placement follows the one-store-per-domain rule rather than breaking
 * tile self-containment: server status is a shared domain, the stats tile was
 * only its first reader, and `App` already owns the equivalent hydration for
 * settings plus eleven other event subscriptions.
 *
 * Writes only — it deliberately does not subscribe to `status`. Reading it here
 * would re-render the whole app on every 10s tick; consumers select the slice
 * they need straight from `useServerStore`.
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
 * full tick, so a start or stop shows at once. server:state carries the whole
 * change it announces (the lifecycle phase, #108), so it is applied directly
 * with no refetch — the backend emits it only on an actual transition.
 */
export function useServerStatusSync(serverId: string) {
  const setStatus = useServerStore((s) => s.setStatus)
  const setServerState = useServerStore((s) => s.setServerState)
  const setReachable = useServerStore((s) => s.setReachable)

  const refresh = useCallback(async () => {
    try {
      const s = await GetServerStatus(serverId)
      if (s) setStatus(s)
      setReachable(true)
    } catch {
      // Keep the last known status rather than blanking it, but stop claiming
      // it is current: a tile that renders "0 players" off a status it could
      // not fetch is indistinguishable from a healthy, idle server.
      setReachable(false)
    }
  }, [serverId, setStatus, setReachable])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    let offs: Array<() => void> = []
    try {
      offs = [
        EventsOn(EVENTS.SERVER_STATUS, (s?: ServerStatus) => {
          if (s) setStatus(s)
          setReachable(true)
        }),
        EventsOn(EVENTS.SERVER_STARTED, refresh),
        EventsOn(EVENTS.SERVER_STOPPED, refresh),
        EventsOn(EVENTS.SERVER_STATE, (p?: { state?: string; serverId?: string }) => {
          if (p?.state) setServerState(p.state, p.serverId ?? '')
          setReachable(true)
        }),
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
  }, [refresh, setStatus, setServerState, setReachable])
}
