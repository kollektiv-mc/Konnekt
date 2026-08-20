import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useServerStore } from '../../stores/useServerStore'
import { useConsoleStore } from '../../stores/useConsoleStore'
import type { ServerStatus } from '../../types'
import { ConsoleTile } from './index'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

const OFFLINE: ServerStatus = {
  running: false,
  uptime: '0s',
  players: 0,
  maxPlayers: 20,
  tps: 0,
  ramUsed: 0,
  ramTotal: 2048,
}
const ONLINE: ServerStatus = { ...OFFLINE, running: true, uptime: '1m 0s', tps: 20 }

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
