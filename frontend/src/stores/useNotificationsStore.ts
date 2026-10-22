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
  /** See `ToastInput.standing`. */
  standing?: boolean
}

export interface ToastInput {
  key?: string
  category: ToastCategory
  tone: ToastTone
  title: string
  text: string
  /**
   * A condition that holds until something changes (a graph's warnings, a
   * scheduler error) rather than something that happened. It updates in place
   * as its text changes, and once dismissed it stays dismissed for the session
   * whatever its text becomes: the indicator that stands in for it brings it
   * back with `force`. Every other bubble is news each time it arrives (a
   * failed run, a crash), so a dismissal only closes it.
   */
  standing?: boolean
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

/** Adds the standing ones among `toasts` to the dismissed keys; news is not remembered. */
function remember(dismissed: Record<string, true>, toasts: readonly Toast[]): Record<string, true> {
  const standing = toasts.filter((t) => t.standing)
  if (standing.length === 0) return dismissed
  return { ...dismissed, ...Object.fromEntries(standing.map((t) => [t.key, true as const])) }
}

interface NotificationsStore {
  items: NotifItem[]
  push: (kind: NotifKind, text: string) => void
  clear: () => void

  /** Oldest first; the layer draws the newest at the bottom, nearest the corner. */
  toasts: Toast[]
  /** The keys of the standing bubbles dismissed this session. */
  dismissedToasts: Record<string, true>
  /**
   * Opens a bubble, or updates the open one with the same key. News moves it
   * to the bottom, where the newest sits. `force` is for the user asking to see
   * it again, and overrides an earlier dismissal.
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
        if (!force) return s
        dismissedToasts = { ...dismissedToasts }
        delete dismissedToasts[key]
      }
      const timestamp = clock()
      const open = s.toasts.find((t) => t.key === key)
      if (open) {
        // A standing condition raised again as it was (an editor reopening on
        // the same graph) is not news, and neither is the user looking for a
        // bubble that is already up: neither counts as a repeat.
        const same = open.text === input.text
        if (same && input.standing && !force) return s
        const count = force ? open.count : same ? open.count + 1 : 1
        const next = { ...open, ...input, key, timestamp, count }
        // News moves down to the newest place, keeping its id so the card
        // glides there rather than leaving and arriving again. A standing
        // condition updates where it is, so a graph's warnings changing as it
        // is edited do not reshuffle the stack.
        const moves = force || !input.standing
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
        dismissedToasts: remember(s.dismissedToasts, [toast]),
      }
    }),
  dismissAllToasts: () =>
    set((s) => ({ toasts: [], dismissedToasts: remember(s.dismissedToasts, s.toasts) })),
  withdrawToast: (key) =>
    set((s) =>
      s.toasts.some((t) => t.key === key) ? { toasts: s.toasts.filter((t) => t.key !== key) } : s,
    ),
}))
