import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useLoaderStore } from '../../stores/useLoaderStore'
import type { LoaderVersion } from '../../stores/useLoaderStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { LoaderUpdateDialog } from './LoaderUpdateDialog'
import type { ServerConfig } from '../../types'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

const version = (v: string, over: Partial<LoaderVersion> = {}): LoaderVersion =>
  ({ version: v, mcVersion: '1.21.1', stable: true, latest: false, ...over }) as LoaderVersion

const cfg: ServerConfig = {
  id: 'srv1',
  name: 'smp',
  jarPath: '',
  jvmArgs: [],
  workingDir: '/srv/smp',
  mcVersion: '1.21.1',
  loader: 'neoforge',
  loaderVersion: '21.1.72',
}

/** The store as a pending confirm leaves it. */
function pendingOn(target = '21.1.209') {
  useLoaderStore.setState({
    dialogOpen: true,
    pending: { serverId: 'srv1', from: '21.1.72', target: version(target), starting: false },
    startError: null,
    phase: 'idle',
    log: [],
    updateError: null,
    rolledBack: false,
    jobServerId: '',
    jobFrom: '',
    jobTarget: '',
  })
}

/** The store as a live update leaves it. */
function jobOn(over: Partial<ReturnType<typeof useLoaderStore.getState>> = {}) {
  useLoaderStore.setState({
    dialogOpen: true,
    pending: null,
    startError: null,
    phase: 'running',
    log: ['downloading…'],
    updateError: null,
    rolledBack: false,
    jobServerId: 'srv1',
    jobFrom: '21.1.72',
    jobTarget: '21.1.209',
    ...over,
  })
}

describe('LoaderUpdateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.UpdateLoader).mockResolvedValue(undefined)
    useServerConfigStore.setState({ configs: [cfg], activeId: 'srv1', error: null })
    useLoaderStore.setState({ versions: [version('21.1.209'), version('21.1.100')] })
    pendingOn()
  })

  it('renders nothing with neither a job nor a selection', () => {
    useLoaderStore.setState({ pending: null, phase: 'idle', dialogOpen: true })
    const { container } = render(<LoaderUpdateDialog />)
    expect(container.firstChild).toBeNull()
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

  it('names the server from the config rather than a stored copy', () => {
    render(<LoaderUpdateDialog />)
    expect(screen.getByText(/smp will move from/)).toBeTruthy()
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

  // The sidebar row exists because a job exists, so opening it must land on
  // that job whatever the panel was last clicked on.
  it('a running job outranks a version picked afterwards', () => {
    jobOn()
    useLoaderStore.setState({
      pending: { serverId: 'srv1', from: '21.1.72', target: version('21.1.100'), starting: false },
    })
    render(<LoaderUpdateDialog />)

    expect(screen.getByText(/smp is updating from/)).toBeTruthy()
    expect(screen.getByText('21.1.209')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Update to 21\.1\.100/ })).toBeNull()
  })

  // A refusal is an attempt, not an outcome: it sits beside the live job
  // instead of replacing it.
  it('shows a refused start as a notice beside the running job', () => {
    jobOn({ startError: 'a loader update is already running' })
    render(<LoaderUpdateDialog />)

    expect(screen.getByText(/Could not start another update/)).toBeTruthy()
    expect(screen.getByText(/a loader update is already running/)).toBeTruthy()
    // Still the running job, not a failure.
    expect(screen.getByText(/smp is updating from/)).toBeTruthy()
    expect(screen.getByText('downloading…')).toBeTruthy()
  })

  // The reported bug from the round before: the dialog said closing was free
  // while the button that would have done it was disabled.
  it('lets you close while the update is running', () => {
    jobOn()
    render(<LoaderUpdateDialog />)

    const close = screen.getByRole('button', { name: 'Close' })
    expect((close as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(close)

    const s = useLoaderStore.getState()
    expect(s.dialogOpen).toBe(false)
    expect(s.phase).toBe('running')
    expect(s.log).toEqual(['downloading…'])
  })

  it('says so, rather than claiming the update stops', () => {
    jobOn()
    render(<LoaderUpdateDialog />)
    expect(screen.getByText(/Closing this does not stop it/)).toBeTruthy()
  })

  it('still shows the outcome when reopened', () => {
    jobOn({ phase: 'failed', updateError: 'the installer exited 1', rolledBack: true })
    const { unmount } = render(<LoaderUpdateDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    unmount()

    useLoaderStore.getState().showDialog()
    render(<LoaderUpdateDialog />)

    expect(screen.getByText('the installer exited 1')).toBeTruthy()
    expect(screen.getByText(/previous launch files were restored/)).toBeTruthy()
  })

  it('reports the version that ran', () => {
    jobOn({ phase: 'done' })
    render(<LoaderUpdateDialog />)
    expect(screen.getByText(/Now on 21\.1\.209/)).toBeTruthy()
  })

  it('says when nothing was changed', () => {
    jobOn({
      phase: 'failed',
      updateError: 'the download is not a NeoForge installer',
      rolledBack: false,
    })
    render(<LoaderUpdateDialog />)
    expect(screen.getByText(/Nothing was changed/)).toBeTruthy()
  })

  // Retrying turns the failed job back into a confirm for the same build.
  it('offers a retry that goes through the confirm again', () => {
    jobOn({ phase: 'failed', updateError: 'the installer exited 1', rolledBack: true })
    render(<LoaderUpdateDialog />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    const s = useLoaderStore.getState()
    expect(s.phase).toBe('idle')
    expect(s.pending?.target.version).toBe('21.1.209')
  })

  it('omits the retry when the build is no longer in the list', () => {
    useLoaderStore.setState({ versions: [] })
    jobOn({ phase: 'failed', updateError: 'the installer exited 1', rolledBack: false })
    render(<LoaderUpdateDialog />)

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
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
