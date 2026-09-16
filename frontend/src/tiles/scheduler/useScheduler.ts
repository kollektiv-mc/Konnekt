import { useEffect } from 'react'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { useSchedulerStore } from '../../stores/useSchedulerStore'
import { EVENTS } from '../../lib/constants'

/**
 * Lifecycle wrapper around `useSchedulerStore`: hydrates on mount and keeps
 * next-run times fresh from the backend's `schedule:next-runs` push (the Go
 * ticker emits once a minute, and after every graph mutation), replacing the
 * former 30s `setInterval` poll.
 *
 * The store, not this hook, owns the state — the tile is mounted twice while
 * maximized, and both instances now share one copy.
 *
 * `hydrated` is reported for *this* server rather than read as a flag: the store
 * holds one server at a time, so a stale `true` from the previous server is the
 * difference between a loading tile and an empty one (#236).
 */
export function useScheduler(serverId: string) {
  // Per-field selectors so the per-minute nextRuns push doesn't re-render
  // consumers of the other fields.
  const graphs = useSchedulerStore((s) => s.graphs)
  const blockDefs = useSchedulerStore((s) => s.blockDefs)
  const nextRuns = useSchedulerStore((s) => s.nextRuns)
  const loading = useSchedulerStore((s) => s.loading)
  const hydratedFor = useSchedulerStore((s) => s.hydratedFor)
  const error = useSchedulerStore((s) => s.error)

  // Actions are passed through untouched — never wrap them in a local callback.
  // NodeDataPanel keeps `onPreview` in an effect dep array and GraphEditor keeps
  // the rest in useCallback deps, so a new identity per render would re-fire
  // those effects (a preview-IPC storm).
  const saveGraph = useSchedulerStore((s) => s.saveGraph)
  const deleteGraph = useSchedulerStore((s) => s.deleteGraph)
  const setEnabled = useSchedulerStore((s) => s.setEnabled)
  const runGraph = useSchedulerStore((s) => s.runGraph)
  const previewNode = useSchedulerStore((s) => s.previewNode)
  const clearError = useSchedulerStore((s) => s.clearError)

  useEffect(() => {
    // getState() rather than the selected actions, so the dep list stays honest.
    useSchedulerStore.getState().hydrate(serverId)

    let off: (() => void) | undefined
    try {
      off = EventsOn(EVENTS.SCHEDULE_NEXT_RUNS, (runs: Record<string, number>) => {
        useSchedulerStore.getState().setNextRuns(runs)
      })
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        off?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [serverId])

  return {
    graphs,
    blockDefs,
    nextRuns,
    loading,
    hydrated: hydratedFor === serverId,
    error,
    saveGraph,
    deleteGraph,
    setEnabled,
    runGraph,
    previewNode,
    clearError,
  }
}
