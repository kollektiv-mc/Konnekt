import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import type { models } from '../../../wailsjs/go/models'
import { useSchedulerStore } from '../../stores/useSchedulerStore'
import { useScheduler } from './useScheduler'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

function graph(id: string): models.Graph {
  return {
    id,
    name: id,
    enabled: true,
    nodes: [],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as models.Graph
}

// The hook owns lifecycle only — mount hydration and the schedule:next-runs
// subscription. Data behaviour is covered by useSchedulerStore.test.ts.
describe('useScheduler', () => {
  let handlers: Record<string, (...data: unknown[]) => void>
  let off: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    off = vi.fn()
    vi.mocked(EventsOn).mockImplementation((name: string, cb: (...data: unknown[]) => void) => {
      handlers[name] = cb
      return off
    })

    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([graph('g1')])
    vi.mocked(App.GetScheduleBlockDefs).mockResolvedValue([])
    vi.mocked(App.GetScheduleNextRuns).mockResolvedValue({ g1: 1000 })

    useSchedulerStore.setState({
      graphs: [],
      blockDefs: [],
      nextRuns: {},
      loading: false,
      hydrated: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hydrates the store on mount', async () => {
    const { result } = renderHook(() => useScheduler())
    await waitFor(() => expect(result.current.graphs).toEqual([graph('g1')]))
    expect(result.current.nextRuns).toEqual({ g1: 1000 })
    expect(App.GetScheduleGraphs).toHaveBeenCalledTimes(1)
  })

  // The tile is mounted twice while maximized (Dashboard renders the maximized
  // copy alongside the grid one) — both must share one hydration.
  it('hydrates once across two concurrent mounts', async () => {
    const a = renderHook(() => useScheduler())
    const b = renderHook(() => useScheduler())
    await waitFor(() => expect(a.result.current.graphs).toEqual([graph('g1')]))
    expect(b.result.current.graphs).toEqual([graph('g1')])
    expect(App.GetScheduleGraphs).toHaveBeenCalledTimes(1)
  })

  it('applies schedule:next-runs pushes', async () => {
    const { result } = renderHook(() => useScheduler())
    await waitFor(() => expect(result.current.graphs).toEqual([graph('g1')]))

    act(() => {
      handlers['schedule:next-runs']({ g1: 5000, g2: 9000 })
    })
    expect(result.current.nextRuns).toEqual({ g1: 5000, g2: 9000 })
  })

  it('unsubscribes on unmount', async () => {
    const { result, unmount } = renderHook(() => useScheduler())
    await waitFor(() => expect(result.current.graphs).toEqual([graph('g1')]))
    unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  // Regression guard on the removed 30s poll.
  it('never polls next-runs on a timer', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useScheduler())

    // waitFor polls via real setTimeout, which never fires under fake timers —
    // flush the mount effect's already-resolved Promise.all via microtasks.
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.nextRuns).toEqual({ g1: 1000 })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(App.GetScheduleNextRuns).toHaveBeenCalledTimes(1) // the mount fetch only
  })

  it('renders without a Wails bridge', async () => {
    vi.mocked(EventsOn).mockImplementation(() => {
      throw new Error('no runtime')
    })
    const { result, unmount } = renderHook(() => useScheduler())
    await waitFor(() => expect(result.current.graphs).toEqual([graph('g1')]))
    expect(() => unmount()).not.toThrow()
  })
})
