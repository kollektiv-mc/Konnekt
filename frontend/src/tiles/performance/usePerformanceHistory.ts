import { useEffect, useState } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { GetStatsHistory } from '../../../wailsjs/go/main/App'
import { EVENTS } from '../../lib/constants'

export interface StatsSnapshot {
  timestamp: number
  tps: number
  ramUsedMB: number
  ramTotalMB: number
  cpuPercent: number
  players: number
}

const MAX_HISTORY = 360

export function usePerformanceHistory(serverId: string): StatsSnapshot[] {
  const [history, setHistory] = useState<StatsSnapshot[]>([])

  useEffect(() => {
    GetStatsHistory(serverId)
      .then((h) => {
        if (h?.length) setHistory(h as StatsSnapshot[])
      })
      .catch(() => {})

    let cancel: (() => void) | undefined
    try {
      cancel = EventsOn(EVENTS.STATS_SNAPSHOT, (snap: StatsSnapshot) => {
        setHistory((prev) => {
          const next = [...prev, snap]
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
        })
      })
    } catch {
      /* Wails runtime unavailable in dev without backend */
    }

    return () => {
      cancel?.()
    }
  }, [serverId])

  return history
}
