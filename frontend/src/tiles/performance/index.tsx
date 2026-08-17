import { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import type { TileProps } from '../../types'
import { usePerformanceHistory } from './usePerformanceHistory'
import type { StatsSnapshot } from './usePerformanceHistory'
import { tpsColor, tpsStrokeColor, fmtTime, fmtTps } from './helpers'

// recharts is heavy (~250KB gzip) and only needed once a chart actually
// renders — lazy-load it behind one shared chunk for both chart variants.
const SparkChart = lazy(() => import('./charts').then((m) => ({ default: m.SparkChart })))
const HistoryChart = lazy(() => import('./charts').then((m) => ({ default: m.HistoryChart })))

function ChartFallback() {
  return (
    <div className="text-text-faint flex h-full items-center justify-center text-xs">
      loading chart…
    </div>
  )
}

type SortKey = 'timestamp' | 'tps' | 'ramUsedMB' | 'ramPct' | 'cpuPercent' | 'players'
type SortDir = 'asc' | 'desc'

// ─── compact view ────────────────────────────────────────────────────────────

function CompactView({ history }: { history: StatsSnapshot[] }) {
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
      <span className="text-[10px] text-white/40">{label}</span>
      <span className={`font-mono text-xs font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

// ─── expanded view ────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
] as const

type TimeRange = (typeof TIME_RANGES)[number]['minutes']

function ExpandedView({ history }: { history: StatsSnapshot[] }) {
  const [range, setRange] = useState<TimeRange>(15)
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const anchor = history.length > 0 ? history[history.length - 1].timestamp : Date.now()
  const cutoff = anchor - range * 60 * 1000

  // Animated cutoff — drives the XAxis domain and chart data filter.
  // Tweens smoothly when the range changes; tracks anchor silently otherwise.
  const [animCutoff, setAnimCutoffRaw] = useState(cutoff)
  const animCutoffRef = useRef(animCutoff)
  const rafRef = useRef<number | null>(null)
  const isAnimatingRef = useRef(false)

  // Keep animCutoff current when new data arrives and no animation is running.
  useEffect(() => {
    if (!isAnimatingRef.current) {
      animCutoffRef.current = cutoff
      setAnimCutoffRaw(cutoff)
    }
  }, [cutoff])

  // Cleanup on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const changeRange = useCallback(
    (newRange: TimeRange) => {
      if (newRange === range) return
      setRange(newRange)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      const from = animCutoffRef.current
      const to = anchor - newRange * 60 * 1000
      const start = performance.now()
      isAnimatingRef.current = true
      const tick = (now: number) => {
        const t = Math.min((now - start) / 380, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        const v = from + (to - from) * eased
        animCutoffRef.current = v
        setAnimCutoffRaw(v)
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          rafRef.current = null
          isAnimatingRef.current = false
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [range, anchor],
  )

  // filtered is non-animated — used for the table and summary stats.
  const filtered = useMemo(() => history.filter((s) => s.timestamp >= cutoff), [history, cutoff])

  // chartData is animated — filtered by the tweening animCutoff.
  const chartData = useMemo(
    () =>
      history
        .filter((s) => s.timestamp >= animCutoff)
        .map((s) => ({
          ts: s.timestamp,
          tps: hidden.has('tps') ? null : s.tps < 0 ? null : s.tps,
          ramPct: hidden.has('ramPct')
            ? null
            : s.ramTotalMB > 0
              ? Math.round((s.ramUsedMB / s.ramTotalMB) * 100)
              : null,
          cpu: hidden.has('cpu') ? null : Math.round(s.cpuPercent),
          players: hidden.has('players') ? null : s.players,
        })),
    [history, animCutoff, hidden],
  )

  const tableRows = useMemo(() => {
    const rows = filtered.map((s) => ({
      ...s,
      ramPct: s.ramTotalMB > 0 ? (s.ramUsedMB / s.ramTotalMB) * 100 : 0,
    }))
    return [...rows].sort((a, b) => {
      const v = (x: typeof a) => {
        if (sortKey === 'ramPct') return x.ramPct
        return x[sortKey] as number
      }
      return sortDir === 'asc' ? v(a) - v(b) : v(b) - v(a)
    })
  }, [filtered, sortKey, sortDir])

  const summary = useMemo(() => {
    if (filtered.length === 0) return null
    const valid = filtered.filter((s) => s.tps >= 0)
    const tpsList = valid.map((s) => s.tps)
    const ramList = filtered.map((s) => s.ramUsedMB)
    const pctList = filtered
      .filter((s) => s.ramTotalMB > 0)
      .map((s) => (s.ramUsedMB / s.ramTotalMB) * 100)
    const cpuList = filtered.map((s) => s.cpuPercent)
    const plList = filtered.map((s) => s.players)
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
    return {
      tps: { min: Math.min(...tpsList), max: Math.max(...tpsList), avg: avg(tpsList) },
      ram: { min: Math.min(...ramList), max: Math.max(...ramList), avg: avg(ramList) },
      pct: { min: Math.min(...pctList), max: Math.max(...pctList), avg: avg(pctList) },
      cpu: { min: Math.min(...cpuList), max: Math.max(...cpuList), avg: avg(cpuList) },
      players: { min: Math.min(...plList), max: Math.max(...plList), avg: avg(plList) },
    }
  }, [filtered])

  const toggleHide = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const latest = history[history.length - 1]
  const latestTps = latest?.tps ?? -1

  // Dynamic TPS stroke color based on latest value
  const tpsStroke = tpsStrokeColor(latestTps)

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-4 py-3">
      {/* time range selector */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-white/40">Window:</span>
        {TIME_RANGES.map(({ label, minutes }) => (
          <button
            key={label}
            onClick={() => changeRange(minutes)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              range === minutes
                ? 'border-accent/60 text-accent bg-accent/10'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="text-text-faint ml-auto text-xs">{filtered.length} samples</span>
      </div>

      {/* chart */}
      <div className="min-h-0 flex-[3]">
        {chartData.length > 1 ? (
          <Suspense fallback={<ChartFallback />}>
            <HistoryChart
              data={chartData}
              animCutoff={animCutoff}
              anchor={anchor}
              hidden={hidden}
              tpsStroke={tpsStroke}
              onToggleHide={toggleHide}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/20">
            <span className="text-text-faint">
              {history.length === 0
                ? 'No data yet — start the server to begin recording'
                : 'No data in this time window'}
            </span>
          </div>
        )}
      </div>

      {/* sortable history table */}
      <div className="min-h-0 flex-[2] overflow-auto rounded border border-white/5">
        <table className="w-full border-collapse font-mono text-xs">
          <thead className="sticky top-0 bg-[#0a0c12]">
            <tr>
              {(
                [
                  { key: 'timestamp', label: 'Time' },
                  { key: 'tps', label: 'TPS' },
                  { key: 'ramUsedMB', label: 'RAM (MB)' },
                  { key: 'ramPct', label: 'RAM%' },
                  { key: 'cpuPercent', label: 'CPU%' },
                  { key: 'players', label: 'Players' },
                ] as { key: SortKey; label: string }[]
              ).map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="cursor-pointer border-b border-white/5 px-2 py-1 text-left font-medium whitespace-nowrap text-white/40 select-none hover:text-white/70"
                >
                  {label}
                  {sortKey === key && (
                    <span className="text-accent ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary && (
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <td className="px-2 py-1 text-white/30 italic">min·avg·max</td>
                <td className={`px-2 py-1 ${tpsColor(summary.tps.avg)}`}>
                  {summary.tps.min.toFixed(1)} · {summary.tps.avg.toFixed(1)} ·{' '}
                  {summary.tps.max.toFixed(1)}
                </td>
                <td className="px-2 py-1 text-white/50">
                  {Math.round(summary.ram.min)} · {Math.round(summary.ram.avg)} ·{' '}
                  {Math.round(summary.ram.max)}
                </td>
                <td className="px-2 py-1 text-white/50">
                  {summary.pct.min.toFixed(0)}% · {summary.pct.avg.toFixed(0)}% ·{' '}
                  {summary.pct.max.toFixed(0)}%
                </td>
                <td className="px-2 py-1 text-white/50">
                  {summary.cpu.min.toFixed(0)}% · {summary.cpu.avg.toFixed(0)}% ·{' '}
                  {summary.cpu.max.toFixed(0)}%
                </td>
                <td className="px-2 py-1 text-white/50">
                  {summary.players.min} · {summary.players.avg.toFixed(1)} · {summary.players.max}
                </td>
              </tr>
            )}
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-white/20">
                  No data in this window
                </td>
              </tr>
            )}
            {tableRows.map((row) => (
              <tr
                key={row.timestamp}
                className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]"
              >
                <td className="px-2 py-1 text-white/40">{fmtTime(row.timestamp)}</td>
                <td className={`px-2 py-1 font-medium ${tpsColor(row.tps)}`}>{fmtTps(row.tps)}</td>
                <td className="px-2 py-1 text-white/60">
                  {Math.round(row.ramUsedMB)} / {Math.round(row.ramTotalMB)}
                </td>
                <td className="px-2 py-1 text-white/60">{row.ramPct.toFixed(0)}%</td>
                <td className="px-2 py-1 text-white/60">{row.cpuPercent.toFixed(1)}%</td>
                <td className="px-2 py-1 text-white/60">{row.players}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── tile root ────────────────────────────────────────────────────────────────

export function PerformanceTile({ serverId, maximized }: TileProps) {
  const history = usePerformanceHistory(serverId)
  return maximized ? <ExpandedView history={history} /> : <CompactView history={history} />
}
