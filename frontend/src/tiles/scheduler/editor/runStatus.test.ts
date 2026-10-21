import { describe, it, expect } from 'vitest'
import { runOutcome } from './runStatus'

describe('runOutcome', () => {
  // The toolbar keeps the two words; the reason is the bubble's.
  it('keeps a failure short, with its reason as the detail', () => {
    expect(
      runOutcome({ status: 'failed', error: 'destination validation failed: R2 is gone.' }),
    ).toEqual({
      text: 'run failed',
      failed: true,
      detail: 'destination validation failed: R2 is gone.',
    })
  })

  it('names a failure that carries no reason', () => {
    expect(runOutcome({ status: 'failed', error: '' })).toEqual({
      text: 'run failed',
      failed: true,
      detail: 'unknown error',
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
