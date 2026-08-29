import { create } from 'zustand'
import { errMsg, hasWailsBridge } from '../lib/ipc'
import { GetLoaderStatus, ListLoaderVersions, UpdateLoader } from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'

export type LoaderStatus = models.LoaderStatus
export type LoaderVersion = models.LoaderVersion

/** Where the update has got to. `running` covers download plus install. */
export type UpdatePhase = 'idle' | 'running' | 'done' | 'failed'

interface LoaderStore {
  status: LoaderStatus | null
  versions: LoaderVersion[]
  loading: boolean
  /** A failed read: the panel shows this instead of a version list. */
  error: string | null

  phase: UpdatePhase
  /** The installer's output, plus Konnekt's own lines about the update. */
  log: string[]
  updateError: string | null
  /** Whether the failure put the previous launch files back. */
  rolledBack: boolean

  /** Whether the update dialog is on screen. Independent of `phase`. */
  dialogOpen: boolean
  /** What the dialog is about, kept here so it survives being closed. */
  target: LoaderVersion | null
  serverId: string
  serverName: string
  /** The build installed when the update was opened, for the "from" line. */
  from: string

  load: (serverId: string) => Promise<void>
  openUpdate: (server: { id: string; name: string }, from: string, target: LoaderVersion) => void
  hideDialog: () => void
  showDialog: () => void
  startUpdate: (serverId: string, version: string, fullBackup: boolean) => Promise<void>
  appendLog: (line: string) => void
  finishUpdate: () => void
  failUpdate: (message: string, rolledBack: boolean) => void
  reset: () => void
}

const MAX_LOG_LINES = 500

/**
 * Loader status, available builds, and the state of an in-flight update.
 *
 * The update's outcome does not come back from `UpdateLoader`: that call
 * returns once the work has been accepted, and the result arrives later as a
 * loader:update-* event. So `startUpdate` rejecting means the backend refused
 * to begin — the server is running, a build is already installed, an update is
 * in flight — and those are the messages worth putting in front of the user
 * immediately. Anything after that lands through `finishUpdate`/`failUpdate`.
 */
export const useLoaderStore = create<LoaderStore>((set) => ({
  status: null,
  versions: [],
  loading: false,
  error: null,
  phase: 'idle',
  log: [],
  updateError: null,
  rolledBack: false,
  dialogOpen: false,
  target: null,
  serverId: '',
  serverName: '',
  from: '',

  reset: () => set({ phase: 'idle', log: [], updateError: null, rolledBack: false }),

  // Opening the dialog for a build is where a run's bookkeeping is cleared —
  // not on close. Closing has to keep the log and the outcome, or reopening a
  // failure from its process row would show an empty dialog instead of the
  // error it exists to carry.
  openUpdate: (server, from, target) =>
    set({
      dialogOpen: true,
      serverId: server.id,
      serverName: server.name,
      from,
      target,
      phase: 'idle',
      log: [],
      updateError: null,
      rolledBack: false,
    }),

  hideDialog: () => set({ dialogOpen: false }),
  showDialog: () => set({ dialogOpen: true }),

  load: async (serverId: string) => {
    set({ loading: true, error: null })

    let status: LoaderStatus | null = null
    try {
      status = await GetLoaderStatus(serverId)
    } catch (e) {
      // A failed status read is not fatal on its own; the panel still has the
      // config's own values to fall back on.
      set({ error: errMsg(e) })
    }

    // Only managed loaders have a version list to fetch, and asking for one
    // otherwise produces an error the user can do nothing about.
    let versions: LoaderVersion[] = []
    if (status?.managed) {
      try {
        versions = await ListLoaderVersions(serverId)
      } catch (e) {
        set({ error: errMsg(e) })
      }
    }

    set({ status, versions, loading: false })
  },

  startUpdate: async (serverId: string, version: string, fullBackup: boolean) => {
    set({ phase: 'running', log: [], updateError: null, rolledBack: false })
    try {
      await UpdateLoader({ serverId, version, fullBackup })
    } catch (e) {
      if (hasWailsBridge()) {
        set({ phase: 'failed', updateError: errMsg(e) })
        throw e
      }
      // No bridge: the browser-only preview, where nothing was going to run.
      // Leave the dialog in its running state rather than inventing a failure.
    }
  },

  appendLog: (line: string) => set((s) => ({ log: [...s.log.slice(-(MAX_LOG_LINES - 1)), line] })),

  finishUpdate: () => set({ phase: 'done' }),

  failUpdate: (message: string, rolledBack: boolean) =>
    set({ phase: 'failed', updateError: message, rolledBack }),
}))
