import type { WorldSystem } from './useWorlds'
import { fmtBytes, relativeMs } from '../../lib/format'
import { Headline } from '../../components/ui/Figure'
import type { TileLayout } from '../../types'

interface Props {
  worlds: WorldSystem[]
  loading: boolean
  error: string | null
  layout?: TileLayout
}

/**
 * The compact face of the Worlds tile: how many world saves exist and what
 * they weigh, which one is active, and the list of them with their sizes.
 *
 * The count is the figure, the active world sits at the end of the same line,
 * and the list is the detail below: the default layout's shape. Expanded keeps
 * the line alone, centred; detailed sets it small and adds when each world was
 * last played.
 *
 * Presentational on purpose. The tile's maximized face is a WebGL scene behind
 * `lazy()`, and keeping this half free of it is what lets the Overview roll-up
 * show worlds without three.js ever entering the picture.
 */
export function WorldsSummary({ worlds, loading, error, layout = 'default' }: Props) {
  const active = worlds.find((w) => w.active)
  const total = worlds.reduce((sum, w) => sum + w.totalSize, 0)

  return (
    <div
      className={`flex h-full flex-col gap-2 overflow-hidden px-3 py-2 ${layout === 'expanded' ? 'justify-center' : ''}`}
    >
      <Headline
        size={layout === 'detailed' ? 'sm' : 'lg'}
        value={String(worlds.length)}
        unit={worlds.length === 1 ? 'world' : `worlds · ${fmtBytes(total)}`}
        aside={
          active ? (
            <span className="text-accent truncate" title="Active world">
              {active.name} active
            </span>
          ) : undefined
        }
      />

      {layout !== 'expanded' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <span className="text-text-faint font-mono text-xs">loading…</span>
            </div>
          )}
          {error && <div className="text-danger font-mono text-xs">{error}</div>}
          {!loading && worlds.length === 0 && !error && (
            <div className="flex h-full items-center justify-center">
              <span className="text-text-faint font-mono text-xs">maximize to explore worlds</span>
            </div>
          )}
          {worlds.map((w) => (
            <div
              key={w.name}
              className="border-border-subtle border-b-hairline flex items-center gap-2 py-1 last:border-0"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  w.active ? 'bg-success' : 'bg-border-subtle'
                }`}
              />
              <span
                className={`flex-1 truncate text-xs ${
                  w.active ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {w.name}
              </span>
              {layout === 'detailed' && (
                <span className="text-text-faint text-2xs shrink-0 font-mono">
                  {relativeMs(w.modified)}
                </span>
              )}
              <span className="text-text-faint shrink-0 font-mono text-xs">
                {fmtBytes(w.totalSize)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
