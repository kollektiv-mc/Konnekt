import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { useSchedulerStore } from '../../stores/useSchedulerStore'
import { SchedulerTile } from './index'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: vi.fn(() => () => {}) }))

// The first import of the editor chunk (React Flow) is what was eating waitFor's 1 s budget on a cold run.
beforeAll(async () => {
  await import('./editor/GraphEditor')
}, 30_000)

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// React Flow measures its viewport; jsdom has no ResizeObserver.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

function graph(id: string, name: string): models.Graph {
  return {
    id,
    name,
    enabled: false,
    nodes: [],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as models.Graph
}

const graphsByServer: Record<string, models.Graph[]> = {
  a: [graph('ga1', 'A first'), graph('ga2', 'A second')],
  b: [graph('gb1', 'B first')],
}

/** The graph selector's label: the name of the graph the editor holds. */
const selected = () => screen.getByText('☰').closest('button')?.textContent?.replace('☰', '')

// A server switch remounts the tile (Dashboard keys it `${tile.id}:${serverId}`),
// but the store outlives the remount. GraphEditor's auto-load effect runs before
// the tile's hydrate call, and used to latch the previous server's first graph
// under the new server's id, where save moved it across servers (#446, #429).
describe('the maximized scheduler across a server switch', () => {
  beforeEach(() => {
    vi.mocked(App.GetScheduleGraphs).mockImplementation(async (id: string) => graphsByServer[id])
    vi.mocked(App.GetScheduleBlockDefs).mockResolvedValue([])
    vi.mocked(App.GetScheduleNextRuns).mockResolvedValue({})
    useSchedulerStore.setState({
      serverId: '',
      graphs: [],
      blockDefs: [],
      nextRuns: {},
      loading: false,
      hydratedFor: null,
      error: null,
    })
  })

  it("loads the new server's first graph, not the previous server's", async () => {
    const { rerender } = render(<SchedulerTile key="scheduler:a" serverId="a" maximized />)
    await waitFor(() => expect(selected()).toBe('A first'))

    rerender(<SchedulerTile key="scheduler:b" serverId="b" maximized />)

    await waitFor(() => expect(selected()).toBe('B first'))
    expect(screen.queryByText('A first')).toBeNull()
  })

  it('holds nothing for a server with no graphs', async () => {
    graphsByServer.c = []
    const { rerender } = render(<SchedulerTile key="scheduler:a" serverId="a" maximized />)
    await waitFor(() => expect(selected()).toBe('A first'))

    rerender(<SchedulerTile key="scheduler:c" serverId="c" maximized />)

    await waitFor(() => expect(useSchedulerStore.getState().hydratedFor).toBe('c'))
    expect(selected()).toBe('— no graphs —')
    expect(screen.queryByText('A first')).toBeNull()
  })
})

// A load schedules a handle re-measure 220ms out, which reaches React Flow's
// requestAnimationFrame. Left running past unmount it fired once jsdom was torn
// down, as an unhandled ReferenceError that failed an unrelated CI run (#492).
describe('the scheduler editor on unmount', () => {
  beforeEach(() => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([graph('g1', 'Only')])
    vi.mocked(App.GetScheduleBlockDefs).mockResolvedValue([])
    vi.mocked(App.GetScheduleNextRuns).mockResolvedValue({})
    useSchedulerStore.setState({
      serverId: '',
      graphs: [],
      blockDefs: [],
      nextRuns: {},
      loading: false,
      hydratedFor: null,
      error: null,
    })
  })

  it('cancels the pending re-measure', async () => {
    const { unmount } = render(<SchedulerTile serverId="a" maximized />)
    await waitFor(() => expect(selected()).toBe('Only'))
    unmount()

    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(raf).not.toHaveBeenCalled()
  })
})
