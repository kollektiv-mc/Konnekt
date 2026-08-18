import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { fmtTime } from './helpers'

export interface SparkDatum {
  ts: number
  tps: number | null
  ramPct: number | null
  cpu: number | null
}

export function SparkChart({ data }: { data: SparkDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-overlay)',
            border: 'var(--border-hairline) solid var(--border-hover)',
            borderRadius: 6,
            fontSize: 10,
            color: 'var(--text-primary)',
            padding: '4px 8px',
          }}
          itemStyle={{ padding: '1px 0' }}
          formatter={(value, name) => {
            if (value === null) return ['—', name]
            const labels: Record<string, string> = { tps: 'TPS', ramPct: 'RAM%', cpu: 'CPU%' }
            const units: Record<string, string> = { tps: '', ramPct: '%', cpu: '%' }
            const num = value as number
            return [
              `${num.toFixed(1)}${units[name as string] ?? ''}`,
              labels[name as string] ?? name,
            ]
          }}
          labelFormatter={(_, payload) => {
            const ts = payload?.[0]?.payload?.ts as number | undefined
            return ts ? fmtTime(ts) : ''
          }}
          separator=": "
        />
        <Line
          type="monotone"
          dataKey="tps"
          stroke="var(--accent)"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="ramPct"
          stroke="var(--warning)"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="cpu"
          stroke="var(--danger)"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export interface HistoryDatum {
  ts: number
  tps: number | null
  ramPct: number | null
  cpu: number | null
  players: number | null
}

export function HistoryChart({
  data,
  animCutoff,
  anchor,
  hidden,
  tpsStroke,
  onToggleHide,
}: {
  data: HistoryDatum[]
  animCutoff: number
  anchor: number
  hidden: Set<string>
  tpsStroke: string
  onToggleHide: (key: string) => void
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={[animCutoff, anchor]}
          tickFormatter={(v) => fmtTime(v)}
          tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={60}
        />
        <YAxis
          yAxisId="left"
          domain={[0, 20]}
          tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-overlay)',
            border: 'var(--border-hairline) solid var(--border-hover)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--text-primary)',
          }}
          labelFormatter={(v) => fmtTime(v as number)}
          formatter={(value, name) => {
            const labels: Record<string, string> = {
              tps: 'TPS',
              ramPct: 'RAM%',
              cpu: 'CPU%',
              players: 'Players',
            }
            return [value === null ? '—' : value, labels[name as string] ?? name]
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          formatter={(value) => {
            const labels: Record<string, string> = {
              tps: 'TPS',
              ramPct: 'RAM%',
              cpu: 'CPU%',
              players: 'Players',
            }
            return (
              <span className={hidden.has(value) ? 'text-white/25' : 'text-white/70'}>
                {labels[value] ?? value}
              </span>
            )
          }}
          onClick={(e) => onToggleHide(e.dataKey as string)}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="tps"
          stroke={tpsStroke}
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="ramPct"
          stroke="var(--warning)"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cpu"
          stroke="var(--danger)"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="players"
          stroke="#60a5fa"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
