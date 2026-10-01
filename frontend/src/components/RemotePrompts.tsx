import { useEffect, useRef, useState } from 'react'
import { useRemoteStore } from '../stores/useRemoteStore'
import type { RemoteApproval, RemotePendingDevice } from '../stores/useRemoteStore'
import { emitNotification } from '../lib/notify'
import { PendingDeviceCard } from './settings/PendingDeviceCard'

type Waiting =
  | { kind: 'approval'; id: string; at: number; approval: RemoteApproval }
  | { kind: 'device'; id: string; at: number; request: RemotePendingDevice }

/** Everything waiting on the desktop, approvals first, each group oldest first. */
function waitingItems(
  approvals: RemoteApproval[] | null | undefined,
  pending: RemotePendingDevice[] | null | undefined,
): Waiting[] {
  const a: Waiting[] = (approvals ?? []).map((approval) => ({
    kind: 'approval',
    id: approval.id,
    at: approval.requestedAt,
    approval,
  }))
  const d: Waiting[] = (pending ?? []).map((request) => ({
    kind: 'device',
    id: request.id,
    at: request.requestedAt,
    request,
  }))
  const byAge = (x: Waiting, y: Waiting) => x.at - y.at
  return [...a.sort(byAge), ...d.sort(byAge)]
}

/** One argument as the call sent it, indented when it is JSON and verbatim when it is not. */
function pretty(arg: string): string {
  try {
    return JSON.stringify(JSON.parse(arg), null, 2)
  } catch {
    return arg
  }
}

/**
 * The prompts Remote Access raises on the desktop: a browser that gave the
 * right password and waits to be named, and an approved device asking for an
 * admin-tier call. Both need an answer whether or not Settings is open, so this
 * is mounted once in App and reads the store `useRemoteSync` keeps fresh.
 *
 * One dialog at a time, the oldest waiting item, approvals first. It is a
 * dialog (z-dialog) because it is raised by an event rather than a click and
 * has to beat an open modal, as EulaModal does (lib/layers.ts). Unlike every
 * other dialog a backdrop click or Escape does not close it: an unanswered
 * security prompt must not vanish by accident. A device request expires by
 * itself after five minutes and an approval is refused after one, so leaving
 * one alone is safe and is also an answer.
 *
 * The arguments of an approval are shown here and nowhere else: not logged,
 * and not in the notification that tells the person to look.
 */
export function RemotePrompts() {
  const approvals = useRemoteStore((s) => s.access.approvals)
  const pending = useRemoteStore((s) => s.access.pendingDevices)
  const items = waitingItems(approvals, pending)
  const current = items[0]

  // Ids already announced, so a refresh that re-sends the same item does not
  // notify twice. The text names no argument and no code: a notification outlives
  // the dialog and is readable on a locked screen.
  const announced = useRef(new Set<string>())
  useEffect(() => {
    for (const item of waitingItems(approvals, pending)) {
      if (announced.current.has(item.id)) continue
      announced.current.add(item.id)
      emitNotification(
        'warn',
        item.kind === 'device'
          ? 'A device is waiting to be approved for remote access'
          : `${item.approval.device} is asking to make a change through remote access`,
      )
    }
  }, [approvals, pending])

  if (!current) return null

  return (
    <div className="z-dialog fixed inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.6)]">
      {current.kind === 'approval' ? (
        <ApprovalPrompt key={current.id} approval={current.approval} total={items.length} />
      ) : (
        <DevicePrompt key={current.id} request={current.request} total={items.length} />
      )}
    </div>
  )
}

const CARD =
  'bg-canvas border-border-subtle border-hairline flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-xl p-5'

function Count({ total }: { total: number }) {
  if (total <= 1) return null
  return <span className="text-text-faint text-2xs">1 of {total} waiting</span>
}

function DevicePrompt({ request, total }: { request: RemotePendingDevice; total: number }) {
  const approveDevice = useRemoteStore((s) => s.approveDevice)
  const denyDevice = useRemoteStore((s) => s.denyDevice)
  const card = useRef<HTMLDivElement>(null)

  // The name field, so the person can type straight away. Keyed on the request:
  // a second device replaces this one in place and the focus follows it.
  useEffect(() => {
    card.current?.querySelector('input')?.focus()
  }, [request.id])

  return (
    <div
      ref={card}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="remote-prompt-title"
      className={CARD}
    >
      <div className="flex flex-col gap-1">
        <Count total={total} />
        <span id="remote-prompt-title" className="text-text-primary text-sm font-medium">
          A new device wants to connect
        </span>
        <span className="text-text-muted text-xs">
          Approve it only if this code is on your own screen.
        </span>
      </div>
      <PendingDeviceCard
        request={request}
        onApprove={(name) => approveDevice(request.id, name)}
        onDeny={() => denyDevice(request.id)}
      />
    </div>
  )
}

function ApprovalPrompt({ approval, total }: { approval: RemoteApproval; total: number }) {
  const answerApproval = useRemoteStore((s) => s.answerApproval)
  const error = useRemoteStore((s) => s.error)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const deny = useRef<HTMLButtonElement>(null)

  // A clock, not data: it only re-renders the countdown. The backend refuses the
  // call itself at expiresAt; this just says how long is left.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Deny, the safe default: an Enter or a space pressed by accident refuses.
  useEffect(() => {
    deny.current?.focus()
  }, [approval.id])

  const secondsLeft = Math.max(0, Math.ceil((approval.expiresAt - now) / 1000))

  const answer = async (allow: boolean) => {
    setBusy(true)
    try {
      await answerApproval(approval.id, allow)
    } catch {
      // The store has recorded the refusal in `error`, which renders under the
      // buttons, and the call is still waiting, so the prompt stays up.
      setBusy(false)
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="remote-prompt-title"
      className={CARD}
    >
      <div className="flex flex-col gap-1">
        <Count total={total} />
        <span id="remote-prompt-title" className="text-text-primary text-sm font-medium">
          {approval.device} wants to make a change
        </span>
        <span className="text-text-primary font-mono text-xs">{approval.method}</span>
        <span className="text-text-muted text-xs">{approval.reason}</span>
      </div>

      {approval.args.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-text-faint text-2xs">What it sent</span>
          <div className="bg-elevated border-border-subtle border-hairline max-h-60 overflow-auto rounded p-2">
            {approval.args.map((a, i) => (
              <pre
                key={i}
                className="text-text-secondary text-2xs font-mono break-all whitespace-pre-wrap"
              >
                {pretty(a)}
              </pre>
            ))}
          </div>
        </div>
      )}

      <span className="text-text-muted text-xs">Refused in {secondsLeft}s if you do nothing</span>

      <div className="flex justify-end gap-2">
        <button
          ref={deny}
          type="button"
          disabled={busy}
          onClick={() => answer(false)}
          className="border-danger/20 bg-danger/10 text-danger hover:bg-danger/20 border-hairline rounded px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
        >
          Deny
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(true)}
          className="text-accent border-accent/30 hover:bg-accent/10 border-hairline rounded px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
        >
          Allow once
        </button>
      </div>

      {error && (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      )}
    </div>
  )
}
