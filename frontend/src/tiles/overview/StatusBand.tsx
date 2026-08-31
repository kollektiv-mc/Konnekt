import { useServerStore } from '../../stores/useServerStore'
import { PILL } from './Vitals'

function Figure({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-mono text-sm font-medium ${className}`}>{value}</span>
      <span className="text-text-faint text-xs">{label}</span>
    </div>
  )
}

function tpsColor(tps: number): string {
  if (tps >= 18) return 'text-accent'
  if (tps >= 14) return 'text-yellow-400'
  return 'text-red-400'
}

/**
 * The dashboard's headline: one dot saying what the server is doing, and the
 * three numbers worth reading before anything else.
 *
 * Reads the store only, so it is live the moment the panel opens rather than
 * after a fetch — which is the point of a status band. The five faces come from
 * `Vitals`' `PILL`, and the `reachable` vs `status.running` split is the one
 * `Vitals` documents: a stopped server answers and says so, an unreachable
 * backend says nothing and leaves the figures holding whatever was last known.
 */
export function StatusBand() {
  const status = useServerStore((s) => s.status)
  const reachable = useServerStore((s) => s.reachable)

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
    <div className="border-border-subtle bg-surface border-hairline flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 rounded-[10px] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${pill.dot}`} />
        <span className={`text-sm font-semibold ${pill.text}`}>{pill.label}</span>
      </div>

      {online && <Figure label="uptime" value={status.uptime} />}
      <Figure label="players" value={`${status.players} / ${status.maxPlayers}`} />
      <Figure
        label="TPS"
        value={online && status.tps >= 0 ? status.tps.toFixed(1) : '—'}
        className={online && status.tps >= 0 ? tpsColor(status.tps) : ''}
      />
      <Figure
        label="RAM"
        value={
          online && status.ramTotal > 0
            ? `${Math.round(status.ramUsed)} / ${Math.round(status.ramTotal)} MB`
            : '—'
        }
      />
    </div>
  )
}
