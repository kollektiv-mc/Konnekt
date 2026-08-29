import { create } from 'zustand'
import { errMsg, hasWailsBridge } from '../lib/ipc'
import { GetLoaderStatus, ListLoaderVersions, UpdateLoader } from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'

export type LoaderStatus = models.LoaderStatus
export type LoaderVersion = models.LoaderVersion

/** Where the running update has got to. `running` covers download plus install. */
export type UpdatePhase = 'idle' | 'running' | 'done' | 'failed'

/** A version the user has picked but not yet started. */
export interface PendingUpdate {
  serverId: string
  from: string
  target: LoaderVersion
  /** True between clicking the confirm and the backend accepting. */
  starting: boolean
}

interface LoaderStore {
  status: LoaderStatus | null
  versions: LoaderVersion[]
  loading: boolean
  /** A failed read: the panel shows this instead of a version list. */
  error: string | null

  // --- The job ---
  //
  // Written only by jobStarted and the two outcome actions, all three driven by
  // backend events. Its identity comes from loader:update-started rather than
  // from whatever the dialog last touched, which is what keeps a finished
  // update from reporting a version nobody installed.
  phase: UpdatePhase
  /** The installer's output, plus Konnekt's own lines about the update. */
  log: string[]
  updateError: string | null
  /** Whether the failure put the previous launch files back. */
  rolledBack: boolean
  jobServerId: string
  jobFrom: string
  jobTarget: string

  // --- The dialog ---
  dialogOpen: boolean
  /** What the confirm is about. Null once it has become a job, or been closed. */
  pending: PendingUpdate | null
  /** A start the backend refused. An attempt that never became a job. */
  startError: string | null

  load: (serverId: string) => Promise<void>
  openUpdate: (server: { id: string; name: string }, from: string, target: LoaderVersion) => void
  hideDialog: () => void
  showDialog: () => void
  startUpdate: (serverId: string, version: string, fullBackup: boolean) => Promise<void>
  jobStarted: (job: { serverId: string; from: string; to: string }) => void
  appendLog: (line: string) => void
  finishUpdate: () => void
  failUpdate: (message: string, rolledBack: boolean) => void
  reset: () => void
}

const MAX_LOG_LINES = 500

/**
 * Loader status, available builds, and the state of an in-flight update.
 *
 * The job and the dialog's subject are deliberately separate fields. They used
 * to share one slot, and picking a second version while an update ran wrote
 * over the running job four ways at once: it wiped the log, it broke the
 * install:log route (which gates on `phase === 'running'`), it made the
 * sidebar's row open the refusal instead of the job, and it made the finished
 * update report whichever version the dialog had last been pointed at. Only the
 * backend can say what job exists, so only the backend's events write the job.
 *
 * The update's outcome does not come back from `UpdateLoader`: that call
 * returns once the work has been accepted, and the result arrives later as a
 * loader:update-* event. So `startUpdate` rejecting means the backend refused
 * to begin — the server is running, a build is already installed, an update is
 * in flight — which is `startError`, not a job that failed.
 */
export const useLoaderStore = create<LoaderStore>((set, get) => ({
  status: null,
  versions: [],
  loading: false,
  error: null,

  phase: 'idle',
  log: [],
  updateError: null,
  rolledBack: false,
  jobServerId: '',
  jobFrom: '',
  jobTarget: '',

  dialogOpen: false,
  pending: null,
  startError: null,

  reset: () =>
    set({
      phase: 'idle',
      log: [],
      updateError: null,
      rolledBack: false,
      jobServerId: '',
      jobFrom: '',
      jobTarget: '',
      pending: null,
      startError: null,
    }),

  /**
   * Point the dialog at a version to confirm.
   *
   * Refuses while a job is running and shows that job instead. The panel
   * already disables its Update buttons then, so this is the backstop for the
   * routes the panel cannot see: a stale render, a double click, or Konnekt
   * restarted while an update was in flight.
   */
  openUpdate: (server, from, target) => {
    if (get().phase === 'running') {
      set({ dialogOpen: true })
      return
    }
    set({
      dialogOpen: true,
      pending: { serverId: server.id, from, target, starting: false },
      startError: null,
      // A settled job is history once a new version is being confirmed.
      phase: 'idle',
      log: [],
      updateError: null,
      rolledBack: false,
      jobServerId: '',
      jobFrom: '',
      jobTarget: '',
    })
  },

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
    set((s) => ({
      startError: null,
      pending: s.pending ? { ...s.pending, starting: true } : s.pending,
    }))
    try {
      await UpdateLoader({ serverId, version, fullBackup })
      // Phase is not set here. loader:update-started is what says a job exists,
      // and it carries the identity this store needs.
    } catch (e) {
      if (hasWailsBridge()) {
        set((s) => ({
          startError: errMsg(e),
          pending: s.pending ? { ...s.pending, starting: false } : s.pending,
        }))
        throw e
      }
      // No bridge: the browser-only preview, where nothing was going to run.
    }
  },

  /**
   * A job exists. Its identity is the event's, not the dialog's.
   *
   * Clearing `pending` here is what hands the dialog over to the job: from this
   * point the row, the dialog and the outcome all describe the same update.
   */
  jobStarted: ({ serverId, from, to }) =>
    set({
      phase: 'running',
      log: [],
      updateError: null,
      rolledBack: false,
      jobServerId: serverId,
      jobFrom: from,
      jobTarget: to,
      pending: null,
      startError: null,
    }),

  appendLog: (line: string) => set((s) => ({ log: [...s.log.slice(-(MAX_LOG_LINES - 1)), line] })),

  finishUpdate: () => set({ phase: 'done' }),

  failUpdate: (message: string, rolledBack: boolean) =>
    set({ phase: 'failed', updateError: message, rolledBack }),
}))
