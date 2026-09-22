import { useServerStore } from '../../stores/useServerStore'
import { Figure } from '../../components/ui/Figure'
import type { TileLayout } from '../../types'

function tpsColor(tps: number): string {
  if (tps >= 18) return 'text-accent'
  if (tps >= 14) return 'text-warning'
  return 'text-danger'
}

function tpsBand(tps: number): string {
  if (tps >= 18) return 'steady'
  if (tps >= 14) return 'strained'
  return 'lagging'
}

// The status pill's five faces. Starting and stopping share the warning amber
// (the label disambiguates); the transitional glow matches the accent dot's
// arbitrary-shadow idiom.
//
// Exported because the Overview panel's status band wears the same five. Two
// copies of this map is how Starting ends up amber in one place and green in
// the other.
export const PILL = {
  unreachable: { label: 'Unreachable', dot: 'bg-danger', text: 'text-danger' },
  offline: { label: 'Offline', dot: 'bg-danger', text: 'text-danger' },
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border-subtle border-b-hairline flex items-center justify-between py-1 last:border-0">
      <span className="text-text-muted text-xs">{label}</span>
      <span className="text-text-secondary font-mono text-xs">{value}</span>
    </div>
  )
}

/**
 * The server's vitals: a status pill, four figures, and the memory bar.
 *
 * This is the Overview tile's canvas face. The four figures (players, TPS,
 * uptime, memory) lead at the large figure size and the bar sits under them
 * as the detail, which is the default layout's shape: the key numbers first,
 * the rest below. The pill stays above them because it is the only place on
 * the canvas that says whether the server is up at all, and a figure reading
 * "—" does not say why.
 *
 * The face fits its box in both directions, with no measuring of its own.
 * The figures go four across and drop to two by two once the tile is tall
 * enough (`tile-tall`, style.css), so at the four-row minimum a 2×2 never
 * pushes the bar out. Above that, the figure block is the flexible region and
 * its rows spread over whatever height the tile has, so a tall tile is not a
 * short face with a gap under it. The bar is outside the flexible region and
 * can never be pushed out of the tile by it.
 *
 * Detailed sets the figures small in one row, keeps the bar, and adds the
 * rows the figures do not already say. Expanded is the figures alone, spread.
 *
 * It reads `useServerStore` and nothing else, which is why an Overview sitting
 * on the canvas costs no IPC at all — every section of the maximized dashboard
 * fetches on mount, and none of them mount until the user asks for it.
 */
export function Vitals({ layout = 'default' }: { layout?: TileLayout }) {
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

  const detailed = layout === 'detailed'
  const size = detailed ? 'sm' : 'lg'
  // Rows spread over the flexible block once the tile is tall; a short block
  // keeps them at the top so the first row is never the one clipped.
  const grid = detailed
    ? 'grid-cols-4 shrink-0'
    : 'grid-cols-4 tile-tall:grid-cols-2 tile-tall:content-around min-h-0 flex-1'

  const bar = online && layout !== 'expanded' && (
    <div className="shrink-0">
      <div className="text-text-muted mb-1 flex justify-between text-xs">
        <span>Memory</span>
        <span className="text-text-secondary font-mono">
          {Math.round(status.ramUsed)} / {Math.round(status.ramTotal)} MB
        </span>
      </div>
      <div className="bg-hover h-1 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            ramPct > 80 ? 'bg-danger' : ramPct > 60 ? 'bg-warning' : 'bg-accent'
          }`}
          // eslint-disable-next-line no-restricted-syntax -- width is a computed percentage, not visible to Tailwind's static scanner
          style={{ width: `${ramPct}%` }}
        />
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col gap-3 px-3 py-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${pill.dot}`} />
        <span className={`text-xs font-semibold ${pill.text}`}>{pill.label}</span>
      </div>

      <div className={`grid gap-x-3 gap-y-2 overflow-hidden ${grid}`}>
        <Figure size={size} label="Players" value={`${status.players} / ${status.maxPlayers}`} />
        <Figure
          size={size}
          label="TPS"
          value={online && status.tps >= 0 ? status.tps.toFixed(1) : '—'}
          valueClass={online && status.tps >= 0 ? tpsColor(status.tps) : undefined}
        />
        <Figure size={size} label="Uptime" value={online ? status.uptime : '—'} />
        <Figure size={size} label="Memory" value={online ? `${ramPct.toFixed(0)}%` : '—'} />
      </div>

      {bar}

      {detailed && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DetailRow
            label="Memory free"
            value={
              online && status.ramTotal > 0
                ? `${Math.round(status.ramTotal - status.ramUsed)} MB`
                : '—'
            }
          />
          <DetailRow
            label="Tick rate"
            value={online && status.tps >= 0 ? tpsBand(status.tps) : '—'}
          />
        </div>
      )}
    </div>
  )
}
