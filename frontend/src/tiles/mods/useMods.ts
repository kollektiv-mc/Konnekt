import { useEffect, useState, useCallback, useRef } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import {
  ModSearch,
  ModGetProject,
  ModGetVersions,
  ModGetAllVersions,
  ModResolveDependencies,
  ModInstall,
  ModListInstalled,
  ModSetEnabled,
  ModUninstall,
  ModCategories,
  ModMoreByAuthor,
  ModCheckUpdates,
  ModInstallLocal,
} from '../../../wailsjs/go/main/App'
import { models } from '../../../wailsjs/go/models'
import { EVENTS } from '../../lib/constants'

export type ModProject = models.ModProject
export type ModVersion = models.ModVersion
export type ModSearchResult = models.ModSearchResult
export type ResolvedDependency = models.ResolvedDependency
export type InstalledMod = models.InstalledMod

export class DepsRequiredError extends Error {
  readonly deps: ResolvedDependency[]
  readonly versionId: string
  constructor(deps: ResolvedDependency[], versionId: string) {
    super('Dependencies required')
    this.deps = deps
    this.versionId = versionId
  }
}

export function isDepsRequiredError(e: unknown): e is DepsRequiredError {
  return e instanceof DepsRequiredError
}

export interface ModUpdateInfo {
  updateAvailable: boolean
  latestVersionId: string
  latestVersionNumber: string
}

export interface InstallProgress {
  [fileName: string]: number // 0–100
}

interface ModsState {
  // Installed panel
  installed: InstalledMod[]
  installedLoading: boolean
  installedError: string | null
  refreshInstalled: () => Promise<void>
  setEnabled: (fileName: string, enabled: boolean) => Promise<void>
  uninstall: (fileName: string) => Promise<void>
  installLocal: () => Promise<void>
  changeVersion: (oldFileName: string, newVersionId: string) => Promise<void>

  // Update checks
  updates: Record<string, ModUpdateInfo>
  checkUpdates: () => Promise<void>

  // Browse panel
  searchResults: ModProject[]
  searchTotal: number
  searchOffset: number
  searchLoading: boolean
  searchError: string | null
  search: (query: string, categories: string[], offset?: number, sort?: string) => Promise<void>

  // Categories
  categories: string[]

  // Project detail
  selectedProject: ModProject | null
  projectLoading: boolean
  selectProject: (hit: ModProject) => Promise<void>
  clearProject: () => void

  // Versions
  versions: ModVersion[]
  versionsLoading: boolean
  getVersions: (projectId: string) => Promise<void>
  getAllVersions: (projectId: string) => Promise<void>

  // Dependency resolution
  resolveDeps: (versionId: string) => Promise<ResolvedDependency[]>

  // Install
  install: (versionIds: string[]) => Promise<void>
  installLatest: (projectId: string) => Promise<void>
  installProgress: InstallProgress
  installing: boolean
  installError: string | null

  // More by author
  moreByAuthor: (username: string, excludeProjectId: string) => Promise<ModProject[]>
}

