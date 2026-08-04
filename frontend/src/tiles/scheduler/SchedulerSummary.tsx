import type { models } from '../../../wailsjs/go/models'

interface Props {
  graphs: models.Graph[]
  nextRuns: Record<string, number>
  /** First hydration still in flight — distinct from "no graphs configured". */
  loading?: boolean
  /** IPC failure. Rendered alongside cached graphs rather than replacing them. */
  error?: string | null
}

// Compact "in 5m" / "in 2h" / "in 3d" style relative time for a future ms epoch.
function formatNextRun(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

export function SchedulerSummary({ graphs, nextRuns, loading, error }: Props) {
  const enabled = graphs.filter((g) => g.enabled).length

  // Soonest upcoming scheduled run across all graphs.
  const soonest = Object.values(nextRuns)
    .filter((v) => v > 0)
    .sort((a, b) => a - b)[0]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Stats row */}
      <div className="flex items-center justify-center gap-4 py-2">
        <div className="flex flex-col items-center">
          <span className="text-accent font-mono text-xl">{graphs.length}</span>
          <span className="text-text-faint font-mono text-xs">total</span>
        </div>
        <div className="bg-border-subtle h-7 w-[0.5px]" />
        <div className="flex flex-col items-center">
          <span className="text-success font-mono text-xl">{enabled}</span>
          <span className="text-text-faint font-mono text-xs">active</span>
        </div>
      </div>

      {/* Graph list */}
      <div className="flex-1 overflow-y-auto px-2 pb-1">
        {graphs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-text-faint font-mono text-xs">
              {loading ? 'loading…' : 'maximize to add graphs'}
            </span>
          </div>
        ) : (
          graphs.slice(0, 8).map((g) => {
            const next = nextRuns[g.id]
            return (
              <div key={g.id} className="flex items-center gap-1.5 py-0.5">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${g.enabled ? 'bg-success' : 'bg-border-subtle'}`}
                />
                <span
                  className={`flex-1 truncate font-mono text-xs ${g.enabled ? 'text-text-primary' : 'text-text-muted'}`}
                >
                  {g.name || g.id}
                </span>
                {g.enabled && next > 0 && (
                  <span
                    className="text-text-faint shrink-0 font-mono text-xs"
                    title="Next scheduled run"
                  >
                    {formatNextRun(next)}
                  </span>
                )}
              </div>
            )
          })
        )}
        {graphs.length > 8 && (
          <span className="text-text-faint font-mono text-xs">+{graphs.length - 8} more</span>
        )}
      </div>

      <div className="px-2 pb-1">
        {error ? (
          <span className="text-danger font-mono text-xs" title={error}>
            scheduler unavailable
          </span>
        ) : (
          <span className="text-text-faint font-mono text-xs">
            {soonest ? `next run ${formatNextRun(soonest)}` : 'maximize to edit'}
          </span>
        )}
      </div>
    </div>
  )
}
