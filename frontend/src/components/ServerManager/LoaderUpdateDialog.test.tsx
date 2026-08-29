import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useLoaderStore } from '../../stores/useLoaderStore'
import type { LoaderVersion } from '../../stores/useLoaderStore'
import { LoaderUpdateDialog } from './LoaderUpdateDialog'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

const target = {
  version: '21.1.209',
  mcVersion: '1.21.1',
  stable: true,
  latest: true,
} as LoaderVersion

function openOn(over: Partial<ReturnType<typeof useLoaderStore.getState>> = {}) {
  useLoaderStore.setState({
    dialogOpen: true,
    serverId: 'srv1',
    serverName: 'smp',
    from: '21.1.72',
    target,
    phase: 'idle',
    log: [],
    updateError: null,
    rolledBack: false,
    ...over,
  })
}

describe('LoaderUpdateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.UpdateLoader).mockResolvedValue(undefined)
    openOn()
  })

  // The dialog names the exact files the backend snapshots, so the warning and
  // the safety net cannot drift apart.
  it('names what the update rewrites before starting it', () => {
    render(<LoaderUpdateDialog />)

    expect(screen.getByText('run.sh')).toBeTruthy()
    expect(screen.getByText('user_jvm_args.txt')).toBeTruthy()
    expect(screen.getByText(/puts them back if the install fails/)).toBeTruthy()
    expect(App.UpdateLoader).not.toHaveBeenCalled()
  })

  it('starts the update with the backup choice, defaulting to off', async () => {
    render(<LoaderUpdateDialog />)

    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() => expect(App.UpdateLoader).toHaveBeenCalledTimes(1))
    expect(App.UpdateLoader).toHaveBeenCalledWith({
      serverId: 'srv1',
      version: '21.1.209',
      fullBackup: false,
    })
  })

  it('opts into a full backup when asked', async () => {
    render(<LoaderUpdateDialog />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Back up the whole server/ }))
    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() =>
      expect(App.UpdateLoader).toHaveBeenCalledWith(expect.objectContaining({ fullBackup: true })),
    )
  })

  // The reported bug: the dialog said closing was free while the button that
  // would have done it was disabled.
  it('lets you close while the update is running', () => {
    openOn({ phase: 'running', log: ['downloading…'] })
    render(<LoaderUpdateDialog />)

    const close = screen.getByRole('button', { name: 'Close' })
    expect((close as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(close)

    // Hidden, not reset — the run is still going and the row reopens it.
    const s = useLoaderStore.getState()
    expect(s.dialogOpen).toBe(false)
    expect(s.phase).toBe('running')
    expect(s.log).toEqual(['downloading…'])
  })

  it('says so, rather than claiming the update stops', () => {
    openOn({ phase: 'running' })
    render(<LoaderUpdateDialog />)
    expect(screen.getByText(/Closing this does not stop it/)).toBeTruthy()
  })

  // Reopening after a failure is the whole reason close must not reset.
  it('still shows the outcome when reopened', () => {
    openOn({ phase: 'failed', updateError: 'the installer exited 1', rolledBack: true })
    const { unmount } = render(<LoaderUpdateDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    unmount()

    useLoaderStore.getState().showDialog()
    render(<LoaderUpdateDialog />)

    expect(screen.getByText('the installer exited 1')).toBeTruthy()
    expect(screen.getByText(/previous launch files were restored/)).toBeTruthy()
  })

  it('shows the outcome once the event lands', () => {
    openOn({ phase: 'done' })
    render(<LoaderUpdateDialog />)
    expect(screen.getByText(/Now on 21\.1\.209/)).toBeTruthy()
  })

  it('says when nothing was changed', () => {
    openOn({
      phase: 'failed',
      updateError: 'the download is not a NeoForge installer',
      rolledBack: false,
    })
    render(<LoaderUpdateDialog />)
    expect(screen.getByText(/Nothing was changed/)).toBeTruthy()
  })

  it('surfaces a refusal the backend returned straight away', async () => {
    Object.assign(window, { go: {} }) // hasWailsBridge(): a real backend refusal
    vi.mocked(App.UpdateLoader).mockRejectedValue('stop the server before updating its loader')
    render(<LoaderUpdateDialog />)

    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() => expect(screen.getByText(/stop the server/)).toBeTruthy())
    delete (window as { go?: unknown }).go
  })
})
