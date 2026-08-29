import { lazy, Suspense } from 'react'
import './scheduler.css'
import { useScheduler } from './useScheduler'
import { SchedulerSummary } from './SchedulerSummary'
import type { TileProps } from '../../types'

// @xyflow/react is ~370 KB of source and only the maximized editor renders it,
// so it loads on demand rather than on every launch. Warmed during idle by
// lib/prefetch.ts, which names this exact specifier.
const GraphEditor = lazy(() =>
  import('./editor/GraphEditor').then((m) => ({ default: m.GraphEditor })),
)

export function SchedulerTile({ maximized }: TileProps) {
  const {
    graphs,
    blockDefs,
    nextRuns,
    loading,
    hydrated,
    error,
    saveGraph,
    deleteGraph,
    setEnabled,
    runGraph,
    previewNode,
  } = useScheduler()

  if (!maximized) {
    return (
      <SchedulerSummary
        graphs={graphs}
        nextRuns={nextRuns}
        loading={loading && !hydrated}
        error={error}
      />
    )
  }

  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <GraphEditor
        graphs={graphs}
        blockDefs={blockDefs}
        onSave={saveGraph}
        onDelete={deleteGraph}
        onSetEnabled={setEnabled}
        onRun={runGraph}
        onPreviewNode={previewNode}
      />
    </Suspense>
  )
}
