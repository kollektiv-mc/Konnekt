import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { NotifKind, ToastCategory } from '../stores/useNotificationsStore'

/** The bubble categories plus join/leave, which has no bubble. */
export type DesktopCategory = ToastCategory | 'join'

/**
 * The desktop categories in the order Settings lists them, with the label it
 * uses. `AppSettings.desktopOn` is keyed by `id`, and a key that is not there
 * is off.
 */
export const DESKTOP_CATEGORIES: readonly { id: DesktopCategory; label: string }[] = [
  { id: 'warnings', label: 'Warnings and info' },
  { id: 'errors', label: 'Errors' },
  { id: 'crash', label: 'Server crash' },
  { id: 'update', label: 'Update available' },
  { id: 'join', label: 'Player join/leave' },
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
