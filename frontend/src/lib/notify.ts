import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { NotifKind } from '../stores/useNotificationsStore'

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

/** Logs to the Notifications tile and fires the desktop notification. */
export function emitNotification(kind: NotifKind, text: string): void {
  useNotificationsStore.getState().push(kind, text)
  emitDesktopNotification(kind, text)
}
