import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { ToastCategory, ToastInput } from '../stores/useNotificationsStore'
import { useSettingsStore } from '../stores/useSettingsStore'

/**
 * The categories in the order Settings lists them, with the words it uses.
 * `AppSettings.toastsOff` is keyed by `id`, and a key that is not there is on.
 */
export const TOAST_CATEGORIES: readonly {
  id: ToastCategory
  label: string
  description: string
}[] = [
  {
    id: 'warnings',
    label: 'Warnings and info',
    description: "The scheduler's graph advice, Notify block messages and low TPS.",
  },
  {
    id: 'errors',
    label: 'Errors',
    description: 'Failed scheduler runs, backups, restores, installs and loader updates.',
  },
  { id: 'crash', label: 'Server crash', description: 'A server stopping unexpectedly.' },
  { id: 'update', label: 'Update available', description: 'A newer Konnekt release.' },
]

export function toastsEnabled(category: ToastCategory): boolean {
  return !useSettingsStore.getState().settings.toastsOff[category]
}

/**
 * Raises an in-app bubble, unless its category is turned off in Settings.
 *
 * Separate from `emitNotification`, which writes the Notifications tile and the
 * desktop notification and is gated by its own toggles: a bubble is for text
 * that needs reading in full now, which not every notification is ("Server
 * started" would sit on screen until dismissed). `force` is for the user asking
 * to see one, from the indicator that stands in for it, and shows it whatever
 * the toggle or an earlier dismissal says.
 */
export function showToast(input: ToastInput, force = false): void {
  if (!force && !toastsEnabled(input.category)) return
  useNotificationsStore.getState().showToast(input, force)
}

/** Closes a bubble whose condition has cleared, so it does not outlive what it reported. */
export function withdrawToast(key: string): void {
  useNotificationsStore.getState().withdrawToast(key)
}
