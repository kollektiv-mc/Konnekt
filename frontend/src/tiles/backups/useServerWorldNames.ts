import { useEffect, useState } from 'react'
import { ListWorlds } from '../../../wailsjs/go/main/App'
import { readOr } from '../../lib/ipc'

export interface ServerWorld {
  name: string
  active: boolean
}

interface Loaded {
  serverId: string
  worlds: ServerWorld[]
}

/**
 * The names of the worlds on disk, for the world view's "Back up now" picker.
 *
 * This tile's own read rather than `tiles/worlds/useWorlds`: tiles do not import
 * one another, and the picker needs only a name and whether it is the active one.
 * The result is stamped with the server it was fetched for, so a switch shows
 * nothing rather than the previous server's worlds while the new list loads.
 */
export function useServerWorldNames(serverId: string): ServerWorld[] {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    readOr(() => ListWorlds(serverId), []).then((result) => {
      if (cancelled) return
      setLoaded({
        serverId,
        worlds: (result ?? []).map((w) => ({ name: w.name, active: w.active })),
      })
    })
    return () => {
      cancelled = true
    }
  }, [serverId])

  return loaded?.serverId === serverId ? loaded.worlds : []
}
