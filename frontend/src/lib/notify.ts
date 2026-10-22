import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { NotifKind } from '../stores/useNotificationsStore'
import { showToast } from './toast'

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

/** The `schedule:notify` payload. `deliver` is absent on an event from before the field existed. */
export interface ScheduleNotify {
  kind: string
  message: string
  deliver?: string
}

/**
 * Routes a Notify block's message by its `deliver` choice. "inApp" is the bubble
 * plus the Notifications tile entry, "desktop" is the operating system's
 * notification alone, and anything else, including no value, is both, which is
 * what every Notify block did before it had the choice.
 */
export function deliverScheduleNotify(data: ScheduleNotify): void {
  const kind = (['info', 'warn', 'error'].includes(data.kind) ? data.kind : 'info') as
    'info' | 'warn' | 'error'
  const toApp = data.deliver !== 'desktop'
  const toDesktop = data.deliver !== 'inApp'
  if (toApp) {
    useNotificationsStore.getState().push(kind, data.message)
    // A Notify block is a message the user wrote to be read, so it gets a
    // bubble too: an error one counts as an error, the rest as advice.
    showToast({
      category: kind === 'error' ? 'errors' : 'warnings',
      tone: kind,
      title: 'Scheduler',
      text: data.message,
    })
  }
  if (toDesktop) emitDesktopNotification(kind, data.message)
}
