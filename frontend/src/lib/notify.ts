import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { NotifKind, ToastCategory } from '../stores/useNotificationsStore'

/** The bubble categories plus join/leave, which has no bubble. */
export type DesktopCategory = ToastCategory | 'join'

/**
 * The desktop categories in the order Settings lists them, with the words it
 * uses. `AppSettings.desktopOn` is keyed by `id`, and a key that is not there
 * is off.
 */
export const DESKTOP_CATEGORIES: readonly {
  id: DesktopCategory
  label: string
  description: string
}[] = [
  {
    id: 'warnings',
    label: 'Warnings and info',
    description: 'Low TPS, a server starting, and finished backups, restores and installs.',
  },
  {
    id: 'errors',
    label: 'Errors',
    description: 'Failed scheduler runs, backups, restores, installs and loader updates.',
  },
  { id: 'crash', label: 'Server crash', description: 'A server stopping unexpectedly.' },
  { id: 'update', label: 'Update available', description: 'A newer Konnekt release.' },
  { id: 'join', label: 'Player join/leave', description: 'A player joining or leaving a server.' },
]

const TITLES: Record<NotifKind, string> = {
  crash: 'Server Crashed',
  join: 'Player Joined',
  info: 'Konnekt',
  warn: 'Konnekt',
  error: 'Konnekt',
}

/** Fires the operating system's notification only, asking for permission once if needed. */
export function emitDesktopNotification(kind: NotifKind, text: string): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    try {
      new Notification(TITLES[kind], { body: text, silent: false })
    } catch {
      /* webview may block */
    }
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        try {
          new Notification(TITLES[kind], { body: text, silent: false })
        } catch {
          /* blocked */
        }
      }
    })
  }
}

/**
 * Logs to the Notifications tile and always fires the desktop notification:
 * for a request the user has to answer, which no toggle may silence. Every
 * other event goes through `emitNotification` in ./appNotify, which asks
 * Settings first.
 */
export function emitRequestNotification(kind: NotifKind, text: string): void {
  useNotificationsStore.getState().push(kind, text)
  emitDesktopNotification(kind, text)
}
