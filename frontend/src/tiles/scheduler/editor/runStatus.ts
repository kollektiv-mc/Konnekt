// What the toolbar says about a manual run. A failure stays until dismissed:
// a run can fail before any node starts (a destination check, a block's own
// setup), and then this line is the only place the reason shows.
export interface RunStatus {
  text: string
  failed: boolean
}

export const RUN_RUNNING: RunStatus = { text: 'running…', failed: false }

// The fields of a models.RunRecord this reads.
interface RunResult {
  status: string
  error?: string
  nodes?: readonly unknown[]
}

export function runOutcome(rec: RunResult): RunStatus {
  if (rec.status === 'skipped') return { text: 'already running', failed: false }
  if (rec.status === 'failed')
    return { text: `failed: ${rec.error || 'unknown error'}`, failed: true }
  return { text: `done (${rec.nodes?.length ?? 0} nodes)`, failed: false }
}
