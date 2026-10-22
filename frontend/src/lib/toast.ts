import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { ToastCategory, ToastInput } from '../stores/useNotificationsStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { scheduleRunToastKey } from './constants'

/**
 * The categories in the order Settings lists them, with the label it uses.
 * `AppSettings.toastsOff` is keyed by `id`, and a key that is not there is on.
 */
export const TOAST_CATEGORIES: readonly {
  id: ToastCategory
  label: string
}[] = [
  { id: 'warnings', label: 'Warnings and info' },
  { id: 'errors', label: 'Errors' },
  { id: 'crash', label: 'Server crash' },
  { id: 'update', label: 'Update available' },
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

/** The fields of a schedule:run-finished payload a failed run's bubble reads. */
export interface RunFinished {
  graphId?: string
  graphName?: string
  status?: string
  error?: string
}

/**
 * The bubble for a scheduler run that failed, or null for one that did not.
 * Keyed by graph, so a graph that fails on every tick keeps one bubble and
 * counts the repeats, and the editor's toolbar can reopen it.
 */
export function failedRunToast(p: RunFinished | undefined): ToastInput | null {
  if (p?.status !== 'failed' || !p.graphId) return null
  return {
    key: scheduleRunToastKey(p.graphId),
    category: 'errors',
    tone: 'error',
    title: `Run failed: ${p.graphName || 'Untitled'}`,
    text: p.error || 'unknown error',
    resurface: true,
  }
}
