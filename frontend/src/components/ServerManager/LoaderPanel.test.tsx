import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useLoaderStore } from '../../stores/useLoaderStore'
import type { LoaderStatus, LoaderVersion } from '../../stores/useLoaderStore'
import { LoaderPanel } from './LoaderPanel'
import type { ServerConfig } from '../../types'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

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

const status = (over: Partial<LoaderStatus> = {}): LoaderStatus =>
  ({
    loader: 'neoforge',
    installedVersion: '21.1.72',
    mcVersion: '1.21.1',
    source: 'script',
    managed: true,
    reason: '',
    ...over,
  }) as LoaderStatus

const version = (v: string, over: Partial<LoaderVersion> = {}): LoaderVersion =>
  ({ version: v, mcVersion: '1.21.1', stable: true, latest: false, ...over }) as LoaderVersion

describe('LoaderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetLoaderStatus).mockResolvedValue(status())
    vi.mocked(App.ListLoaderVersions).mockResolvedValue([
      version('21.2.1-beta', { mcVersion: '1.21.2', stable: false }),
      version('21.1.209', { latest: true }),
      version('21.1.72'),
    ])
    vi.mocked(App.UpdateLoader).mockResolvedValue(undefined)
    useLoaderStore.setState({
      status: null,
      versions: [],
      loading: false,
      error: null,
      phase: 'idle',
      log: [],
      updateError: null,
      rolledBack: false,
    })
  })

  it('lists stable builds and marks the installed one', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)

    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
    expect(screen.getByText('installed')).toBeTruthy()
    expect(screen.getByText('latest')).toBeTruthy()
    // Betas are hidden until asked for.
    expect(screen.queryByText('21.2.1-beta')).toBeNull()
  })

  it('reveals betas on request', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: /betas/i }))

    await waitFor(() => expect(screen.getByText('21.2.1-beta')).toBeTruthy())
  })

  // An unmanaged loader shows the backend's reason in place of the list, rather
  // than an empty box the user cannot interpret.
  it('explains why an unmanaged loader has no controls', async () => {
    vi.mocked(App.GetLoaderStatus).mockResolvedValue(
      status({ managed: false, reason: 'Konnekt cannot update paper servers yet.' }),
    )
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)

    await waitFor(() =>
      expect(screen.getByText('Konnekt cannot update paper servers yet.')).toBeTruthy(),
    )
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  it('offers a retry when the version fetch fails', async () => {
    vi.mocked(App.ListLoaderVersions).mockRejectedValue('maven is unreachable')
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)

    await waitFor(() => expect(screen.getByText(/maven is unreachable/)).toBeTruthy())

    vi.mocked(App.ListLoaderVersions).mockResolvedValue([version('21.1.209')])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
  })

  // The dialog names the exact files the backend snapshots, so the warning and
  // the safety net cannot drift apart.
  it('names what the update rewrites before starting it', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    expect(screen.getByText('run.sh')).toBeTruthy()
    expect(screen.getByText('user_jvm_args.txt')).toBeTruthy()
    expect(screen.getByText(/puts them back if the install fails/)).toBeTruthy()
    // Nothing has been asked of the backend yet.
    expect(App.UpdateLoader).not.toHaveBeenCalled()
  })

  it('starts the update with the backup choice, defaulting to off', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() => expect(App.UpdateLoader).toHaveBeenCalledTimes(1))
    expect(App.UpdateLoader).toHaveBeenCalledWith({
      serverId: 'srv1',
      version: '21.1.209',
      fullBackup: false,
    })
  })

  it('opts into a full backup when asked', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    fireEvent.click(screen.getByRole('checkbox', { name: /Back up the whole server/ }))
    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() =>
      expect(App.UpdateLoader).toHaveBeenCalledWith(expect.objectContaining({ fullBackup: true })),
    )
  })

  // The outcome arrives as an event, not as the call's return value.
  it('shows the outcome once the event lands', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() => expect(useLoaderStore.getState().phase).toBe('running'))
    useLoaderStore.getState().finishUpdate()

    await waitFor(() => expect(screen.getByText(/Now on 21\.1\.209/)).toBeTruthy())
  })

  // Whether the rollback happened decides what the user has to do next, so the
  // dialog says which it was rather than only that it failed.
  it('says whether a failure rolled back', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() => expect(useLoaderStore.getState().phase).toBe('running'))
    useLoaderStore.getState().failUpdate('the installer exited 1', true)

    await waitFor(() => expect(screen.getByText('the installer exited 1')).toBeTruthy())
    expect(screen.getByText(/previous launch files were restored/)).toBeTruthy()
  })

  it('says when nothing was changed', async () => {
    render(<LoaderPanel config={cfg} onUpdated={() => {}} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: /Update to 21\.1\.209/ }))

    await waitFor(() => expect(useLoaderStore.getState().phase).toBe('running'))
    useLoaderStore.getState().failUpdate('the download is not a NeoForge installer', false)

    await waitFor(() => expect(screen.getByText(/Nothing was changed/)).toBeTruthy())
  })
})
