import { create } from 'zustand'

interface Process {
  id: string
  label: string
  filename?: string
  percent: number
  status: 'running' | 'done' | 'failed'
  /** Work that reports no percentage (e.g. the Forge/NeoForge installer, which
   *  emits log lines only). Shown as a pulse rather than a fabricated number. */
  indeterminate?: boolean
}

interface ProcessesStore {
  processes: Record<string, Process>
  start: (id: string, label: string, filename?: string, indeterminate?: boolean) => void
  updateProgress: (id: string, percent: number) => void
  finish: (id: string, status: 'done' | 'failed') => void
}

export const useProcessesStore = create<ProcessesStore>((set) => ({
  processes: {},
  start: (id, label, filename, indeterminate) =>
    set((s) => ({
      processes: {
        ...s.processes,
        [id]: { id, label, filename, percent: 0, status: 'running', indeterminate },
      },
    })),
  updateProgress: (id, percent) =>
    set((s) => {
      const p = s.processes[id]
      if (!p || p.status !== 'running') return s
      return { processes: { ...s.processes, [id]: { ...p, percent } } }
    }),
  finish: (id, status) => {
    set((s) => {
      const p = s.processes[id]
      if (!p) return s
      return { processes: { ...s.processes, [id]: { ...p, status, percent: 100 } } }
    })
    setTimeout(() => {
      set((s) => {
        const { [id]: _removed, ...rest } = s.processes
        return { processes: rest }
      })
    }, 3000)
  },
}))
