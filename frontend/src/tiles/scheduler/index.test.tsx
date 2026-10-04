import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { useSchedulerStore } from '../../stores/useSchedulerStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useUiStore } from '../../stores/useUiStore'
import { ServerSelector } from '../../components/ServerSelector'
import type { ServerConfig } from '../../types'
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

function serverCfg(id: string): ServerConfig {
  return {
    id,
    name: id,
    jarPath: '',
    jvmArgs: [],
    workingDir: `/srv/${id}`,
    mcVersion: '1.21.1',
    loader: 'neoforge',
    loaderVersion: '',
  }
}

// Switching server remounts the maximized tile, which threw away an editor's
// unsaved graph without asking. The sidebar now asks the editor's own close
// guard first and only switches once the user has answered (#450). Both halves
// are real here, the sidebar and the editor, because the contract between them
// is what broke.
describe('switching server from the sidebar with the scheduler editor maximized', () => {
  async function renderDirty() {
    render(
      <>
        <ServerSelector />
        <SchedulerTile serverId="alpha" maximized />
      </>,
    )
    await waitFor(() => expect(selected()).toBe('Only'))
    fireEvent.click(screen.getByTitle('Click to rename'))
    const input = screen.getByDisplayValue('Only')
    fireEvent.change(input, { target: { value: 'Only, edited' } })
    // The dirty dot is on the label, which the input replaces while editing.
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTitle('Unsaved changes')).toBeTruthy())
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // These run long enough for a load's handle re-measure to fire while mounted,
    // and React Flow reads the viewport transform through a matrix jsdom lacks.
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        m22 = 1
      },
    )
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([graph('g1', 'Only')])
    vi.mocked(App.GetScheduleBlockDefs).mockResolvedValue([])
    vi.mocked(App.GetScheduleNextRuns).mockResolvedValue({})
    vi.mocked(App.GetServerConfigs).mockResolvedValue([serverCfg('alpha'), serverCfg('beta')])
    vi.mocked(App.GetActiveServerID).mockResolvedValue('alpha')
    vi.mocked(App.SetActiveServerID).mockResolvedValue(undefined)
    useServerConfigStore.setState({
      configs: [serverCfg('alpha'), serverCfg('beta')],
      activeId: 'alpha',
      error: null,
    })
    useUiStore.setState({ closeGuard: null })
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

  it('asks first, and switches only once the changes are discarded', async () => {
    await renderDirty()

    fireEvent.click(screen.getByRole('button', { name: /beta/ }))

    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(App.SetActiveServerID).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(App.SetActiveServerID).toHaveBeenCalledWith('beta')
  })

  it('leaves the active server and the edits alone on cancel', async () => {
    await renderDirty()

    fireEvent.click(screen.getByRole('button', { name: /beta/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(App.SetActiveServerID).not.toHaveBeenCalled()
    expect(useServerConfigStore.getState().activeId).toBe('alpha')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(screen.getByTitle('Unsaved changes')).toBeTruthy()
  })

  it('switches at once when the editor is clean', async () => {
    render(
      <>
        <ServerSelector />
        <SchedulerTile serverId="alpha" maximized />
      </>,
    )
    await waitFor(() => expect(selected()).toBe('Only'))

    fireEvent.click(screen.getByRole('button', { name: /beta/ }))

    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(App.SetActiveServerID).toHaveBeenCalledWith('beta')
  })
})
