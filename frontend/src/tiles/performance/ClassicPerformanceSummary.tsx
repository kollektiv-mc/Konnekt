import { lazy, Suspense } from 'react'
import type { StatsSnapshot } from './usePerformanceHistory'
import { tpsColor, fmtTps } from './helpers'
import { ChartFallback } from './ChartFallback'

// The same specifier `PerformanceSummary.tsx` uses, for the reason it gives:
// one resolved path, one recharts chunk (`pnpm check-prefetch`).
const SparkChart = lazy(() => import('./charts').then((m) => ({ default: m.SparkChart })))

function StatCell({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs text-white/40">{label}</span>
      <span className={`font-mono text-xs font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

/**
 * The classic face: the compact face this tile had before the figure-first
 * one, kept verbatim behind Settings › Appearance › "Classic tile faces" for
 * anyone who preferred it. It ignores the per-tile layout. Change the
 * figure-first face for new work; this one only follows if a hook it shares
 * changes shape.
 */
export function ClassicPerformanceSummary({ history }: { history: StatsSnapshot[] }) {
  const latest = history[history.length - 1]
  const tps = latest?.tps ?? -1
  const ramUsed = latest?.ramUsedMB ?? 0
  const ramTotal = latest?.ramTotalMB ?? 0
  const ramPct = ramTotal > 0 ? (ramUsed / ramTotal) * 100 : 0
  const cpu = latest?.cpuPercent ?? 0
  const players = latest?.players ?? 0

  const sparkData = history.slice(-60).map((s) => ({
    ts: s.timestamp,
    tps: s.tps < 0 ? null : s.tps,
    ramPct: s.ramTotalMB > 0 ? (s.ramUsedMB / s.ramTotalMB) * 100 : null,
    cpu: s.cpuPercent,
  }))

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <StatCell label="TPS" value={fmtTps(tps)} valueClass={tpsColor(tps)} />
        <StatCell label="CPU" value={`${cpu.toFixed(1)}%`} />
        <StatCell
          label="RAM"
          value={ramTotal > 0 ? `${Math.round(ramUsed)} / ${Math.round(ramTotal)} MB` : '—'}
        />
        <StatCell label="Players" value={String(players)} />
      </div>

      {ramTotal > 0 && (
        <div className="bg-hover h-1 shrink-0 overflow-hidden rounded-full">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              ramPct > 80 ? 'bg-[var(--danger)]' : ramPct > 60 ? 'bg-[var(--warning)]' : 'bg-accent'
            }`}
            // eslint-disable-next-line no-restricted-syntax -- width is a computed percentage, not visible to Tailwind's static scanner
            style={{ width: `${Math.min(ramPct, 100)}%` }}
          />
        </div>
      )}

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
    </div>
  )
}
