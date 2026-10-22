import { create } from 'zustand'

export type NotifKind = 'crash' | 'join' | 'info' | 'warn' | 'error'

export interface NotifItem {
  id: number
  timestamp: string
  kind: NotifKind
  text: string
}

/**
 * The in-app bubble categories, each with its own toggle in Settings
 * (`AppSettings.toastsOff`). lib/toast.ts is what checks the toggle; the store
 * holds whatever it is given.
 */
export type ToastCategory = 'warnings' | 'errors' | 'crash' | 'update'

export type ToastTone = 'info' | 'warn' | 'error'

/**
 * A bubble: the full text of a message that has no room where it was raised,
 * kept on screen until the user dismisses it.
 */
export interface Toast {
  id: number
  /**
   * What the bubble is about. A second bubble with the same key replaces the
   * first rather than stacking under it, so a graph's warning that changes as
   * it is edited stays one bubble, and a dismissal is remembered against it.
   */
  key: string
  category: ToastCategory
  tone: ToastTone
  title: string
  text: string
  timestamp: string
  /** How many times this exact text arrived while the bubble was open. */
  count: number
}

export interface ToastInput {
  key?: string
  category: ToastCategory
  tone: ToastTone
  title: string
  text: string
  /**
   * Each arrival is news, so it shows even when a bubble with the same key and
   * text was dismissed: a failed run, which a re-run can fail with the same
   * reason. Without it a dismissal holds until the text changes, which suits a
   * condition that is still standing, like a graph's warnings.
   */
  resurface?: boolean
}

let notifId = 0
const MAX_ITEMS = 200
let toastId = 0
// A short stack in the corner rather than a wall of cards: a new bubble past
// the third takes the place of the oldest, which leaves from the top.
export const MAX_TOASTS = 3

function clock(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

interface NotificationsStore {
  items: NotifItem[]
  push: (kind: NotifKind, text: string) => void
  clear: () => void

  /** Oldest first; the layer draws the newest at the bottom, nearest the corner. */
  toasts: Toast[]
  /**
   * The text each key was dismissed with, for the session. The same text under
   * the same key stays dismissed; a different one is news and shows again.
   */
  dismissedToasts: Record<string, string>
  /**
   * Opens a bubble, or updates the open one with the same key; one that
   * resurfaces moves to the bottom, where the newest sits. `force` is for the user asking to
   * see it again, and overrides an earlier dismissal.
   */
  showToast: (input: ToastInput, force?: boolean) => void
  dismissToast: (id: number) => void
  dismissAllToasts: () => void
  /** Closes the bubble for a condition that has gone away, without remembering a dismissal. */
  withdrawToast: (key: string) => void
}

export const useNotificationsStore = create<NotificationsStore>((set) => ({
  items: [],
  push: (kind, text) => {
    const timestamp = clock()
    set((s) => ({
      items: [...s.items.slice(-(MAX_ITEMS - 1)), { id: ++notifId, timestamp, kind, text }],
    }))
  },
  clear: () => set({ items: [] }),

  toasts: [],
  dismissedToasts: {},
  showToast: (input, force = false) => {
    const key = input.key ?? `${input.category}:${input.text}`
    set((s) => {
      let dismissedToasts = s.dismissedToasts
      if (key in dismissedToasts) {
        if (!force && !input.resurface && dismissedToasts[key] === input.text) return s
        dismissedToasts = { ...dismissedToasts }
        delete dismissedToasts[key]
      }
      const timestamp = clock()
      const open = s.toasts.find((t) => t.key === key)
      if (open) {
        const count = open.text === input.text ? open.count + 1 : 1
        // A forced reopen of a bubble that is already up is the user looking
        // for it, not a repeat, so it does not bump the count.
        const next = { ...open, ...input, key, timestamp, count: force ? open.count : count }
        // News moves down to the newest place: an arrival that resurfaces (a
        // failed run) or the user asking for the bubble. It keeps its id, so
        // the card glides there rather than leaving and arriving again. A
        // standing condition (a TPS reading, a graph's warnings as it is
        // edited) updates where it is, so a reading every few seconds does
        // not reshuffle the stack.
        const moves = force || input.resurface === true
        const toasts = moves
          ? [...s.toasts.filter((t) => t.id !== open.id), next]
          : s.toasts.map((t) => (t.id === open.id ? next : t))
        return { dismissedToasts, toasts }
      }
      const toast: Toast = { ...input, key, id: ++toastId, timestamp, count: 1 }
      return { dismissedToasts, toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), toast] }
    })
  },
  dismissToast: (id) =>
    set((s) => {
      const toast = s.toasts.find((t) => t.id === id)
      if (!toast) return s
      return {
        toasts: s.toasts.filter((t) => t.id !== id),
        dismissedToasts: { ...s.dismissedToasts, [toast.key]: toast.text },
      }
    }),
  dismissAllToasts: () =>
    set((s) => ({
      toasts: [],
      dismissedToasts: {
        ...s.dismissedToasts,
        ...Object.fromEntries(s.toasts.map((t) => [t.key, t.text])),
      },
    })),
  withdrawToast: (key) =>
    set((s) =>
      s.toasts.some((t) => t.key === key) ? { toasts: s.toasts.filter((t) => t.key !== key) } : s,
    ),
}))
