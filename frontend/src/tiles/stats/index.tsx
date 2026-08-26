import { useServerStore } from '../../stores/useServerStore'
import type { TileProps } from '../../types'

function tpsColor(tps: number): string {
  if (tps >= 18) return 'text-accent'
  if (tps >= 14) return 'text-yellow-400'
  return 'text-red-400'
}

function StatRow({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className="border-border-subtle border-b-hairline flex items-center justify-between py-1 last:border-0">
      <span className="text-text-muted text-xs">{label}</span>
      <span className={`font-mono text-sm font-medium ${className}`}>{value}</span>
    </div>
  )
}

// The status pill's five faces. Starting and stopping share the warning amber
// (the label disambiguates); the transitional glow matches the accent dot's
// arbitrary-shadow idiom.
const PILL = {
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

// `serverId` is unused: the status this renders is hydrated once in App by
// useServerStatusSync, so the tile is a pure reader of the shared store.
export function StatsTile(_props: TileProps) {
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
    <div className="flex h-full flex-col justify-between px-3 py-3">
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${pill.dot}`} />
        <span className={`text-sm font-semibold ${pill.text}`}>{pill.label}</span>
        {online && <span className="text-text-faint ml-auto text-xs">{status.uptime}</span>}
      </div>

      <div className="flex-1">
        <StatRow label="Players" value={`${status.players} / ${status.maxPlayers}`} />
        <StatRow
          label="TPS"
          value={online && status.tps >= 0 ? status.tps.toFixed(1) : '—'}
          className={online && status.tps >= 0 ? tpsColor(status.tps) : ''}
        />
        <StatRow
          label="RAM"
          value={online ? `${Math.round(status.ramUsed)} / ${Math.round(status.ramTotal)} MB` : '—'}
        />
      </div>

      {online && (
        <div className="mt-2">
          <div className="text-text-faint mb-1 flex justify-between text-xs">
            <span>Memory</span>
            <span>{ramPct.toFixed(0)}%</span>
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
