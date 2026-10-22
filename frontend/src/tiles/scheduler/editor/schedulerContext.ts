import { createContext } from 'react'
import type { Edge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'

// Live per-node run state, driven by schedule:* events while a graph executes.
export type NodeRunState = 'running' | 'success' | 'failed'

export interface SchedulerCtxValue {
  blockDefs: Map<string, models.BlockDef>
  edges: Edge[]
  collapsed: Set<string>
  onToggleCollapse: (nodeId: string) => void
  // Live run highlighting (empty when no run is active).
  nodeRunState: Map<string, NodeRunState>
  // How long each node kept the server down in the last run, in ms, for the
  // nodes that report one (the Distant Horizons snapshot). Unlike the run state
  // it stays until the next run starts, so the figure outlives the highlight.
  nodeDowntimeMs: Map<string, number>
  // What each node could not finish after its work was done in the last run, for
  // the nodes that report one (the Publish DH Snapshot's prune). Kept until the
  // next run starts, like the downtime. The node still completed.
  nodeWarning: Map<string, string>
  firedEdges: Set<string>
  // Static analysis: node/edge ids that participate in a control-flow cycle.
  cycleNodes: Set<string>
  cycleEdges: Set<string>
  // The editor's undo recorder. A wire edits its own corner points through
  // React Flow's setEdges, so it snapshots the pre-edit graph through this
  // rather than the editor threading a handler into every edge.
  recordPre: (tag?: string | null) => void
  // The View menu's Curved connectors choice (#692). Read by every wire, which
  // is what lets it redraw them all without the edges array, the undo history or
  // the unsaved flag ever hearing about it.
  curvedEdges: boolean
}

export const SchedulerCtx = createContext<SchedulerCtxValue>({
  blockDefs: new Map(),
  edges: [],
  collapsed: new Set(),
  onToggleCollapse: () => {},
  nodeRunState: new Map(),
  nodeDowntimeMs: new Map(),
  nodeWarning: new Map(),
  firedEdges: new Set(),
  cycleNodes: new Set(),
  cycleEdges: new Set(),
  recordPre: () => {},
  curvedEdges: true,
})
