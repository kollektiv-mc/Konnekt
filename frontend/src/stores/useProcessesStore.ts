import { create } from 'zustand'

/**
 * What clicking a process's row should open.
 *
 * Held as plain data rather than a callback so the store stays inert: the
 * dispatch lives in `ActiveProcesses`, which is the only thing that needs to
 * know which store or which tile each kind maps to.
 *
 * `tile` is for work with no window of its own — a backup and a mod install
 * report only into their tile — and opens that tile fullscreen.
 */
export type ProcessView =
  { kind: 'loader'; serverId: string } | { kind: 'install' } | { kind: 'tile'; tileId: string }

interface Process {
  id: string
  label: string
  filename?: string
  percent: number
  status: 'running' | 'done' | 'failed'
  /** Work that reports no percentage (e.g. the Forge/NeoForge installer, which
   *  emits log lines only). Shown as a pulse rather than a fabricated number. */
  indeterminate?: boolean
  view?: ProcessView
}

/**
 * Everything about a process beyond its id and label. An options object rather
 * than more positional parameters: `start(id, label, filename, indeterminate,
 * view)` is unreadable at the call site, and every caller sets a different
 * subset.
 */
export interface StartOptions {
  filename?: string
  indeterminate?: boolean
  view?: ProcessView
}

interface ProcessesStore {
  processes: Record<string, Process>
  start: (id: string, label: string, opts?: StartOptions) => void
  updateProgress: (id: string, percent: number) => void
  finish: (id: string, status: 'done' | 'failed') => void
  dismiss: (id: string) => void
}

/** How long a successful process stays on screen before clearing itself. */
const DONE_LINGER_MS = 3000

export const useProcessesStore = create<ProcessesStore>((set) => ({
  processes: {},

  start: (id, label, opts = {}) =>
    set((s) => ({
      processes: {
        ...s.processes,
        [id]: {
          id,
          label,
          filename: opts.filename,
          percent: 0,
          status: 'running',
          indeterminate: opts.indeterminate,
          view: opts.view,
        },
      },
    })),

  updateProgress: (id, percent) =>
    set((s) => {
      const p = s.processes[id]
      if (!p || p.status !== 'running') return s
      return { processes: { ...s.processes, [id]: { ...p, percent } } }
    }),

  /**
   * A success clears itself; a failure waits to be dismissed.
   *
   * The asymmetry is the point. The row is the way back to a job's window, so a
   * failure that cleared itself after three seconds would take the only route
   * to its own error message with it — and the user is by definition not
   * watching, or they would have had the window open.
   */
  finish: (id, status) => {
    set((s) => {
      const p = s.processes[id]
      if (!p) return s
      return { processes: { ...s.processes, [id]: { ...p, status, percent: 100 } } }
    })
    if (status !== 'done') return
    setTimeout(() => {
      set((s) => {
        // Re-check the status: a new run can have claimed this id in the
        // meantime, and clearing it would take the live process with it.
        if (s.processes[id]?.status !== 'done') return s
        const { [id]: _removed, ...rest } = s.processes
        return { processes: rest }
      })
    }, DONE_LINGER_MS)
  },

  dismiss: (id) =>
    set((s) => {
      if (!s.processes[id]) return s
      const { [id]: _removed, ...rest } = s.processes
      return { processes: rest }
    }),
}))
