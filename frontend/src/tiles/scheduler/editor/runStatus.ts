// What the toolbar says about a manual run. A failure stays until clicked: a
// run can fail before any node starts (a destination check, a block's own
// setup), and then nothing else on screen says why. The toolbar has room for
// two words beside the graph controls, so a failure is `run failed` there and
// its reason, which can run to a sentence of S3 error, is `detail`, for the
// bubble (lib/toast.ts) that clicking it opens.
export interface RunStatus {
  text: string
  failed: boolean
  detail?: string
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
    return { text: 'run failed', failed: true, detail: rec.error || 'unknown error' }
  return { text: `done (${rec.nodes?.length ?? 0} nodes)`, failed: false }
}
