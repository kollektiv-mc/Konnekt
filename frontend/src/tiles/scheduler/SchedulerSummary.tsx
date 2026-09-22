import type { models } from '../../../wailsjs/go/models'
import { untilMs } from '../../lib/format'
import { Headline } from '../../components/ui/Figure'
import type { TileLayout } from '../../types'

interface Props {
  graphs: models.Graph[]
  nextRuns: Record<string, number>
  /** First hydration still in flight — distinct from "no graphs configured". */
  loading?: boolean
  /** IPC failure. Rendered alongside cached graphs rather than replacing them. */
  error?: string | null
  layout?: TileLayout
}

/**
 * The compact face of the Scheduler tile: how many graphs are armed, when the
 * next one fires, and the list of them.
 *
 * "3 / 4 armed" is the figure, the soonest run sits at the end of the same
 * line, and the graphs are the detail under it: the default layout's shape.
 * The two centred counters this replaced said the same thing in twice the
 * height and left the next-run time for a footer. Expanded keeps the line
 * alone, centred; detailed sets it small and gives each row its block count.
 */
export function SchedulerSummary({ graphs, nextRuns, loading, error, layout = 'default' }: Props) {
  const enabled = graphs.filter((g) => g.enabled).length

  // Soonest upcoming scheduled run across all graphs.
  const soonest = Object.values(nextRuns)
    .filter((v) => v > 0)
    .sort((a, b) => a - b)[0]

  return (
    <div
      className={`flex h-full flex-col gap-2 overflow-hidden px-3 py-2 ${layout === 'expanded' ? 'justify-center' : ''}`}
    >
      <Headline
        size={layout === 'detailed' ? 'sm' : 'lg'}
        value={`${enabled} / ${graphs.length}`}
        unit="armed"
        aside={
          error ? (
            <span className="text-danger" title={error}>
              unavailable
            </span>
          ) : soonest ? (
            `next ${untilMs(soonest)}`
          ) : undefined
        }
      />

      {layout !== 'expanded' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {graphs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <span className="text-text-faint font-mono text-xs">
                {loading ? 'loading…' : 'maximize to add graphs'}
              </span>
            </div>
          ) : (
            graphs.map((g) => {
              const next = nextRuns[g.id]
              return (
                <div
                  key={g.id}
                  className="border-border-subtle border-b-hairline flex items-center gap-2 py-1 last:border-0"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${g.enabled ? 'bg-success' : 'bg-border-subtle'}`}
                  />
                  <span
                    className={`flex-1 truncate text-xs ${g.enabled ? 'text-text-primary' : 'text-text-muted'}`}
                  >
                    {g.name || g.id}
                  </span>
                  {layout === 'detailed' && (
                    <span className="text-text-faint text-2xs shrink-0 font-mono">
                      {g.nodes?.length ?? 0} blocks
                    </span>
                  )}
                  {g.enabled && (
                    <span
                      className="text-text-faint shrink-0 font-mono text-xs"
                      title={next > 0 ? 'Next scheduled run' : 'Runs on an event, not a clock'}
                    >
                      {next > 0 ? untilMs(next) : 'on trigger'}
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
