import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { useSchedulerStore } from '../../stores/useSchedulerStore'
import { SchedulerTile } from './index'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: vi.fn(() => () => {}) }))

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The maximized tile renders GraphEditor through lazy() (see index.tsx), and
// transforming and evaluating React Flow for the first time is the one
// variable cost in the first waitFor: on a slow disk it alone exceeds the 1 s
// default. It is module loading, not the server switch under test, so the
// chunk is loaded first through the same specifier the lazy() uses and
// vitest's module cache then serves it instantly. What remains in the waitFor
// is React's own 300 ms Suspense fallback throttle, a constant.
beforeAll(async () => {
  await import('./editor/GraphEditor')
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
