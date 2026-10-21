import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { useSchedulerStore } from '../../stores/useSchedulerStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useUiStore } from '../../stores/useUiStore'
import { useNotificationsStore } from '../../stores/useNotificationsStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
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

  // An editor with nothing loaded used to compare its empty state against a
  // saved signature of '', which never matches, so a server with no graphs
  // asked to discard changes nobody made (#526).
  it('switches at once when the server has no graphs', async () => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([])
    render(
      <>
        <ServerSelector />
        <SchedulerTile serverId="alpha" maximized />
      </>,
    )
    await waitFor(() => expect(useSchedulerStore.getState().hydratedFor).toBe('alpha'))

    fireEvent.click(screen.getByRole('button', { name: /beta/ }))

    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(App.SetActiveServerID).toHaveBeenCalledWith('beta')
  })
})

// A graph that stops the server is warned about when RCON is not confirmed, and
// the warning sits beside Save without gating it. The backend decides what to
// say (scheduler_validate.go); the editor only asks when the set of stopping
// nodes changes, counts the answer in the toolbar and puts the text in a
// bubble, so the toolbar never grows or cuts a sentence (#629).
describe('the scheduler editor warns about a stop', () => {
  const toasts = () => useNotificationsStore.getState().toasts
  const warningButton = () => screen.queryByRole('button', { name: /^\d+ warnings?$/ })
  const RCON_WARNING = 'This graph stops the server, but RCON is not confirmed for it.'

  const commandDef = {
    id: 'action.command',
    category: 'action',
    label: 'Command',
    description: '',
    isTrigger: false,
    controlInputs: ['trigger'],
    controlOutputs: ['onComplete', 'onFailed'],
    dataInputs: [{ id: 'command', label: 'Command', type: 'string' }],
    dataOutputs: [{ id: 'command', label: 'Command sent', type: 'string' }],
    configSchema: [{ key: 'command', label: 'Command', type: 'command' }],
    source: 'native',
  } as unknown as models.BlockDef

  const withCommand = (command: string): models.Graph =>
    ({
      ...graph('g1', 'Only'),
      nodes: [{ id: 'n1', type: 'action.command', config: { command }, position: { x: 0, y: 0 } }],
    }) as unknown as models.Graph

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        m22 = 1
      },
    )
    vi.mocked(App.GetScheduleBlockDefs).mockResolvedValue([commandDef])
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
    useNotificationsStore.setState({ toasts: [], dismissedToasts: {} })
  })

  it('shows the answer beside Save and asks for the server it edits', async () => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([withCommand('__stop__')])
    vi.mocked(App.GetScheduleGraphWarnings).mockResolvedValue([RCON_WARNING])
    render(<SchedulerTile serverId="alpha" maximized />)

    await waitFor(() => expect(warningButton()).not.toBeNull())
    // The icon and the count, the words only for a screen reader.
    expect(warningButton()?.textContent).toBe('1')
    expect(toasts()).toEqual([
      expect.objectContaining({
        category: 'warnings',
        tone: 'warn',
        title: 'Scheduler warning',
        text: RCON_WARNING,
      }),
    ])
    expect(App.GetScheduleGraphWarnings).toHaveBeenCalledWith('alpha', expect.anything())
    // Never a gate: Save is still there and enabled.
    expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('reopens a dismissed bubble, and keeps it after close', async () => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([withCommand('__stop__')])
    vi.mocked(App.GetScheduleGraphWarnings).mockResolvedValue([RCON_WARNING])
    const { unmount } = render(<SchedulerTile serverId="alpha" maximized />)
    await waitFor(() => expect(toasts()).toHaveLength(1))

    act(() => useNotificationsStore.getState().dismissToast(toasts()[0].id))
    expect(toasts()).toEqual([])
    fireEvent.click(warningButton() as HTMLElement)
    expect(toasts()).toHaveLength(1)

    // Closing the scheduler leaves it up, and reopening counts no repeat.
    unmount()
    expect(toasts()).toHaveLength(1)
    render(<SchedulerTile serverId="alpha" maximized />)
    await waitFor(() => expect(warningButton()).not.toBeNull())
    expect(toasts()).toEqual([expect.objectContaining({ count: 1 })])
  })

  // The message that wrapped the toolbar to four lines. The toolbar keeps two
  // words; the reason is in the bubble, whole.
  it('shows a failed run as two words, with the reason in a bubble', async () => {
    const reason =
      'cannot read the previous snapshot from "Frangfurd DH": s3 GetObject dh/latest.json: ' +
      'status 403 RequestTimeTooSkewed: The difference between the request time and the ' +
      "server's time is too large."
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([withCommand('save-all')])
    vi.mocked(App.SaveScheduleGraph).mockImplementation(async (_id, g) => g)
    vi.mocked(App.RunScheduleGraphNow).mockResolvedValue({
      status: 'failed',
      error: reason,
      nodes: [],
    } as unknown as models.RunRecord)
    render(<SchedulerTile serverId="alpha" maximized />)
    await waitFor(() => expect(selected()).toBe('Only'))

    fireEvent.click(screen.getByRole('button', { name: 'run' }))
    const indicator = await screen.findByRole('button', { name: 'run failed' })
    expect(indicator.className).toContain('whitespace-nowrap')
    // The bubble itself is App's, raised from the run's event for every run.
    expect(toasts()).toEqual([])

    // Clicking it brings the reason back in that bubble and clears the toolbar.
    fireEvent.click(indicator)
    expect(toasts()).toEqual([
      expect.objectContaining({
        key: 'scheduler:run:g1',
        category: 'errors',
        title: 'Run failed: Only',
        text: reason,
      }),
    ])
    expect(screen.queryByRole('button', { name: 'run failed' })).toBeNull()
  })

  // The editor gates on the toggle itself rather than through lib/toast (see
  // GraphEditor.tsx), so it is held to the same rule here.
  it('raises no error bubble with errors turned off, until the indicator is clicked', async () => {
    const prev = useSettingsStore.getState().settings
    useSettingsStore.setState({ settings: { ...prev, toastsOff: { errors: true } } })
    try {
      vi.mocked(App.GetScheduleGraphs).mockResolvedValue([withCommand('save-all')])
      vi.mocked(App.SaveScheduleGraph).mockImplementation(async (_id, g) => g)
      vi.mocked(App.RunScheduleGraphNow).mockResolvedValue({
        status: 'failed',
        error: 'the reason',
        nodes: [],
      } as unknown as models.RunRecord)
      render(<SchedulerTile serverId="alpha" maximized />)
      await waitFor(() => expect(selected()).toBe('Only'))

      fireEvent.click(screen.getByRole('button', { name: 'run' }))
      const indicator = await screen.findByRole('button', { name: 'run failed' })
      expect(indicator.getAttribute('title')).toBe('the reason')
      expect(toasts()).toEqual([])

      fireEvent.click(indicator)
      expect(toasts()).toEqual([expect.objectContaining({ text: 'the reason' })])
    } finally {
      useSettingsStore.setState({ settings: prev })
    }
  })

  it('never asks about a graph with nothing that stops the server', async () => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([withCommand('save-all')])
    render(<SchedulerTile serverId="alpha" maximized />)
    await waitFor(() => expect(selected()).toBe('Only'))

    expect(App.GetScheduleGraphWarnings).not.toHaveBeenCalled()
    expect(warningButton()).toBeNull()
    expect(toasts()).toEqual([])
  })

  it('shows nothing when the backend has no warning', async () => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([withCommand('__restart__')])
    vi.mocked(App.GetScheduleGraphWarnings).mockResolvedValue([])
    render(<SchedulerTile serverId="alpha" maximized />)

    await waitFor(() => expect(App.GetScheduleGraphWarnings).toHaveBeenCalled())
    expect(warningButton()).toBeNull()
    expect(toasts()).toEqual([])
  })

  it('leaves no warning, and no banner, when the ask fails', async () => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([withCommand('__stop__')])
    vi.mocked(App.GetScheduleGraphWarnings).mockRejectedValue(new Error('no bridge'))
    render(<SchedulerTile serverId="alpha" maximized />)

    await waitFor(() => expect(App.GetScheduleGraphWarnings).toHaveBeenCalled())
    expect(warningButton()).toBeNull()
    expect(toasts()).toEqual([])
    expect(screen.queryByText('scheduler error')).toBeNull()
  })
})
