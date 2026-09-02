import { useState } from 'react'
import { CONFIRM_COPY, type ConfirmableAction } from './presets'

/**
 * The two modals the Commands tile puts in front of a destructive action.
 *
 * Shared between the compact grid and the maximized library so a kick issued
 * from either reads the same and sends the same string.
 *
 * Hover styling is Tailwind classes here rather than the imperative
 * `onMouseEnter` / `style.background` pairs this replaced. Those existed to get
 * past `eslint.config.js`'s ban on inline `style={{}}`, but the rule is about
 * static styling belonging in classes, and a hover colour is exactly that.
 */

interface ConfirmDialogProps {
  action: ConfirmableAction
  /** Disables the confirm button while a power action is already in flight. */
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function LifecycleConfirmDialog({ action, busy, onCancel, onConfirm }: ConfirmDialogProps) {
  const copy = CONFIRM_COPY[action]
  return (
    <div className="modal-overlay-in z-dialog fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="modal-panel-in border-border-subtle bg-canvas border-hairline flex w-80 flex-col gap-4 rounded-xl p-5">
        <div className="flex flex-col gap-1">
          <span className="text-text-primary text-sm font-semibold">{copy.title}</span>
          <span className="text-text-secondary text-xs">{copy.body}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-text-muted hover:text-text-primary px-3 py-1.5 text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            // Force stop is deliberately never blocked by `busy`: the state it
            // exists to escape is a graceful stop that is still in flight.
            disabled={action !== 'force-stop' && busy}
            className="border-hairline text-danger border-danger/30 bg-danger/15 hover:bg-danger/25 rounded px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
          >
            {copy.button}
          </button>
        </div>
      </div>
    </div>
  )
}

interface KickBanDialogProps {
  type: 'kick' | 'ban'
  onCancel: () => void
  /** Receives the assembled command, e.g. `kick Steve griefing`. */
  onSubmit: (command: string) => void
}

export function KickBanDialog({ type, onCancel, onSubmit }: KickBanDialogProps) {
  const [playerName, setPlayerName] = useState('')
  const [reason, setReason] = useState('')
  const submit = () => onSubmit(`${type} ${playerName}${reason ? ' ' + reason : ''}`)

  return (
    <div className="modal-overlay-in z-dialog fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="modal-panel-in border-border-subtle bg-canvas border-hairline flex w-80 flex-col gap-3 rounded-xl p-5">
        <h3 className="text-text-primary text-sm font-semibold capitalize">{type} Player</h3>
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Player name"
          autoFocus
          className="bg-hover border-border-subtle text-text-primary border-hairline rounded px-2 py-1.5 text-sm outline-none"
        />
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="bg-hover border-border-subtle text-text-primary border-hairline rounded px-2 py-1.5 text-sm outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-text-muted hover:text-text-primary px-3 py-1.5 text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="border-hairline text-danger border-danger/30 bg-danger/15 hover:bg-danger/25 rounded px-3 py-1.5 text-xs transition-colors"
          >
            {type === 'kick' ? 'Kick' : 'Ban'}
          </button>
        </div>
      </div>
    </div>
  )
}
