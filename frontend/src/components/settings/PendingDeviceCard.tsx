import { useState } from 'react'
import type { RemotePendingDevice } from '../../stores/useRemoteStore'
import { ACCENT_BUTTON, DANGER_BUTTON, TEXT_INPUT } from './controls'

interface Props {
  request: RemotePendingDevice
  onApprove: (name: string) => Promise<void>
  onDeny: () => Promise<void>
}

/**
 * One browser waiting to be approved: the code it is showing, what it says it
 * is, and a name to give it. Shared by the Settings pane and the always-on-top
 * prompt, so the two cannot drift apart on what approving asks for.
 *
 * A refusal keeps the name typed. The store holds the message and the pane
 * shows it, so the catches here only stop a fire-and-forget click raising an
 * unhandled rejection.
 */
export function PendingDeviceCard({ request, onApprove, onDeny }: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()

  const run = async (call: () => Promise<void>) => {
    setBusy(true)
    try {
      await call()
    } catch {
      // The store recorded the refusal in its `error`; the form stays as it was.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-border-subtle border-hairline my-3 flex flex-col gap-2 rounded p-3">
      <span className="text-text-primary text-sm">A browser is waiting to be approved</span>
      <span className="text-accent font-mono text-lg tracking-widest">{request.code}</span>
      {request.userAgent && (
        <span className="text-text-muted truncate text-xs" title={request.userAgent}>
          {request.userAgent}
        </span>
      )}
      <div className="flex items-center gap-2">
        <input
          aria-label="Device name"
          placeholder="Name this device"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${TEXT_INPUT} flex-1`}
        />
        <button
          disabled={trimmed === '' || busy}
          onClick={() => void run(() => onApprove(trimmed))}
          className={ACCENT_BUTTON}
        >
          Approve
        </button>
        <button disabled={busy} onClick={() => void run(onDeny)} className={DANGER_BUTTON}>
          Deny
        </button>
      </div>
    </div>
  )
}
