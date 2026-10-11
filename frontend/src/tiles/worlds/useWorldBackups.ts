import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { ListBackups, RestoreBackup, DeleteBackup } from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { EVENTS } from '../../lib/constants'
import { readOr } from '../../lib/ipc'

export type WorldBackup = models.Backup

const NONE: WorldBackup[] = []

/** The backups of one world, newest first as ListBackups returns them. */
export function backupsOfWorld(backups: WorldBackup[], world: string): WorldBackup[] {
  return backups.filter((b) => b.world === world)
}

/**
 * The world-kind backups of one server, for the Worlds tile's HUD.
 *
 * Self-contained on purpose: the Backups tile has its own hook and this one
 * does not import it. The result is stamped with the server it was fetched for,
 * so the gap between a switch and the new fetch resolving shows no backups
 * rather than the previous server's under the new one's name.
 */
export function useWorldBackups(serverId: string) {
  const [fetched, setFetched] = useState<{ serverId: string; backups: WorldBackup[] }>({
    serverId: '',
    backups: NONE,
  })
  const [error, setError] = useState<string | null>(null)
  // Replies can land out of order (an event refetch racing an action's); only
  // the latest request is allowed to write.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    if (!serverId) return
    const seq = ++latest.current
    // null, not [], on a failed read: a transient error must not blank a list
    // the user is looking at.
    const result = await readOr(() => ListBackups(serverId), null)
    if (seq !== latest.current || result === null) return
    setFetched({ serverId, backups: (result ?? []).filter((b) => b.kind === 'world') })
  }, [serverId])

  useEffect(() => {
    setError(null)
    refresh()
  }, [refresh])

  useEffect(() => {
    // The events that change what the list holds, or may have: a world backup
    // finishing or failing (a failed one can leave a partial zip behind), and a
    // restore. Each is named as EVENTS.X so lib/serverScoping.test.ts can
    // classify the registration.
    const offs: Array<() => void> = []
    try {
      // An absent or empty id still refreshes, as everywhere else (#237).
      const mine = (p?: { serverID?: string }) => {
        if (!p?.serverID || p.serverID === serverId) refresh()
      }
      offs.push(EventsOn(EVENTS.BACKUP_COMPLETED, mine))
      offs.push(EventsOn(EVENTS.BACKUP_FAILED, mine))
      offs.push(EventsOn(EVENTS.RESTORE_COMPLETED, mine))
      offs.push(EventsOn(EVENTS.RESTORE_FAILED, mine))
    } catch {
      /* Wails runtime unavailable in dev without backend */
    }
    return () => {
      for (const off of offs) off()
    }
  }, [serverId, refresh])

  // Write actions record the failure and rethrow, so the caller can say why.
  const restore = useCallback(
    async (filename: string) => {
      setError(null)
      try {
        await RestoreBackup(serverId, filename)
        await refresh()
      } catch (e) {
        setError(String(e))
        throw e
      }
    },
    [serverId, refresh],
  )

  const remove = useCallback(
    async (filename: string) => {
      setError(null)
      try {
        await DeleteBackup(serverId, filename)
        await refresh()
      } catch (e) {
        setError(String(e))
        throw e
      }
    },
    [serverId, refresh],
  )

  const backups = useMemo(
    () => (fetched.serverId === serverId ? fetched.backups : NONE),
    [fetched, serverId],
  )

  return { backups, error, refresh, restore, remove }
}
