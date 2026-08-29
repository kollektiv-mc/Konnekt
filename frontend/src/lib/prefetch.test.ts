import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { warmSequentially } from './prefetch'

// jsdom has no requestIdleCallback, so these exercise the setTimeout fallback
// inside whenIdle — which is also the path a WebView build without
// requestIdleCallback takes.

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('warmSequentially', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts the next chunk only once the previous one has settled', async () => {
    const first = deferred()
    const second = deferred()
    const started: string[] = []
    const stop = warmSequentially([
      () => {
        started.push('first')
        return first.promise
      },
      () => {
        started.push('second')
        return second.promise
      },
    ])

    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toEqual(['first'])

    // Still in flight — nothing else may start alongside it.
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toEqual(['first'])

    first.resolve()
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toEqual(['first', 'second'])
    stop()
  })

  it('holds off while the user is interacting', async () => {
    const started: string[] = []
    const stop = warmSequentially([
      () => {
        started.push('first')
        return Promise.resolve()
      },
    ])

    // A wheel event every 100ms never leaves a quiet window to warm in.
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new Event('wheel'))
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(started).toEqual([])

    // Once the interaction stops, the queue picks up again.
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toEqual(['first'])
    stop()
  })

  it('a rejected chunk does not stall the ones behind it', async () => {
    const started: string[] = []
    const stop = warmSequentially([
      () => {
        started.push('first')
        return Promise.reject(new Error('chunk 404'))
      },
      () => {
        started.push('second')
        return Promise.resolve()
      },
    ])

    await vi.advanceTimersByTimeAsync(2000)
    expect(started).toEqual(['first', 'second'])
    stop()
  })

  it('cancelling stops the queue and detaches its listeners', async () => {
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')

    const started: string[] = []
    const stop = warmSequentially([
      () => {
        started.push('first')
        return Promise.resolve()
      },
    ])
    stop()

    await vi.advanceTimersByTimeAsync(5000)
    expect(started).toEqual([])

    // Every listener it attached is one it took back off again.
    const attached = added.mock.calls.map(([name]) => name).sort()
    const detached = removed.mock.calls.map(([name]) => name).sort()
    expect(attached.length).toBeGreaterThan(0)
    expect(detached).toEqual(attached)

    added.mockRestore()
    removed.mockRestore()
  })

  it('detaches its listeners once the last chunk is warm', async () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    warmSequentially([() => Promise.resolve()])

    await vi.advanceTimersByTimeAsync(2000)
    expect(removed.mock.calls.map(([name]) => name).sort()).toEqual([
      'keydown',
      'pointerdown',
      'scroll',
      'wheel',
    ])
    removed.mockRestore()
  })
})
