import { Workflow } from '../../lib/icons'
import { untilMs } from '../../lib/format'
import { useScheduler } from '../scheduler/useScheduler'
import { Section, SectionEmpty } from './Section'

/**
 * Which automations are armed, and when each next fires.
 *
 * Enabled graphs only. A disabled graph is not going to do anything, so listing
 * it here would be padding a "what is running" answer with what is not.
 *
 * The cheapest section in the panel: `useScheduler` wraps `useSchedulerStore`,
 * so this reads state the tile already hydrated rather than fetching again, and
 * the next-run times arrive on the backend's per-minute push.
 */
export function SchedulesSection() {
  const { graphs, nextRuns, loading, hydrated, error } = useScheduler()
  const enabled = graphs.filter((g) => g.enabled)

  return (
    <Section
      tileId="scheduler"
      icon={Workflow}
      label="Schedules"
      meta={enabled.length || undefined}
    >
      {enabled.length === 0 ? (
        <SectionEmpty>
          {loading && !hydrated
            ? 'loading…'
            : error
              ? 'scheduler unavailable'
              : 'nothing scheduled'}
        </SectionEmpty>
      ) : (
        <div className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 py-2">
          {enabled.map((g) => {
            const next = nextRuns[g.id]
            return (
              <div key={g.id} className="flex items-center gap-1.5">
                <span className="bg-success h-1.5 w-1.5 shrink-0 rounded-full" />
                <span className="text-text-primary flex-1 truncate font-mono text-xs">
                  {g.name || g.id}
                </span>
                <span
                  className="text-text-faint shrink-0 font-mono text-xs"
                  title={next > 0 ? 'Next scheduled run' : 'Runs on an event, not a clock'}
                >
                  {next > 0 ? untilMs(next) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
