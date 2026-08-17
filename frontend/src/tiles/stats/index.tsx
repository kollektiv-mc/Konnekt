import { useServerStatus } from './useServerStatus'
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
    <div className="border-border-subtle flex items-center justify-between border-b-[0.5px] py-1 last:border-0">
      <span className="text-text-muted text-xs">{label}</span>
      <span className={`font-mono text-sm font-medium ${className}`}>{value}</span>
    </div>
  )
}

export function StatsTile({ serverId }: TileProps) {
  const { status } = useServerStatus(serverId)

  const ramPct = status.ramTotal > 0 ? (status.ramUsed / status.ramTotal) * 100 : 0

  return (
    <div className="flex h-full flex-col justify-between px-3 py-3">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${status.running ? 'bg-accent shadow-[0_0_6px_var(--accent)]' : 'bg-red-500'}`}
        />
        <span
          className={`text-sm font-semibold ${status.running ? 'text-accent' : 'text-red-400'}`}
        >
          {status.running ? 'Online' : 'Offline'}
        </span>
        {status.running && <span className="text-text-faint ml-auto text-xs">{status.uptime}</span>}
      </div>

      <div className="flex-1">
        <StatRow label="Players" value={`${status.players} / ${status.maxPlayers}`} />
        <StatRow
          label="TPS"
          value={status.running && status.tps >= 0 ? status.tps.toFixed(1) : '—'}
          className={status.running && status.tps >= 0 ? tpsColor(status.tps) : ''}
        />
        <StatRow
          label="RAM"
          value={
            status.running
              ? `${Math.round(status.ramUsed)} / ${Math.round(status.ramTotal)} MB`
              : '—'
          }
        />
      </div>

      {status.running && (
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
