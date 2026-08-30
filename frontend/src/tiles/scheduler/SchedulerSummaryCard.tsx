import type { TileProps } from '../../types'
import { SchedulerSummary } from './SchedulerSummary'
import { useScheduler } from './useScheduler'

/**
 * The registry's `summary` entry for the Scheduler tile.
 *
 * The cheapest summary in the roll-up: `useScheduler` is a lifecycle wrapper
 * over `useSchedulerStore`, so a second mount reads the state the first one
 * already hydrated rather than fetching again.
 */
export function SchedulerSummaryCard(_props: TileProps) {
  const { graphs, nextRuns, loading, hydrated, error } = useScheduler()
  return (
    <SchedulerSummary
      graphs={graphs}
      nextRuns={nextRuns}
      loading={loading && !hydrated}
      error={error}
    />
  )
}
