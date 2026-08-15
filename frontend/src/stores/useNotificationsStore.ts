import { create } from 'zustand'

export type NotifKind = 'crash' | 'join' | 'info' | 'warn' | 'error'

export interface NotifItem {
  id: number
  timestamp: string
  kind: NotifKind
  text: string
}

let notifId = 0
const MAX_ITEMS = 200

interface NotificationsStore {
  items: NotifItem[]
  push: (kind: NotifKind, text: string) => void
  clear: () => void
}

export const useNotificationsStore = create<NotificationsStore>((set) => ({
  items: [],
  push: (kind, text) => {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    set((s) => ({
      items: [...s.items.slice(-(MAX_ITEMS - 1)), { id: ++notifId, timestamp, kind, text }],
    }))
  },
  clear: () => set({ items: [] }),
}))
