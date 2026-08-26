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

const FORCE_ITEMS = JSON.stringify([
  { id: '1', label: 'Stop', kind: 'lifecycle', value: 'stop' },
  { id: '2', label: 'Force Stop', kind: 'lifecycle', value: 'force-stop' },
])

// #110's escape hatch. A graceful stop can now legitimately hold lifecycleBusy
// for the whole grace window, so force stop must stay clickable while every
// other lifecycle button is disabled — otherwise it cannot fire in the one
// situation it exists for.
describe('QuickCommandsPanel force stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetCommandButtons).mockResolvedValue(FORCE_ITEMS)
  })

  it('fires while a graceful stop is still in flight', async () => {
    let resolveStop!: () => void
    vi.mocked(App.StopServer).mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveStop = res
        }),
    )
    vi.mocked(App.ForceStopServer).mockResolvedValue(undefined)
    render(<QuickCommandsPanel serverId="srv1" />)

    const stop = (await screen.findByRole('button', { name: 'Stop' })) as HTMLButtonElement
    fireEvent.click(stop)
    expect(stop.disabled).toBe(true)

    // The wedged-case affordance appears, and the pinned Force Stop button
    // stays enabled while everything else is locked out.
    const pinned = screen.getByRole('button', { name: 'Force Stop' }) as HTMLButtonElement
    expect(pinned.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Force stop' }))

    // Always through the confirm dialog; its confirm is exempt from the busy
    // disable. Two "Force stop" buttons exist now (affordance + modal) — the
    // modal's renders last.
    const confirms = screen.getAllByRole('button', { name: 'Force stop' })
    const confirm = confirms[confirms.length - 1] as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(App.ForceStopServer).toHaveBeenCalledTimes(1))

    resolveStop()
    await waitFor(() => expect(screen.queryByText('Stopping…')).toBeNull())
    expect(stop.disabled).toBe(false)
  })

  it('always confirms, even with confirm-before-stop off', async () => {
    vi.mocked(App.ForceStopServer).mockResolvedValue(undefined)
    render(<QuickCommandsPanel serverId="srv1" />)

    // The store default is confirmBeforeStop: false, so a plain stop would
    // not confirm — force stop still must.
    fireEvent.click(await screen.findByRole('button', { name: 'Force Stop' }))
    expect(App.ForceStopServer).not.toHaveBeenCalled()
    expect(screen.getByText('Force stop server?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Force stop' }))
    await waitFor(() => expect(App.ForceStopServer).toHaveBeenCalledTimes(1))
  })

  it('surfaces a rejection in the alert area', async () => {
    vi.mocked(App.ForceStopServer).mockRejectedValue('force stop failed')
    render(<QuickCommandsPanel serverId="srv1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Force Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Force stop' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('force stop failed'),
    )
  })
})