export function useMods(serverId: string): ModsState {
  const [installed, setInstalled] = useState<InstalledMod[]>([])
  const [installedLoading, setInstalledLoading] = useState(false)
  const [installedError, setInstalledError] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, ModUpdateInfo>>({})

  const [searchResults, setSearchResults] = useState<ModProject[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchOffset, setSearchOffset] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [categories, setCategories] = useState<string[]>([])

  const [selectedProject, setSelectedProject] = useState<ModProject | null>(null)
  const [projectLoading, setProjectLoading] = useState(false)

  const [versions, setVersions] = useState<ModVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const [installProgress, setInstallProgress] = useState<InstallProgress>({})
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshInstalled = useCallback(
    async (silent = false) => {
      if (!serverId) return
      if (!silent) setInstalledLoading(true)
      setInstalledError(null)
      try {
        const result = ((await ModListInstalled(serverId)) as InstalledMod[]) ?? []
        // Sort by installedAt desc (newest first); unknowns (0) sink to bottom
        result.sort((a, b) => {
          if (a.installedAt === 0 && b.installedAt === 0) return 0
          if (a.installedAt === 0) return 1
          if (b.installedAt === 0) return -1
          return b.installedAt - a.installedAt
        })
        setInstalled(result)
      } catch (e) {
        setInstalledError(String(e))
      } finally {
        if (!silent) setInstalledLoading(false)
      }
    },
    [serverId],
  )

  const checkUpdates = useCallback(async () => {
    try {
      const result = (await ModCheckUpdates(serverId)) as Record<string, ModUpdateInfo>
      setUpdates(result ?? {})
    } catch {
      // best-effort; UI degrades gracefully (no dots shown)
    }
  }, [serverId])

  // Initial load + polling + event-driven refresh
  useEffect(() => {
    refreshInstalled().then(() => checkUpdates())
    pollTimer.current = setInterval(() => refreshInstalled(true), 10_000)

    const offChanged = EventsOn(EVENTS.MOD_CHANGED, (d?: { serverID?: string }) => {
      if (!d?.serverID || d.serverID === serverId) refreshInstalled(true)
    })
    const offInstalled = EventsOn(EVENTS.MOD_INSTALLED, (d?: { serverID?: string }) => {
      if (!d?.serverID || d.serverID === serverId) refreshInstalled(true)
    })
    const offProgress = EventsOn(
      EVENTS.MOD_INSTALL_PROGRESS,
      (d?: { serverID?: string; fileName?: string; percent?: number }) => {
        if (d?.serverID === serverId && d.fileName) {
          setInstallProgress((prev) => ({ ...prev, [d.fileName!]: d.percent ?? 0 }))
        }
      },
    )

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      offChanged()
      offInstalled()
      offProgress()
    }
  }, [serverId, refreshInstalled])

  const loadCategories = useCallback(async () => {
    if (!serverId) return
    try {
      const cats = (await ModCategories(serverId)) as string[]
      setCategories(cats ?? [])
    } catch {
      // best-effort; UI falls back gracefully
    }
  }, [serverId])

  // Load categories once on mount
  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  const search = useCallback(
    async (query: string, cats: string[], offset = 0, sort = '') => {
      setSearchLoading(true)
      setSearchError(null)
      setSearchOffset(offset)
      try {
        const result = (await ModSearch(serverId, query, offset, cats, sort)) as ModSearchResult
        setSearchResults(result?.hits ?? [])
        setSearchTotal(result?.total ?? 0)
      } catch (e) {
        setSearchError(String(e))
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    },
    [serverId],
  )

  const selectProject = useCallback(async (hit: ModProject) => {
    // Show the hit data immediately (icon, title, downloads, etc.) while the full
    // detail (body, gallery) loads in the background.
    setSelectedProject(hit)
    setProjectLoading(true)
    try {
      const proj = (await ModGetProject(hit.id)) as ModProject
      // Merge: use detail data but fall back to hit fields for anything the
      // detail endpoint doesn't return (e.g. follows from search hits).
      setSelectedProject(
        models.ModProject.createFrom({
          ...hit,
          ...proj,
          follows: proj.follows || hit.follows,
          dateModified: proj.dateModified || hit.dateModified,
          author: proj.author || hit.author,
        }),
      )
    } finally {
      setProjectLoading(false)
    }
  }, [])

  const clearProject = useCallback(() => {
    setSelectedProject(null)
    setVersions([])
  }, [])

  const getVersions = useCallback(
    async (projectId: string) => {
      setVersionsLoading(true)
      try {
        const v = (await ModGetVersions(serverId, projectId)) as ModVersion[]
        setVersions(v ?? [])
      } finally {
        setVersionsLoading(false)
      }
    },
    [serverId],
  )

  const getAllVersions = useCallback(async (projectId: string) => {
    setVersionsLoading(true)
    try {
      const v = (await ModGetAllVersions(projectId)) as ModVersion[]
      setVersions(v ?? [])
    } finally {
      setVersionsLoading(false)
    }
  }, [])

  const resolveDeps = useCallback(
    async (versionId: string): Promise<ResolvedDependency[]> => {
      const deps = (await ModResolveDependencies(serverId, versionId)) as ResolvedDependency[]
      return deps ?? []
    },
    [serverId],
  )

  const install = useCallback(
    async (versionIds: string[]) => {
      setInstalling(true)
      setInstallError(null)
      setInstallProgress({})
      try {
        await ModInstall(serverId, versionIds)
      } catch (e) {
        setInstallError(String(e))
        throw e
      } finally {
        setInstalling(false)
        setInstallProgress({})
      }
    },
    [serverId],
  )

  const installLatest = useCallback(
    async (projectId: string) => {
      // Fetch the latest compatible version and install it (with dep resolution).
      setInstalling(true)
      setInstallError(null)
      setInstallProgress({})
      try {
        const v = (await ModGetVersions(serverId, projectId)) as ModVersion[]
        if (!v || v.length === 0) throw new Error('No compatible version found')
        const latest = v[0]
        const deps = (await ModResolveDependencies(serverId, latest.id)) as ResolvedDependency[]
        const nonTrivial = (deps ?? []).filter((d) => !d.alreadyInstalled)
        if (nonTrivial.length > 0) {
          setInstalling(false)
          throw new DepsRequiredError(deps, latest.id)
        }
        await ModInstall(serverId, [latest.id])
      } catch (e: unknown) {
        if (isDepsRequiredError(e)) throw e // re-throw for dep dialog
        setInstallError(String(e))
        throw e
      } finally {
        setInstalling(false)
        setInstallProgress({})
      }
    },
    [serverId],
  )

  const setEnabled = useCallback(
    async (fileName: string, enabled: boolean) => {
      await ModSetEnabled(serverId, fileName, enabled)
    },
    [serverId],
  )

  const uninstall = useCallback(
    async (fileName: string) => {
      await ModUninstall(serverId, fileName)
    },
    [serverId],
  )

  const installLocal = useCallback(async () => {
    await ModInstallLocal(serverId)
  }, [serverId])

  const changeVersion = useCallback(
    async (oldFileName: string, newVersionId: string) => {
      setInstalling(true)
      setInstallError(null)
      setInstallProgress({})
      try {
        await ModInstall(serverId, [newVersionId])
        // After installing the new version, remove the old file if names differ.
        // The newly installed file name comes from the manifest refresh.
        const updated = ((await ModListInstalled(serverId)) as InstalledMod[]) ?? []
        const newMod = updated.find((m) => m.versionId === newVersionId)
        if (newMod && newMod.fileName !== oldFileName) {
          await ModUninstall(serverId, oldFileName)
        }
      } catch (e) {
        setInstallError(String(e))
        throw e
      } finally {
        setInstalling(false)
        setInstallProgress({})
        setUpdates((prev) => {
          const next = { ...prev }
          delete next[oldFileName]
          return next
        })
      }
    },
    [serverId],
  )

  const moreByAuthor = useCallback(
    async (username: string, excludeProjectId: string): Promise<ModProject[]> => {
      if (!username) return []
      const result = (await ModMoreByAuthor(serverId, username, excludeProjectId)) as ModProject[]
      return result ?? []
    },
    [serverId],
  )

  return {
    installed,
    installedLoading,
    installedError,
    refreshInstalled,
    setEnabled,
    uninstall,
    installLocal,
    changeVersion,
    updates,
    checkUpdates,
    searchResults,
    searchTotal,
    searchOffset,
    searchLoading,
    searchError,
    search,
    categories,
    selectedProject,
    projectLoading,
    selectProject,
    clearProject,
    versions,
    versionsLoading,
    getVersions,
    getAllVersions,
    resolveDeps,
    install,
    installLatest,
    installProgress,
    installing,
    installError,
    moreByAuthor,
  }
}
