import { useRemoteStore } from '../stores/useRemoteStore'

interface Props {
  onOpen: () => void
}

/**
 * The title bar's "Remote on" chip. Rendered only while the listener is
 * running, so Remote Access is never on without being visible (§ S8.8 of
 * agent_docs/SECURITY_CHECKLIST.md). It turns to the warning colour when a
 * device or an admin-tier call is waiting for the person at the desktop.
 */
export function RemoteIndicator({ onOpen }: Props) {
  const running = useRemoteStore((s) => s.access.running)
  const clients = useRemoteStore((s) => s.access.clients)
  const waiting = useRemoteStore(
    (s) => (s.access.pendingDevices?.length ?? 0) + (s.access.approvals?.length ?? 0) > 0,
  )

  if (!running) return null

  const label = waiting
    ? 'Remote: waiting for you'
    : clients > 0
      ? `Remote on · ${clients} ${clients === 1 ? 'browser' : 'browsers'}`
      : 'Remote on'

  const tone = waiting ? 'text-warning border-warning/30' : 'text-accent border-accent/30'

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Remote access is on. Click to manage."
      aria-label="Remote access is on. Click to manage."
      className={`titlebar-no-drag border-hairline text-2xs hover:bg-hover mr-1 flex h-6 items-center gap-1.5 rounded px-2 transition-colors ${tone}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      <span>{label}</span>
    </button>
  )
}
