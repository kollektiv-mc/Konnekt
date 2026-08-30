import type { TileProps } from '../../types'
import { useWorlds } from './useWorlds'
import type { WorldSystem } from './useWorlds'

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface Props {
  worlds: WorldSystem[]
  loading: boolean
  error: string | null
}

/**
 * The compact face of the Worlds tile: how many world saves exist, which one
 * is active, and their sizes.
 *
 * Presentational on purpose. The tile's maximized face is a WebGL scene behind
 * `lazy()`, and keeping this half free of it is what lets the Overview roll-up
 * show worlds without three.js ever entering the picture.
 */
export function WorldsSummary({ worlds, loading, error }: Props) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Stats row */}
      <div className="flex items-center justify-center gap-4 py-2">
        <div className="flex flex-col items-center">
          <span className="text-accent font-mono text-xl">{worlds.length}</span>
          <span className="text-text-faint font-mono text-xs">worlds</span>
        </div>
        <div className="bg-border-subtle h-7 w-[0.5px]" />
        <div className="flex flex-col items-center">
          <span className="text-success font-mono text-xl">
            {worlds.find((w) => w.active)?.name ?? '—'}
          </span>
          <span className="text-text-faint font-mono text-xs">active</span>
        </div>
      </div>

      {/* World list */}
      <div className="flex-1 overflow-y-auto px-2 pb-1">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <span className="text-text-faint font-mono text-xs">loading…</span>
          </div>
        )}
        {error && <div className="px-1 font-mono text-xs text-[#ef4444]">{error}</div>}
        {!loading && worlds.length === 0 && !error && (
          <div className="flex h-full items-center justify-center">
            <span className="text-text-faint font-mono text-xs">maximize to explore worlds</span>
          </div>
        )}
        {worlds.slice(0, 8).map((w) => (
          <div key={w.name} className="flex items-center gap-1.5 py-0.5">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                w.active ? 'bg-success' : 'bg-border-subtle'
              }`}
            />
            <span
              className={`flex-1 truncate font-mono text-xs ${
                w.active ? 'text-text-primary' : 'text-text-muted'
              }`}
            >
              {w.name}
            </span>
            <span className="text-text-faint shrink-0 font-mono text-xs">
              {fmtBytes(w.totalSize)}
            </span>
          </div>
        ))}
        {worlds.length > 8 && (
          <span className="text-text-faint font-mono text-xs">+{worlds.length - 8} more</span>
        )}
      </div>

      <div className="px-2 pb-1">
        <span className="text-text-faint font-mono text-xs">maximize to explore</span>
      </div>
    </div>
  )
}

/** The registry's `summary` entry: the same view, listing worlds for itself. */
export function WorldsSummaryCard(_props: TileProps) {
  const { worlds, loading, error } = useWorlds()
  return <WorldsSummary worlds={worlds} loading={loading} error={error} />
}
