import { useCallback, useEffect, useState } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { ModCategories, ModCurseForgeStatus } from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { EVENTS } from '../../lib/constants'
import { readOr } from '../../lib/ipc'

export type CurseForgeStatus = models.CurseForgeStatus

/** Where the browse panel searches. One at a time: offsets do not compose
 *  across providers, so the panel picks a source rather than merging (#251). */
export type ModSource = 'modrinth' | 'curseforge'

/**
 * The browse panel's source, whether CurseForge has a key, and the source's
 * categories. CurseForge is never asked for categories without a key: the
 * panel says a key is needed instead. useMods wraps setSource to clear the
 * other source's results and selection, so a Modrinth page never sits under
 * a CurseForge heading while the first search runs.
 */
export function useModSource(serverId: string) {
  const [source, setSource] = useState<ModSource>('modrinth')
  // Null until the first answer.
  const [curseForge, setCurseForge] = useState<CurseForgeStatus | null>(null)
  const [categories, setCategories] = useState<string[]>([])

  // Read on mount, and again whenever a key is saved or removed in Settings,
  // which announces it app-wide.
  useEffect(() => {
    const load = async () => {
      setCurseForge(await readOr(() => ModCurseForgeStatus(), null))
    }
    void load()
    let off: (() => void) | undefined
    try {
      off = EventsOn(EVENTS.MOD_SOURCES_CHANGED, () => void load())
    } catch {
      /* Wails runtime unavailable in dev without backend */
    }
    return () => off?.()
  }, [])

  const curseForgeReady = !!curseForge && (curseForge.keySet || curseForge.builtIn)

  const loadCategories = useCallback(async () => {
    if (!serverId) return
    setCategories([])
    if (source === 'curseforge' && !curseForgeReady) return
    try {
      const cats = (await ModCategories(serverId, source)) as string[]
      setCategories(cats ?? [])
    } catch {
      // best-effort; UI falls back gracefully
    }
  }, [serverId, source, curseForgeReady])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  return { source, setSource, curseForge, categories }
}
