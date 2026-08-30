import { models } from '../../../wailsjs/go/models'

/**
 * The command vocabulary the Commands tile is built from.
 *
 * Lifted out of QuickCommandsPanel so the compact grid and the maximized
 * library offer the same set from one definition rather than two that drift.
 *
 * Note there is a *third* copy of most of this in the scheduler's
 * `action.command` block (`backend/services/scheduler_blocks.go`), as the
 * `preset` select's options. Deliberately not unified here: that list crosses
 * the IPC boundary as part of a BlockDef and folding the two together is
 * #216's problem, not this one's.
 */

/** Mirrors models.CommandButton.Kind, which Go round-trips as a bare string. */
export type CmdKind = 'cmd' | 'lifecycle' | 'special'

/** A preset is a button without an identity yet. */
export type PresetTemplate = Pick<models.CommandButton, 'label' | 'value'> & { kind: CmdKind }

export const PRESETS: PresetTemplate[] = [
  { label: 'Start', kind: 'lifecycle', value: 'start' },
  { label: 'Stop', kind: 'lifecycle', value: 'stop' },
  { label: 'Restart', kind: 'lifecycle', value: 'restart' },
  { label: 'Force Stop', kind: 'lifecycle', value: 'force-stop' },
  { label: 'Save All', kind: 'cmd', value: 'save-all' },
  { label: 'List', kind: 'cmd', value: 'list' },
  { label: 'Set Day', kind: 'cmd', value: 'time set day' },
  { label: 'Set Night', kind: 'cmd', value: 'time set night' },
  { label: 'Clear Weather', kind: 'cmd', value: 'weather clear' },
  { label: 'Rain', kind: 'cmd', value: 'weather rain' },
  { label: 'Freeze Time', kind: 'cmd', value: 'gamerule doDaylightCycle false' },
  { label: 'Unfreeze Time', kind: 'cmd', value: 'gamerule doDaylightCycle true' },
  { label: 'Peaceful', kind: 'cmd', value: 'difficulty peaceful' },
  { label: 'Kick Player', kind: 'special', value: 'kick' },
  { label: 'Ban Player', kind: 'special', value: 'ban' },
]

/** The subset seeded on a first launch, by label. */
export const DEFAULT_LABELS = new Set([
  'Start',
  'Stop',
  'Restart',
  'Save All',
  'List',
  'Set Day',
  'Clear Weather',
  'Freeze Time',
  'Kick Player',
  'Ban Player',
])

/** Lifecycle actions that can put a confirmation in front of themselves. */
export type ConfirmableAction = 'stop' | 'restart' | 'force-stop'

export const CONFIRM_COPY: Record<
  ConfirmableAction,
  { title: string; body: string; button: string }
> = {
  stop: {
    title: 'Stop server?',
    body: 'This will stop the running server. Any unsaved progress may be lost.',
    button: 'Stop',
  },
  restart: {
    title: 'Restart server?',
    body: 'This will restart the running server. Players will be briefly disconnected.',
    button: 'Restart',
  },
  'force-stop': {
    title: 'Force stop server?',
    body: 'This kills the server process immediately. Progress since the last world save will be lost. Use this when a normal stop hangs.',
    button: 'Force stop',
  },
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `c${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Mint a button from a preset.
 *
 * The id matters beyond React keys: it is the anchor a CommandLink binds
 * against, and the one thing about a button that must survive every edit.
 */
export function makeItem(t: PresetTemplate): models.CommandButton {
  // createFrom rather than an object literal: Wails generates CommandButton as
  // a class (it has a nested CommandLink), so a bare literal is missing
  // convertValues and does not satisfy the type. Same pattern as
  // useSchedulerStore's graph updates.
  return models.CommandButton.createFrom({
    id: newId(),
    label: t.label,
    kind: t.kind,
    value: t.value,
  })
}

export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
