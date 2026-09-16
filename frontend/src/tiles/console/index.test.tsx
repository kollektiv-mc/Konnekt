import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useServerStore } from '../../stores/useServerStore'
import { useConsoleStore } from '../../stores/useConsoleStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { ServerStatus } from '../../types'
import { ConsoleTile } from './index'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

const OFFLINE: ServerStatus = {
  running: false,
  state: 'offline',
  uptime: '0s',
  players: 0,
  maxPlayers: 20,
  tps: 0,
  ramUsed: 0,
  ramTotal: 2048,
}
const ONLINE: ServerStatus = {
  ...OFFLINE,
  running: true,
  state: 'running',
  uptime: '1m 0s',
  tps: 20,
}

const sendButton = () => screen.getByRole('button', { name: 'Send' })
const commandInput = () => screen.getByLabelText('Server command') as HTMLInputElement

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

// With no lines this tile used to render an empty <div>: an unreachable server,
// a stopped one and a server that had simply not logged yet were the same blank
// panel, and the command input stayed enabled with failures going to
// console.error (agent_docs/HEALTH_CHECKLIST.md's ErrorBoundary item;
// HEALTH_LOG.md 2026-08-20). The checklist assumed verifying this needed a GUI.
// It does not — jsdom is enough.
describe('ConsoleTile offline state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.SendCommand).mockResolvedValue(undefined)
    useConsoleStore.setState({ lines: [] })
    useServerStore.setState({ status: OFFLINE, reachable: true })
  })

  it('says the server is offline instead of rendering a blank panel', () => {
    render(<ConsoleTile serverId="srv1" />)
    expect(screen.getByText('Server offline — start it to see output.')).toBeTruthy()
  })

  it('distinguishes an unreachable backend from a stopped server', () => {
    useServerStore.setState({ status: OFFLINE, reachable: false })
    render(<ConsoleTile serverId="srv1" />)
    expect(screen.getByText('Server unreachable — no output.')).toBeTruthy()
  })

  it('says it is waiting when the server is up but has not logged yet', () => {
    useServerStore.setState({ status: ONLINE, reachable: true })
    render(<ConsoleTile serverId="srv1" />)
    expect(screen.getByText('Waiting for output…')).toBeTruthy()
  })

  it('disables the command input and Send while the server is down', () => {
    render(<ConsoleTile serverId="srv1" />)
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true)
    expect(commandInput().disabled).toBe(true)
  })

  it('enables them once the server is running', () => {
    useServerStore.setState({ status: ONLINE, reachable: true })
    render(<ConsoleTile serverId="srv1" />)
    expect((sendButton() as HTMLButtonElement).disabled).toBe(false)
    expect(commandInput().disabled).toBe(false)
  })

  it('never calls SendCommand while the server is down', () => {
    render(<ConsoleTile serverId="srv1" />)
    fireEvent.change(commandInput(), { target: { value: 'list' } })
    fireEvent.click(sendButton())
    expect(App.SendCommand).not.toHaveBeenCalled()
  })
})

describe('ConsoleTile command failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.SendCommand).mockResolvedValue(undefined)
    useConsoleStore.setState({ lines: [] })
    useServerStore.setState({ status: ONLINE, reachable: true })
  })

  it('sends the command and clears the input on success', async () => {
    render(<ConsoleTile serverId="srv1" />)
    fireEvent.change(commandInput(), { target: { value: 'list' } })
    fireEvent.click(sendButton())

    expect(App.SendCommand).toHaveBeenCalledWith('srv1', 'list')
    await waitFor(() => expect(commandInput().value).toBe(''))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Used to disappear into `.catch(console.error)`, so a rejected command looked
  // exactly like one the server accepted and did not reply to.
  it('shows the failure and restores the command for a retry', async () => {
    vi.mocked(App.SendCommand).mockRejectedValue(new Error('rcon closed'))
    render(<ConsoleTile serverId="srv1" />)
    fireEvent.change(commandInput(), { target: { value: 'stop' } })
    fireEvent.click(sendButton())

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('rcon closed'))
    expect(commandInput().value).toBe('stop')
  })
})

// #113: Konnekt's own narration has to read apart from server output, and the
// level filter is a *server log level* filter, so manager lines belong under
// All rather than being swept into Warn or Error. The narration is now boxed
// with a status dot rather than tinted, and carries no "[Konnekt] " tag: the
// block says who is speaking and the dot says how it went.
describe('ConsoleTile manager lines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useServerStore.setState({ status: ONLINE, reachable: true })
    useConsoleStore.setState({ lines: [] })
    useConsoleStore.getState().batchAppend([
      {
        timestamp: '12:00:00',
        line: 'Backing up the server',
        source: 'manager',
        outcome: 'progress',
      },
      { timestamp: '12:00:01', line: '[12:00:01] [Server thread/ERROR]: boom' },
    ])
  })

  // highlightQuery wraps the text in its own span, so the styling sits on the
  // parent; the manager block is one level up again from that.
  const managerBlock = (text: string) =>
    screen.getByText(text).parentElement?.parentElement as HTMLElement

  it('boxes a manager line instead of tinting it like a server level', () => {
    render(<ConsoleTile serverId="srv1" />)

    const block = managerBlock('Backing up the server')
    expect(block.className).toContain('border-hairline')
    expect(block.className).toContain('rounded-md')

    const serverLine = screen.getByText('[12:00:01] [Server thread/ERROR]: boom').parentElement
    expect(serverLine?.className).toContain('text-red-400')
    expect(serverLine?.className).not.toContain('border-hairline')
  })

  // The dot is the only thing naming the outcome, so it has to be reachable to
  // a screen reader rather than decorative.
  it('names the outcome on the status dot', () => {
    render(<ConsoleTile serverId="srv1" />)
    expect(screen.getByRole('img', { name: 'Konnekt, in progress' })).toBeTruthy()
  })

  it('paints the dot and outline per outcome', () => {
    useConsoleStore.setState({ lines: [] })
    useConsoleStore.getState().batchAppend([
      { timestamp: '12:00:00', line: 'Backup finished', source: 'manager', outcome: 'ok' },
      { timestamp: '12:00:01', line: 'Backup failed', source: 'manager', outcome: 'failed' },
    ])
    render(<ConsoleTile serverId="srv1" />)

    expect(managerBlock('Backup finished').className).toContain('border-success/40')
    expect(screen.getByRole('img', { name: 'Konnekt, finished' }).className).toContain('bg-success')

    expect(managerBlock('Backup failed').className).toContain('border-danger/40')
    expect(screen.getByRole('img', { name: 'Konnekt, failed' }).className).toContain('bg-danger')
  })

  it('keeps manager lines out of the server level filters', () => {
    render(<ConsoleTile serverId="srv1" />)
    fireEvent.click(screen.getByText('All'))
    fireEvent.click(screen.getByRole('button', { name: 'Error' }))

    expect(screen.getByText('[12:00:01] [Server thread/ERROR]: boom')).toBeTruthy()
    expect(screen.queryByText('Backing up the server')).toBeNull()
  })
})

