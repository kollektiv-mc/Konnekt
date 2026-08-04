import './scheduler.css'
import { useScheduler } from './useScheduler'
import { SchedulerSummary } from './SchedulerSummary'
import { GraphEditor } from './editor/GraphEditor'
import type { TileProps } from '../../types'

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
    <GraphEditor
      graphs={graphs}
      blockDefs={blockDefs}
      onSave={saveGraph}
      onDelete={deleteGraph}
      onSetEnabled={setEnabled}
      onRun={runGraph}
      onPreviewNode={previewNode}
    />
  )
}
