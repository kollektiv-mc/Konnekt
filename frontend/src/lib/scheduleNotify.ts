import { useNotificationsStore } from '../stores/useNotificationsStore'
import { emitDesktopNotification } from './notify'
import { showToast } from './toast'

// Apart from notify.ts, which lazy chunks import too: taking toast.ts in there
// split the entry chunk in two and pushed it over its gzip budget.

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
    // bubble too: an error one counts as an error, the rest as a warning.
    showToast({
      category: kind === 'error' ? 'errors' : 'warnings',
      tone: kind,
      title: 'Scheduler',
      text: data.message,
    })
  }
  // The block's own choice, so no desktop toggle in Settings applies to it.
  if (toDesktop) emitDesktopNotification(kind, data.message)
}
