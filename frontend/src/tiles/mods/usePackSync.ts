import { useCallback, useEffect, useState } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import {
  ModApplySync,
  ModClearPackSource,
  ModPlanSync,
  ModRollbackSync,
  ModSetPackSource,
  ModSyncState,
} from '../../../wailsjs/go/main/App'
import { models } from '../../../wailsjs/go/models'
import { EVENTS } from '../../lib/constants'
import { errMsg, readOr } from '../../lib/ipc'

export type PackSource = models.PackSource
export type ModSyncPlan = models.ModSyncPlan
export type ModSyncRow = models.ModSyncRow
export type ModSyncRecord = models.ModSyncRecord

/** What the person types to bind a pack: everything but the server. */
export interface PackSourceInput {
  location: 'url' | 'folder'
  address: string
  exclude: string[]
  include: string[]
}

/**
 * The pack a server follows, and the plan of what syncing it would do.
 *
 * The plan is never fetched on its own: making one downloads the pack's jars
 * into the cache, which is the person's to start. A change to the source or
 * an applied sync drops the plan, so what Apply sends is always a plan read
 * against the current source.
 */
export function usePackSync(serverId: string) {
  const [source, setSource] = useState<PackSource | null>(null)
  const [history, setHistory] = useState<ModSyncRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<ModSyncPlan | null>(null)
  const [busy, setBusy] = useState<'plan' | 'apply' | 'rollback' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const st = await readOr(() => ModSyncState(serverId), null)
    setSource(st?.source ?? null)
    setHistory(st?.history ?? [])
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    setPlan(null)
    setError(null)
    setLoading(true)
    refresh()
    let off: (() => void) | undefined
    try {
      off = EventsOn(EVENTS.MOD_SYNC_CHANGED, (d?: { serverID?: string }) => {
        if (d?.serverID === serverId) refresh()
      })
    } catch {
      /* Wails runtime unavailable in dev without backend */
    }
    return () => off?.()
  }, [serverId, refresh])

  /** Runs one write, recording its error and rethrowing it for the caller. */
  const run = useCallback(
    async <T>(kind: NonNullable<typeof busy>, call: () => Promise<T>): Promise<T> => {
      setBusy(kind)
      setError(null)
      try {
        return await call()
      } catch (e: unknown) {
        setError(errMsg(e))
        throw e
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const saveSource = useCallback(
    async (input: PackSourceInput) => {
      await run('save', () =>
        ModSetPackSource(
          serverId,
          models.PackSource.createFrom({ serverID: serverId, format: 'packwiz', ...input }),
        ),
      )
      setPlan(null)
      await refresh()
    },
    [serverId, run, refresh],
  )

  const clearSource = useCallback(async () => {
    await run('save', () => ModClearPackSource(serverId))
    setPlan(null)
    await refresh()
  }, [serverId, run, refresh])

  const check = useCallback(async () => {
    setPlan(await run('plan', () => ModPlanSync(serverId)))
  }, [serverId, run])

  const apply = useCallback(async () => {
    if (!plan) return
    // A refused apply keeps the plan on screen beside its error, which says
    // to check again. An applied one is history now, read from the state.
    await run('apply', () => ModApplySync(serverId, plan.planId))
    setPlan(null)
    await refresh()
  }, [serverId, plan, run, refresh])

  const rollback = useCallback(async () => {
    await run('rollback', () => ModRollbackSync(serverId))
    setPlan(null)
    await refresh()
  }, [serverId, run, refresh])

  return {
    source,
    history,
    loading,
    plan,
    busy,
    error,
    saveSource,
    clearSource,
    check,
    apply,
    rollback,
  }
}
