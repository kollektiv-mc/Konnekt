import { useState, useEffect } from 'react'
import { GetBackupWorlds } from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { EVENTS } from '../../lib/constants'
import { readOr } from '../../lib/ipc'

export type WorldSystem = models.WorldSystem

export function useBackupWorlds(serverId: string, filename: string | undefined): WorldSystem[] {
  const [worlds, setWorlds] = useState<WorldSystem[]>([])
  // Bumped when a backup for this server completes/fails, so the focused
  // backup's world list is refetched even though its filename didn't change
  // (the in-progress zip finishing writing doesn't change its name).
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!filename) {
      setWorlds([])
      return
    }
    let cancelled = false
    // The fallback collapses what used to be a then/catch pair setting the same
    // empty list, and covers the no-bridge case the `.catch()` could not: the
    // binding threw before there was a promise to attach it to.
    readOr(() => GetBackupWorlds(serverId, filename), []).then((result) => {
      if (!cancelled) setWorlds(result ?? [])
    })
    // Keep previous planets visible while the new ones load (no flash to empty).
    return () => {
      cancelled = true
    }
  }, [serverId, filename, nonce])

  useEffect(() => {
    let c1: (() => void) | undefined
    let c2: (() => void) | undefined
    try {
      c1 = EventsOn(EVENTS.BACKUP_COMPLETED, (data?: { serverID?: string }) => {
        if (data?.serverID === serverId) setNonce((n) => n + 1)
      })
      c2 = EventsOn(EVENTS.BACKUP_FAILED, (data?: { serverID?: string }) => {
        if (data?.serverID === serverId) setNonce((n) => n + 1)
      })
    } catch {
      /* Wails runtime unavailable in dev without backend */
    }
    return () => {
      c1?.()
      c2?.()
    }
  }, [serverId])

  return worlds
}
