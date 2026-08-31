import { lazy, Suspense } from 'react'
import { Gauge } from '../../lib/icons'
import { useServerStore } from '../../stores/useServerStore'
import { usePerformanceHistory } from '../performance/usePerformanceHistory'
import { ChartFallback } from '../performance/ChartFallback'
import { Section, SectionEmpty } from './Section'

// Same specifier `PerformanceSummary` and the tile's expanded view use, so all
// three resolve to the one recharts chunk `lib/prefetch.ts` warms — see
// `pnpm check-prefetch`.
const OverviewChart = lazy(() =>
  import('../performance/charts').then((m) => ({ default: m.OverviewChart })),
)

/** Swatch + name + current value: the chart's legend and its readout at once. */
function Key({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-0.5 w-3 shrink-0 rounded-full ${color}`} />
      <span className="text-text-faint text-xs">{label}</span>
      <span className="text-text-secondary font-mono text-xs">{value}</span>
    </div>
  )
}

export function PerformanceSection({ serverId }: { serverId: string }) {
  const history = usePerformanceHistory(serverId)
  const maxPlayers = useServerStore((s) => s.status.maxPlayers)

  const data = history.map((s) => ({
    ts: s.timestamp,
    cpu: s.cpuPercent,
    ramPct: s.ramTotalMB > 0 ? (s.ramUsedMB / s.ramTotalMB) * 100 : null,
    players: s.players,
  }))

  const latest = data[data.length - 1]

  return (
    <Section tileId="performance" icon={Gauge} label="Performance" meta="last hour">
      {data.length > 1 ? (
        <div className="flex h-full flex-col gap-1 px-3 py-2">
          {/* The legend is required rather than decorative: with two lines on
              one plot, identity must not rest on colour alone. Carrying the
              current value in it means it doubles as the readout, so no number
              has to be printed onto the lines themselves. */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
            <Key color="bg-warning" label="CPU" value={`${(latest?.cpu ?? 0).toFixed(1)}%`} />
            <Key
              color="bg-accent"
              label="RAM"
              value={latest?.ramPct != null ? `${latest.ramPct.toFixed(0)}%` : '—'}
            />
            <Key
              color="bg-[var(--text-secondary)]"
              label="Players"
              value={String(latest?.players ?? 0)}
            />
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<ChartFallback />}>
              <OverviewChart data={data} maxPlayers={maxPlayers} />
            </Suspense>
          </div>
        </div>
      ) : (
        <SectionEmpty>waiting for data…</SectionEmpty>
      )}
    </Section>
  )
}