// #166. Two separate faults in the quick-commands toggle, and the second one is
// not really about the toggle at all.
//
// jsdom has no ResizeObserver and no layout, so both halves are driven rather
// than measured: the stub below hands back the callback *and* the element the
// component asked it to observe, which is what lets the assertions name the
// real pane without a selector that would drift with the markup. `scrollTop`
// is a plain settable property here and jsdom never clamps it, so the pin is
// exactly observable; `scrollHeight` and `clientHeight` read 0 until defined.
class StubResizeObserver {
  /** Runs the callback the component registered, as a resize would. */
  static fire: (() => void) | null = null
  /** The element the component asked to observe. */
  static target: HTMLElement | null = null

  constructor(cb: () => void) {
    StubResizeObserver.fire = () => cb()
  }
  observe(el: Element) {
    StubResizeObserver.target = el as HTMLElement
  }
  disconnect() {}
}

/** Give an element the geometry jsdom will not compute for it. */
const setGeometry = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('ConsoleTile tail anchoring across geometry changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', StubResizeObserver)
    StubResizeObserver.fire = null
    StubResizeObserver.target = null
    useServerStore.setState({ status: ONLINE, reachable: true })
    useConsoleStore.setState({ lines: [] })
    useConsoleStore
      .getState()
      .batchAppend([{ timestamp: '12:00:00', line: '[12:00:00] [Server thread/INFO]: Done' }])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const renderAndGetPane = () => {
    render(<ConsoleTile serverId="srv1" />)
    const pane = StubResizeObserver.target
    expect(pane).not.toBeNull()
    return pane as HTMLElement
  }

  // The failure this fixes: collapsing the rail, resizing the tile or resizing
  // the window reflows the wrapped rows, the browser keeps scrollTop, and the
  // pane silently stops following the log.
  it('re-pins to the bottom when the pane resizes while following', () => {
    const pane = renderAndGetPane()
    setGeometry(pane, 5000, 400)
    pane.scrollTop = 0

    StubResizeObserver.fire?.()

    expect(pane.scrollTop).toBe(5000)
  })

  // The other half of not losing the user's place: a reader who has scrolled
  // up is not yanked back by a resize they did not ask for.
  it('leaves the pane alone when the user has scrolled away from the tail', () => {
    const pane = renderAndGetPane()
    setGeometry(pane, 5000, 400)
    pane.scrollTop = 1000
    fireEvent.scroll(pane)

    StubResizeObserver.fire?.()

    expect(pane.scrollTop).toBe(1000)
  })

  // Scrolling back to the bottom re-arms it, so the anchoring follows again.
  it('resumes re-pinning once the user returns to the tail', () => {
    const pane = renderAndGetPane()
    setGeometry(pane, 5000, 400)
    pane.scrollTop = 1000
    fireEvent.scroll(pane)
    pane.scrollTop = 4600
    fireEvent.scroll(pane)
    pane.scrollTop = 0

    StubResizeObserver.fire?.()

    expect(pane.scrollTop).toBe(5000)
  })

  // The guard that keeps this renderable where ResizeObserver does not exist.
  it('renders without a ResizeObserver at all', () => {
    vi.unstubAllGlobals()
    expect(() => render(<ConsoleTile serverId="srv1" />)).not.toThrow()
  })
})

// The control that closes the rail was a bare glyph with no box, against the
// full-height strip that opens it: easy to open, hard to close.
describe('ConsoleTile quick-commands toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', StubResizeObserver)
    useServerStore.setState({ status: ONLINE, reachable: true })
    useConsoleStore.setState({ lines: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const setCollapsed = (collapsed: boolean) =>
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, consoleQuickCommandsCollapsed: collapsed },
    }))

  it('gives the close control the shared 24px box', () => {
    setCollapsed(false)
    render(<ConsoleTile serverId="srv1" maximized />)

    const close = screen.getByRole('button', { name: 'Hide quick commands' })
    expect(close.className).toContain('h-6')
    expect(close.className).toContain('w-6')
  })

  it('names the control that reopens the rail', () => {
    setCollapsed(true)
    render(<ConsoleTile serverId="srv1" maximized />)

    expect(screen.getByRole('button', { name: 'Show quick commands' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide quick commands' })).toBeNull()
  })
})
