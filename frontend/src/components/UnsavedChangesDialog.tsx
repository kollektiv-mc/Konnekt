import { useEffect } from 'react'
import { usePresence } from '../hooks/usePresence'

interface Props {
  open: boolean
  saving: boolean
  onCancel: () => void
  /** Left out where throwing the changes away is not one of the choices (run). */
  onDiscard?: () => void
  onSaveAndContinue: () => void
  /** The line under the title: what holds the changes, or what the save is for. */
  body?: string
  confirmLabel?: string
}

const DEFAULT_BODY = 'You have unsaved changes. Save them first, or discard them?'

// Shown before anything replaces what an editor holds while it has unsaved
// changes. The scheduler editor (#124) and the config editor ask through it.
// What happens after the choice is the caller's, carried by
// hooks/useDirtyGuard.ts, so the wording stays neutral about which action
// asked. A caller whose save is the only way on (the scheduler's run) leaves
// out `onDiscard` and passes its own wording. z-dialog, inside the maximize
// overlay's own stacking context, so the value orders it against the editor,
// not against the app (lib/layers.ts).
// Stays mounted through its exit animation (usePresence), so the caller passes
// `open` rather than mounting it conditionally.
export function UnsavedChangesDialog({
  open,
  saving,
  onCancel,
  onDiscard,
  onSaveAndContinue,
  body = DEFAULT_BODY,
  confirmLabel = 'Save & continue',
}: Props) {
  const presence = usePresence(open)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, onCancel])

  if (!presence.mounted) return null
  return (
    <div
      inert={presence.inert}
      className={`${presence.overlayClass} z-dialog fixed inset-0 flex items-center justify-center bg-black/65`}
    >
      <div
        onAnimationEnd={presence.onAnimationEnd}
        className={`${presence.panelClass} bg-canvas border-border-subtle w-full max-w-md rounded-xl border p-5`}
      >
        <h2 className="text-text-primary mb-1 text-sm font-semibold">Unsaved changes</h2>
        <p className="text-text-muted mb-4 text-xs">{body}</p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="bg-surface text-text-secondary rounded px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          {onDiscard && (
            <button
              onClick={onDiscard}
              className="text-danger rounded bg-transparent px-3 py-1.5 text-xs font-medium"
            >
              Discard
            </button>
          )}
          <button
            onClick={onSaveAndContinue}
            disabled={saving}
            className={`bg-accent text-canvas rounded px-3 py-1.5 text-xs font-medium ${saving ? 'opacity-50' : ''}`}
          >
            {saving ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
