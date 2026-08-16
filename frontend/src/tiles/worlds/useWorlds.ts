import { useState, useCallback, useEffect } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import {
  ListWorlds,
  SetActiveWorld,
  DeleteWorld,
  RenameWorld,
  DuplicateWorld,
  OpenWorldFolder,
  BackupWorld,
} from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { EVENTS } from '../../lib/constants'

export type WorldSystem = models.WorldSystem

export function useWorlds() {
  const activeId = useServerConfigStore((s) => s.activeId)
  const [worlds, setWorlds] = useState<WorldSystem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!activeId) {
      setWorlds([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await ListWorlds(activeId)
      setWorlds(result ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [activeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Re-scan after server lifecycle and backup events that may affect world state.
  useEffect(() => {
    const off1 = EventsOn(EVENTS.SERVER_STOPPED, refresh)
    const off2 = EventsOn(EVENTS.BACKUP_COMPLETED, refresh)
    return () => {
      off1()
      off2()
    }
  }, [refresh])

  const setActive = useCallback(
    async (name: string) => {
      if (!activeId) return
      await SetActiveWorld(activeId, name)
      await refresh()
    },
    [activeId, refresh],
  )

  const deleteWorld = useCallback(
    async (name: string) => {
      if (!activeId) return
      await DeleteWorld(activeId, name)
      await refresh()
    },
    [activeId, refresh],
  )

  const rename = useCallback(
    async (oldName: string, newName: string) => {
      if (!activeId) return
      await RenameWorld(activeId, oldName, newName)
      await refresh()
    },
    [activeId, refresh],
  )

  const duplicate = useCallback(
    async (name: string, newName: string) => {
      if (!activeId) return
      await DuplicateWorld(activeId, name, newName)
      await refresh()
    },
    [activeId, refresh],
  )

  const openFolder = useCallback(
    async (name: string) => {
      if (!activeId) return
      await OpenWorldFolder(activeId, name)
    },
    [activeId],
  )

  const backup = useCallback(
    async (name: string) => {
      if (!activeId) return
      await BackupWorld(activeId, name)
      await refresh()
    },
    [activeId, refresh],
  )

  return {
    worlds,
    loading,
    error,
    refresh,
    setActive,
    deleteWorld,
    rename,
    duplicate,
    openFolder,
    backup,
  }
}
