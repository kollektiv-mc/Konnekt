import { describe, it, expect } from 'vitest'
import { runOutcome } from './runStatus'

describe('runOutcome', () => {
  it('keeps a failure, with its reason', () => {
    expect(
      runOutcome({ status: 'failed', error: 'destination validation failed: R2 is gone.' }),
    ).toEqual({ text: 'failed: destination validation failed: R2 is gone.', failed: true })
  })

  it('names a failure that carries no reason', () => {
    expect(runOutcome({ status: 'failed', error: '' })).toEqual({
      text: 'failed: unknown error',
      failed: true,
    })
  })

  it('reports a skipped run as already running', () => {
    expect(runOutcome({ status: 'skipped' })).toEqual({ text: 'already running', failed: false })
  })

  it('counts the nodes of a finished run', () => {
    expect(runOutcome({ status: 'success', nodes: [] })).toEqual({
      text: 'done (0 nodes)',
      failed: false,
    })
  })
})
