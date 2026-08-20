import { useState, useCallback, useEffect } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { GetPlayerRoster } from '../../../wailsjs/go/main/App'
import type { Player } from '../../types'
import { EVENTS } from '../../lib/constants'

/**
 * Roster data for the players tile.
 *
 * Event-driven, not polled: `server.go` updates its live player map *before*
 * emitting player:joined/player:left, so a refresh triggered by either event
 * always observes post-change state. server:started/server:stopped cover the
 * roster emptying and refilling around a restart.
 *
 * The two views (grid and roster) render on the tile's `maximized` ternary, so
 * this hook lives in the tile root and feeds whichever one is mounted — one
 * fetch either way.
 */
export function usePlayers(serverId: string) {
  const [players, setPlayers] = useState<Player[]>([])
  const [reachable, setReachable] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const list = await GetPlayerRoster(serverId)
      setPlayers(list ?? [])
      setReachable(true)
    } catch {
      // Keep the last known roster rather than blanking it, but stop presenting
      // it as current. Swallowing this outright left an unreachable server
      // rendering "No players online", identical to a server nobody is on
      // (HEALTH_LOG.md, 2026-08-20).
      setReachable(false)
    }
  }, [serverId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    let offs: Array<() => void> = []
    try {
      offs = [
        EventsOn(EVENTS.PLAYER_JOINED, refresh),
        EventsOn(EVENTS.PLAYER_LEFT, refresh),
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
  }, [refresh])

  return { players, reachable, refresh }
}
