import { create } from 'zustand'
import type { InstallerDetails, InstallResult } from '../components/ServerInstallModal'

/** Where the install has got to. Mirrors the loader update's phases. */
export type InstallPhase = 'idle' | 'running' | 'done' | 'failed'

const MAX_LOG_LINES = 500

interface InstallStore {
  /** Whether the modal is on screen. Independent of whether work is running. */
  open: boolean
  installer: InstallerDetails | null
  targetDir: string
  phase: InstallPhase
  log: string[]
  error: string | null
  /**
   * What the finished install laid down, for the add-server form to record.
   * Outlives `open`: the form needs it after the modal has been dismissed.
   */
  result: InstallResult | null

  openFor: (installer: InstallerDetails, suggestedDir: string) => void
  hide: () => void
  show: () => void
  setTargetDir: (dir: string) => void
  begin: () => void
  appendLog: (line: string) => void
  finish: (result: InstallResult) => void
  fail: (message: string) => void
  clearResult: () => void
}

/**
 * The Forge/NeoForge server installer's state.
 *
 * It lives here rather than in `ServerInstallModal` because the modal's own
 * docstring promises that closing never blocks, and that was only true of the
 * backend: closing used to destroy the log and the outcome with no way back.
 * With the state here the modal is a view, the sidebar's process row can
 * reopen it, and nothing is lost by dismissing it.
 *
 * Its own domain rather than a corner of another store: this is the installer,
 * `useLoaderStore` is the loader, and they happen to share a log channel and
 * nothing else.
 */
export const useInstallStore = create<InstallStore>((set) => ({
  open: false,
  installer: null,
  targetDir: '',
  phase: 'idle',
  log: [],
  error: null,
  result: null,

  // A fresh installer selection starts a fresh run: an earlier log or error
  // belongs to a different jar.
  openFor: (installer, suggestedDir) =>
    set({
      open: true,
      installer,
      targetDir: suggestedDir,
      phase: 'idle',
      log: [],
      error: null,
      result: null,
    }),

  hide: () => set({ open: false }),
  show: () => set({ open: true }),
  setTargetDir: (dir) => set({ targetDir: dir }),

  begin: () => set({ phase: 'running', log: [], error: null, result: null }),

  appendLog: (line) => set((s) => ({ log: [...s.log.slice(-(MAX_LOG_LINES - 1)), line] })),

  finish: (result) => set({ phase: 'done', result }),

  fail: (message) => set({ phase: 'failed', error: message }),

  clearResult: () => set({ result: null }),
}))
