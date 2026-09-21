import { lazy, Suspense } from 'react'
import type { StatsSnapshot } from './usePerformanceHistory'
import { tpsColor, fmtTps } from './helpers'
import { ChartFallback } from './ChartFallback'
import { Figure } from '../../components/ui/Figure'
import type { TileLayout } from '../../types'

// recharts is heavy (~250KB gzip) and only needed once a chart actually
// renders — lazy-load it behind one shared chunk for both chart variants. The
// specifier has to stay spelled relative to this directory: `lib/prefetch.ts`
// warms `../tiles/performance/charts`, and Vite keys a chunk by resolved
// specifier, so a path that resolved anywhere else would emit a second copy
// and warm nothing (`pnpm check-prefetch`).
const SparkChart = lazy(() => import('./charts').then((m) => ({ default: m.SparkChart })))

/**
 * The compact face of the Performance tile: the latest TPS, CPU and RAM as
 * three figures, and a sparkline of the last 60 samples under them.
 *
 * Figures first, chart below: the default layout's shape. RAM is a percentage
 * here because the three read as one row that way; the megabytes are in the
 * Overview tile's bar and the maximized table. The player count and the memory
 * bar this face used to carry are gone from it, the count because it is not a
 * performance figure and the bar because the RAM line on the chart is the same
 * number over time.
 *
 * The compact layout keeps the figures and drops the chart; the large one
 * sets them small and adds the megabytes and the player count beside them.
 *
 * Presentational — it takes the history rather than fetching it, so the tile
 * root and the Overview roll-up each supply their own.
 */
export function PerformanceSummary({
  history,
  layout = 'default',
}: {
  history: StatsSnapshot[]
  layout?: TileLayout
}) {
  const latest = history[history.length - 1]
  const tps = latest?.tps ?? -1
  const ramUsed = latest?.ramUsedMB ?? 0
  const ramTotal = latest?.ramTotalMB ?? 0
  const ramPct = ramTotal > 0 ? (ramUsed / ramTotal) * 100 : 0
  const cpu = latest?.cpuPercent ?? 0
  const players = latest?.players ?? 0
  const size = layout === 'large' ? 'sm' : 'lg'

  const sparkData = history.slice(-60).map((s) => ({
    ts: s.timestamp,
    tps: s.tps < 0 ? null : s.tps,
    ramPct: s.ramTotalMB > 0 ? (s.ramUsedMB / s.ramTotalMB) * 100 : null,
    cpu: s.cpuPercent,
  }))

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-2">
      <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-1">
        <Figure size={size} label="TPS" value={fmtTps(tps)} valueClass={tpsColor(tps)} />
        <Figure size={size} label="CPU" value={`${cpu.toFixed(1)}%`} />
        <Figure size={size} label="RAM" value={ramTotal > 0 ? `${ramPct.toFixed(0)}%` : '—'} />
        {layout === 'large' && (
          <>
            <Figure
              size={size}
              label="RAM MB"
              value={ramTotal > 0 ? `${Math.round(ramUsed)} / ${Math.round(ramTotal)}` : '—'}
            />
            <Figure size={size} label="Players" value={String(players)} />
          </>
        )}
      </div>

      {layout === 'compact' ? null : (
        <div className="border-border-subtle border-hairline min-h-0 flex-1 overflow-hidden rounded">
          {sparkData.length > 1 ? (
            <Suspense fallback={<ChartFallback />}>
              <SparkChart data={sparkData} />
            </Suspense>
          ) : (
            <div className="text-text-faint flex h-full items-center justify-center text-xs">
              waiting for data…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
