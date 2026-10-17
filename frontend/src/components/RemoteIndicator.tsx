import { useRemoteStore } from '../stores/useRemoteStore'

interface Props {
  onOpen: () => void
}

/**
 * The title bar's "Remote on" chip. Rendered only while the listener is
 * running, or Claude's bridge on this computer is (#515), so neither is on
 * without being visible (§ S8.8 of agent_docs/SECURITY_CHECKLIST.md). It
 * turns to the warning colour when a device, an admin-tier call or a
 * connector's sign-in is waiting for the person at the desktop, says
 * "public" while the tunnel is up, and names Claude while either of its ways
 * in is open: on this computer only, reachable from the internet, and open
 * to an agent are different things to have left on.
 */
export function RemoteIndicator({ onOpen }: Props) {
  const running = useRemoteStore((s) => s.access.running)
  const clients = useRemoteStore((s) => s.access.clients)
  const isPublic = useRemoteStore((s) => s.access.tunnel?.status === 'running')
  const localClaude = useRemoteStore((s) => s.access.localMcp?.running ?? false)
  const connectors = useRemoteStore((s) => s.access.connectors?.enabled ?? false)
  const waiting = useRemoteStore(
    (s) => (s.access.pendingDevices?.length ?? 0) + (s.access.approvals?.length ?? 0) > 0,
  )

  if (!running && !localClaude) return null

  const claude = localClaude || (running && connectors)
  let label: string
  if (waiting) {
    label = 'Remote: waiting for you'
  } else if (!running) {
    label = 'Claude on'
  } else {
    const on = isPublic ? 'Remote on, public' : 'Remote on'
    label = clients > 0 ? `${on} · ${clients} ${clients === 1 ? 'browser' : 'browsers'}` : on
    if (claude) label += ' · Claude'
  }

  const tone = waiting ? 'text-warning border-warning/30' : 'text-accent border-accent/30'
  const title = running
    ? 'Remote access is on. Click to manage.'
    : "Claude's access to this computer is on. Click to manage."

  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={title}
      className={`titlebar-no-drag border-hairline text-2xs hover:bg-hover mr-1 flex h-6 items-center gap-1.5 rounded px-2 transition-colors ${tone}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      <span>{label}</span>
    </button>
  )
}
