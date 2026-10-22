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
  // The advice the backend gives about the graph as drawn (GraphWarning), by the
  // node each piece is about. Not run state: it follows the canvas, and is empty
  // for a graph with nothing to say.
  nodeAdvice: Map<string, string[]>
  // The error of each node that failed in the last run, by node id ('' where it
  // failed with no text). Kept until the next run starts, like the downtime, so
  // it outlives the red border that clears a couple of seconds after the run.
  nodeFailure: Map<string, string>
  firedEdges: Set<string>
  // Static analysis: node/edge ids that participate in a control-flow cycle.
  cycleNodes: Set<string>
  cycleEdges: Set<string>
}

export const SchedulerCtx = createContext<SchedulerCtxValue>({
  blockDefs: new Map(),
  edges: [],
  collapsed: new Set(),
  onToggleCollapse: () => {},
  nodeRunState: new Map(),
  nodeDowntimeMs: new Map(),
  nodeWarning: new Map(),
  nodeAdvice: new Map(),
  nodeFailure: new Map(),
  firedEdges: new Set(),
  cycleNodes: new Set(),
  cycleEdges: new Set(),
})
