import { useEffect, useState } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { GetStatsHistory } from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { EVENTS } from '../../lib/constants'
import { readOr } from '../../lib/ipc'

// Aliased rather than redeclared, per the note in `types/index.ts`: a field
// added to the Go struct would otherwise be silently missing here.
export type StatsSnapshot = models.StatsSnapshot

const MAX_HISTORY = 360

export function usePerformanceHistory(serverId: string): StatsSnapshot[] {
  const [history, setHistory] = useState<StatsSnapshot[]>([])

  useEffect(() => {
    // Cleared first, so the gap before the fetch resolves renders as an empty
    // chart rather than as the previous server's. The `if (h?.length)` guard
    // this replaces meant a server with no history kept that chart on screen,
    // and the then-unfiltered listener below appended the new server's samples
    // to it, so the chart was two servers spliced together with nothing to say
    // so (#234).
    setHistory([])
    let stale = false

    // Through `readOr` rather than a bare `.catch()`: with no Wails bridge the
    // binding throws synchronously instead of rejecting, so the `.catch()` was
    // attached to a call that never returned and the throw escaped this effect
    // to the app-level ErrorBoundary. See lib/ipc.ts.
    readOr(() => GetStatsHistory(serverId), null).then((h) => {
      // Two switches in flight resolve in no guaranteed order.
      if (stale) return
      setHistory((h ?? []) as StatsSnapshot[])
    })

    let cancel: (() => void) | undefined
    try {
      cancel = EventsOn(EVENTS.STATS_SNAPSHOT, (snap: StatsSnapshot & { serverID?: string }) => {
        if (snap.serverID && snap.serverID !== serverId) return
        setHistory((prev) => {
          const next = [...prev, snap]
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
        })
      })
    } catch {
      /* Wails runtime unavailable in dev without backend */
    }

    return () => {
      stale = true
      cancel?.()
    }
  }, [serverId])

  return history
}
