import { useInstallStore } from '../stores/useInstallStore'
import { useLoaderStore } from '../stores/useLoaderStore'
import { useProcessesStore } from '../stores/useProcessesStore'
import type { ProcessView } from '../stores/useProcessesStore'
import { useUiStore } from '../stores/useUiStore'
import { CircleCheck, CircleX, X } from '../lib/icons'
import { Icon } from './ui/Icon'

/**
 * Opens whatever a process's row points at.
 *
 * The dispatch lives here rather than in the process store so the store stays
 * inert data: this is the only place that needs to know a `loader` view means
 * `useLoaderStore`, and a `tile` view means the same fullscreen request the
 * tile crate makes.
 */
function openView(view: ProcessView) {
  switch (view.kind) {
    case 'loader':
      useLoaderStore.getState().showDialog()
      return
    case 'install':
      useInstallStore.getState().show()
      return
    case 'tile':
      // Backups and mod installs have no window of their own — their progress
      // is only ever shown inside their tile, so that is what opens. Works
      // whether or not the tile is currently on the canvas, the same way a
      // crate click does.
      useUiStore.getState().requestMaximize(view.tileId, null)
      return
  }
}

/**
 * The sidebar's live work.
 *
 * Rows stack because the backend genuinely runs this work concurrently: the
 * guards are per-service and nothing coordinates across them, so a backup, a
 * mod install and a loader update can all be in flight at once. There is no
 * queue to represent.
 */
export function ActiveProcesses() {
  const processes = useProcessesStore((s) => s.processes)
  const dismiss = useProcessesStore((s) => s.dismiss)
  const list = Object.values(processes)
  if (list.length === 0) return null

  return (
    <div className="border-border-subtle border-t-hairline flex shrink-0 flex-col gap-2 px-3 py-2">
      {list.map((p) => {
        const failed = p.status === 'failed'
        const clickable = p.view !== undefined
        return (
          <div key={p.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-1">
              {clickable ? (
                <button
                  onClick={() => openView(p.view!)}
                  title={failed ? 'Show what went wrong' : 'Show this job'}
                  className="text-text-muted hover:text-text-primary min-w-0 flex-1 truncate text-left font-mono text-xs transition-colors"
                >
                  {p.label}
                </button>
              ) : (
                <span className="text-text-muted min-w-0 flex-1 truncate font-mono text-xs">
                  {p.label}
                </span>
              )}
              {/* A percentage is text and an outcome is a glyph, so they are
                  two elements rather than one span switching between them.
                  The outcome carries the row's state on its own — nothing
                  beside it says "done" — so it is the one icon here that is
                  labelled rather than aria-hidden. */}
              {p.status === 'running' ? (
                <span className="text-text-faint shrink-0 font-mono text-xs">
                  {p.indeterminate ? '…' : `${p.percent}%`}
                </span>
              ) : (
                <Icon
                  icon={failed ? CircleX : CircleCheck}
                  size="sm"
                  className={failed ? 'text-danger' : 'text-text-faint'}
                  label={failed ? 'Failed' : 'Completed'}
                />
              )}
              {/* A success clears itself; a failure waits, so it needs a way
                  out that is not "wait three seconds and lose the error". */}
              {failed && (
                <button
                  onClick={() => dismiss(p.id)}
                  title="Dismiss"
                  aria-label="Dismiss"
                  className="text-text-faint hover:text-text-secondary shrink-0 px-0.5 transition-colors"
                >
                  <Icon icon={X} size="xs" />
                </button>
              )}
            </div>
            {/* An indeterminate process holds percent at 0 while it runs, so the bar
                reads empty until finish() sets it to 100 — never a full bar for work
                whose progress we cannot actually measure. */}
            <div className="bg-border-subtle h-0.5 w-full overflow-hidden rounded-full">
              <div
                className={`h-full transition-all duration-300 ${failed ? 'bg-danger' : 'bg-accent'}`}
                // eslint-disable-next-line no-restricted-syntax -- percent-width progress bar fill, genuinely dynamic per-process value
                style={{ width: `${p.percent}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
