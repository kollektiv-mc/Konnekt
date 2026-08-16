import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { NotifKind } from '../stores/useNotificationsStore'

const TITLES: Record<NotifKind, string> = {
  crash: 'Server Crashed',
  join: 'Player Joined',
  info: 'Konnekt',
  warn: 'Konnekt',
  error: 'Konnekt',
}

export function emitNotification(kind: NotifKind, text: string): void {
  useNotificationsStore.getState().push(kind, text)

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
