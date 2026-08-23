import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { QuickCommandsPanel } from './QuickCommandsPanel'

vi.mock('../../wailsjs/go/main/App')

const LIFECYCLE_ITEMS = JSON.stringify([
  { id: '1', label: 'Start', kind: 'lifecycle', value: 'start' },
  { id: '2', label: 'Stop', kind: 'lifecycle', value: 'stop' },
  { id: '3', label: 'Restart', kind: 'lifecycle', value: 'restart' },
])

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

// The other half of #109's backend gate. A rejected power action used to
// vanish into `.catch(console.error)`, so the gate's "another power action is
// in progress" message would never have reached the user, and an undisabled
// button let a double click race the backend at all.
describe('QuickCommandsPanel power actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetCommandButtons).mockResolvedValue(LIFECYCLE_ITEMS)
  })

  it('shows a rejected power action verbatim', async () => {
    // Wails rejects with plain strings as often as with Errors.
    vi.mocked(App.StopServer).mockRejectedValue('another power action is in progress')
    render(<QuickCommandsPanel serverId="srv1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'another power action is in progress',
      ),
    )
  })

  it('double-clicking a power button produces one action', async () => {
    let resolveStart!: () => void
    vi.mocked(App.StartServer).mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveStart = res
        }),
    )
    render(<QuickCommandsPanel serverId="srv1" />)

    const start = (await screen.findByRole('button', { name: 'Start' })) as HTMLButtonElement
    fireEvent.click(start)
    fireEvent.click(start)

    expect(App.StartServer).toHaveBeenCalledTimes(1)
    expect(start.disabled).toBe(true)

    resolveStart()
    await waitFor(() => expect(start.disabled).toBe(false))
  })

  it('clears the previous error when the next action starts', async () => {
    vi.mocked(App.StopServer).mockRejectedValue('another power action is in progress')
    vi.mocked(App.StartServer).mockResolvedValue(undefined)
    render(<QuickCommandsPanel serverId="srv1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
