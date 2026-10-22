import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { NotifKind } from '../stores/useNotificationsStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { emitDesktopNotification } from './notify'
import type { DesktopCategory } from './notify'

// Apart from notify.ts, which lazy chunks import too: taking the settings store
// in there split the entry chunk and pushed it over its gzip budget, as
// toast.ts did before (scheduleNotify.ts).

/** The category an event of this kind files under when its caller names none. */
const KIND_CATEGORY: Record<NotifKind, DesktopCategory> = {
  crash: 'crash',
  join: 'join',
  error: 'errors',
  warn: 'warnings',
  info: 'warnings',
}

export function desktopEnabled(category: DesktopCategory): boolean {
  return Boolean(useSettingsStore.getState().settings.desktopOn[category])
}

/**
 * Logs to the Notifications tile, and fires the desktop notification when its
 * category is on in Settings. `desktop` names the category where the kind
 * alone would file it wrongly: a failed backup is logged as a crash for its
 * icon, and is an error.
 */
export function emitNotification(
  kind: NotifKind,
  text: string,
  desktop: DesktopCategory = KIND_CATEGORY[kind],
): void {
  useNotificationsStore.getState().push(kind, text)
  if (desktopEnabled(desktop)) emitDesktopNotification(kind, text)
}
