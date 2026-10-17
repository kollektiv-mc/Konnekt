import { create } from 'zustand'
import { GetPhysicalMemoryMB } from '../../wailsjs/go/main/App'
import { readOr } from '../lib/ipc'

interface HostStore {
  /** The machine's installed RAM in MB; null until read, or when it cannot be. */
  physicalMemoryMB: number | null
  loadPhysicalMemory: () => Promise<void>
}

// One read per run: installed RAM does not change while the app is open. A
// failed read is not cached, so reopening the form tries again.
let inFlight: Promise<void> | null = null

/** Facts about the machine Konnekt runs on, as opposed to any one server. */
export const useHostStore = create<HostStore>((set, get) => ({
  physicalMemoryMB: null,

  loadPhysicalMemory: () => {
    if (get().physicalMemoryMB !== null) return Promise.resolve()
    inFlight ??= readOr(GetPhysicalMemoryMB, null)
      .then((mb) => {
        if (typeof mb === 'number' && mb > 0) set({ physicalMemoryMB: mb })
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  },
}))
