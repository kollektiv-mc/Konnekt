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

// ─── overview chart ──────────────────────────────────────────────────────────

export interface OverviewDatum {
  ts: number
  cpu: number | null
  ramPct: number | null
  players: number | null
}

// Recessive grid and axis ink, shared by both plots below so they read as one
// figure rather than two charts that happen to be stacked.
const AXIS_TICK = { fill: 'var(--text-faint)', fontSize: 9 }
const GRID_STROKE = 'var(--border-subtle)'
// Both plots reserve the same gutter for their Y axis, which is the only thing
// keeping the two time axes in vertical register.
const Y_WIDTH = 30
const PLOT_MARGIN = { top: 4, right: 8, bottom: 0, left: 0 }

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-overlay)',
  border: 'var(--border-hairline) solid var(--border-hover)',
  borderRadius: 6,
  fontSize: 10,
  color: 'var(--text-primary)',
  padding: '4px 8px',
}

/**
 * CPU, RAM and player count over the last hour, as small multiples: two
 * percentages on one 0-100 plot, and the player count on its own strip below,
 * sharing the time axis.
 *
 * The player count is deliberately *not* a third line on the first plot. It is
 * a count, not a percentage, so putting it there needs either a second y-scale
 * — which invents a correlation out of whatever alignment the two scales happen
 * to land on — or normalising it against max-players, which renders 3-of-20 as
 * 15% and reads as a third utilisation line. Neither is true. Separate plot,
 * shared x domain, and the reader compares by time rather than by height.
 *
 * Colours come from the app's four semantic tokens, which is all there is:
 * `tokens.css` is generated from a vendored source and carries no categorical
 * ramp. Green and amber are the only pair of them that clears both the
 * colourblind and normal-vision separation thresholds — amber against red, what
 * `SparkChart` above uses for RAM and CPU, does not. The players strip takes
 * recessive text ink rather than a fourth hue: it is one series in its own plot,
 * so it needs no separation from anything, and staying grey keeps it reading as
 * context for the plot above.
 */
export function OverviewChart({ data, maxPlayers }: { data: OverviewDatum[]; maxPlayers: number }) {
  // A server with no max reported yet would collapse the strip's domain to
  // [0, 0] and draw the line along the top edge.
  const playerMax = Math.max(maxPlayers || 20, 1)

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-[3]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={PLOT_MARGIN}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="ts" hide />
            <YAxis
              width={Y_WIDTH}
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ padding: '1px 0' }}
              formatter={(value, name) => {
                if (value === null) return ['—', name]
                const labels: Record<string, string> = { cpu: 'CPU', ramPct: 'RAM' }
                return [`${(value as number).toFixed(1)}%`, labels[name as string] ?? name]
              }}
              labelFormatter={(_, payload) => {
                const ts = payload?.[0]?.payload?.ts as number | undefined
                return ts ? fmtTime(ts) : ''
              }}
              separator=": "
            />
            <Line
              type="monotone"
              dataKey="cpu"
              stroke="var(--warning)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="ramPct"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={PLOT_MARGIN}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="ts"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
              tickFormatter={(ts) => fmtTime(ts as number)}
            />
            <YAxis
              width={Y_WIDTH}
              domain={[0, playerMax]}
              ticks={[0, playerMax]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ padding: '1px 0' }}
              formatter={(value) => [String(value ?? '—'), 'Players']}
              labelFormatter={(_, payload) => {
                const ts = payload?.[0]?.payload?.ts as number | undefined
                return ts ? fmtTime(ts) : ''
              }}
              separator=": "
            />
            {/* A player count is an integer that steps when someone joins or
                leaves. A monotone spline would draw a smooth ramp between two
                samples and imply half a player in between. */}
            <Line
              type="stepAfter"
              dataKey="players"
              stroke="var(--text-secondary)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
