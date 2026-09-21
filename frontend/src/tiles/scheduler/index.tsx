import { lazy, Suspense } from 'react'
import './scheduler.css'
import { useScheduler } from './useScheduler'
import { SchedulerSummary } from './SchedulerSummary'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { TileProps } from '../../types'

// @xyflow/react is ~370 KB of source and only the maximized editor renders it,
// so it loads on demand rather than on every launch. Warmed during idle by
// lib/prefetch.ts, which names this exact specifier.
const GraphEditor = lazy(() =>
  import('./editor/GraphEditor').then((m) => ({ default: m.GraphEditor })),
)

// Behind the "Classic tile faces" setting, so it loads only when asked for.
// The specifier matches `lib/prefetch.ts`'s warm list and every other tile's.
const ClassicSchedulerSummary = lazy(() =>
  import('../classicFaces').then((m) => ({ default: m.ClassicSchedulerSummary })),
)

export function SchedulerTile({ serverId, maximized, layout }: TileProps) {
  const classic = useSettingsStore((s) => s.settings.classicTileFaces)
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
  } = useScheduler(serverId)

  if (!maximized) {
    if (classic) {
      return (
        <Suspense fallback={<div className="h-full w-full" />}>
          <ClassicSchedulerSummary
            graphs={graphs}
            nextRuns={nextRuns}
            loading={loading && !hydrated}
            error={error}
          />
        </Suspense>
      )
    }
    return (
      <SchedulerSummary
        graphs={graphs}
        nextRuns={nextRuns}
        loading={loading && !hydrated}
        error={error}
        layout={layout}
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
