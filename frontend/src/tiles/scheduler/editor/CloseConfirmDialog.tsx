import { useEffect } from 'react'

interface Props {
  saving: boolean
  onCancel: () => void
  onDiscard: () => void
  onSaveAndClose: () => void
}

// Shown when closing the maximized scheduler (Escape / backdrop / restore
// button / navbar) while the graph has unsaved changes. z-dialog, inside the
// maximize overlay's own stacking context, so the value orders it against the
// editor, not against the app (lib/layers.ts).
export function CloseConfirmDialog({ saving, onCancel, onDiscard, onSaveAndClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onCancel])

  return (
    <div className="z-dialog fixed inset-0 flex items-center justify-center bg-black/65">
      <div className="bg-canvas border-border-subtle w-full max-w-md rounded-xl border p-5">
        <h2 className="text-text-primary mb-1 text-sm font-semibold">Unsaved changes</h2>
        <p className="text-text-muted mb-4 text-xs">
          This graph has unsaved changes, including node moves. Save before closing, or discard
          them?
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="bg-surface text-text-secondary rounded px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="rounded bg-transparent px-3 py-1.5 text-xs font-medium text-[#ef4444]"
          >
            Discard
          </button>
          <button
            onClick={onSaveAndClose}
            disabled={saving}
            className={`bg-accent text-canvas rounded px-3 py-1.5 text-xs font-medium ${saving ? 'opacity-50' : ''}`}
          >
            {saving ? 'Saving…' : 'Save & close'}
          </button>
        </div>
      </div>
    </div>
  )
}
