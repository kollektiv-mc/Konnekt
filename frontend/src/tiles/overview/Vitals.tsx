import { useServerStore } from '../../stores/useServerStore'
import { Figure } from '../../components/ui/Figure'

function tpsColor(tps: number): string {
  if (tps >= 18) return 'text-accent'
  if (tps >= 14) return 'text-yellow-400'
  return 'text-red-400'
}

// The status pill's five faces. Starting and stopping share the warning amber
// (the label disambiguates); the transitional glow matches the accent dot's
// arbitrary-shadow idiom.
//
// Exported because the Overview panel's status band wears the same five. Two
// copies of this map is how Starting ends up amber in one place and green in
// the other.
export const PILL = {
  unreachable: { label: 'Unreachable', dot: 'bg-red-500', text: 'text-red-400' },
  offline: { label: 'Offline', dot: 'bg-red-500', text: 'text-red-400' },
  starting: {
    label: 'Starting',
    dot: 'bg-warning shadow-[0_0_6px_var(--warning)]',
    text: 'text-warning',
  },
  stopping: {
    label: 'Stopping',
    dot: 'bg-warning shadow-[0_0_6px_var(--warning)]',
    text: 'text-warning',
  },
  online: { label: 'Online', dot: 'bg-accent shadow-[0_0_6px_var(--accent)]', text: 'text-accent' },
} as const

/**
 * The server's vitals: a status pill, four figures, and the memory bar.
 *
 * This is the Overview tile's compact face. The four figures (players, TPS,
 * uptime, memory) lead at the large figure size and the bar sits under them as
 * the detail, which is the default layout's shape: the key numbers first, the
 * rest below. The pill stays above them because it is the only place on the
 * canvas that says whether the server is up at all, and a figure reading "—"
 * does not say why.
 *
 * It reads `useServerStore` and nothing else, which is why an Overview sitting
 * on the canvas costs no IPC at all — every section of the maximized dashboard
 * fetches on mount, and none of them mount until the user asks for it.
 */
export function Vitals() {
  const status = useServerStore((s) => s.status)
  const reachable = useServerStore((s) => s.reachable)

  const ramPct = status.ramTotal > 0 ? (status.ramUsed / status.ramTotal) * 100 : 0
  // A stopped server answers and says it is stopped; an unreachable backend
  // says nothing, and the numbers below are whatever was last known. The
  // stats readouts stay keyed to running (a live process has real RAM and
  // uptime through starting and stopping); only the pill reads the phase.
  const online = reachable && status.running
  const pill =
    PILL[
      !reachable
        ? 'unreachable'
        : status.state === 'starting'
          ? 'starting'
          : status.state === 'stopping'
            ? 'stopping'
            : status.running
              ? 'online'
              : 'offline'
    ]

  return (
    <div className="flex h-full flex-col gap-3 px-3 py-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${pill.dot}`} />
        <span className={`text-xs font-semibold ${pill.text}`}>{pill.label}</span>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-x-3 gap-y-2">
        <Figure label="Players" value={`${status.players} / ${status.maxPlayers}`} />
        <Figure
          label="TPS"
          value={online && status.tps >= 0 ? status.tps.toFixed(1) : '—'}
          valueClass={online && status.tps >= 0 ? tpsColor(status.tps) : undefined}
        />
        <Figure label="Uptime" value={online ? status.uptime : '—'} />
        <Figure label="Memory" value={online ? `${ramPct.toFixed(0)}%` : '—'} />
      </div>

      {online && (
        <div className="mt-auto shrink-0">
          <div className="text-text-muted mb-1 flex justify-between text-xs">
            <span>Memory</span>
            <span className="text-text-secondary font-mono">
              {Math.round(status.ramUsed)} / {Math.round(status.ramTotal)} MB
            </span>
          </div>
          <div className="bg-hover h-1 overflow-hidden rounded-full">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                ramPct > 80 ? 'bg-red-500' : ramPct > 60 ? 'bg-yellow-500' : 'bg-accent'
              }`}
              // eslint-disable-next-line no-restricted-syntax -- width is a computed percentage, not visible to Tailwind's static scanner
              style={{ width: `${ramPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
