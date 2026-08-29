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
    useLoaderStore.setState({
      status: null,
      versions: [],
      loading: false,
      error: null,
      phase: 'idle',
      log: [],
      updateError: null,
      rolledBack: false,
      dialogOpen: false,
      target: null,
      serverId: '',
      serverName: '',
      from: '',
    })
  })

  it('lists stable builds and marks the installed one', async () => {
    render(<LoaderPanel config={cfg} />)

    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
    expect(screen.getByText('installed')).toBeTruthy()
    expect(screen.getByText('latest')).toBeTruthy()
    // Betas are hidden until asked for.
    expect(screen.queryByText('21.2.1-beta')).toBeNull()
  })

  it('reveals betas on request', async () => {
    render(<LoaderPanel config={cfg} />)
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
    render(<LoaderPanel config={cfg} />)

    await waitFor(() =>
      expect(screen.getByText('Konnekt cannot update paper servers yet.')).toBeTruthy(),
    )
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  it('offers a retry when the version fetch fails', async () => {
    vi.mocked(App.ListLoaderVersions).mockRejectedValue('maven is unreachable')
    render(<LoaderPanel config={cfg} />)

    await waitFor(() => expect(screen.getByText(/maven is unreachable/)).toBeTruthy())

    vi.mocked(App.ListLoaderVersions).mockResolvedValue([version('21.1.209')])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())
  })

  // The panel raises the update; App renders the dialog. That split is what
  // lets the dialog outlive both this panel and the manager around it.
  it('raises the update on the store rather than rendering a dialog', async () => {
    render(<LoaderPanel config={cfg} />)
    await waitFor(() => expect(screen.getByText('21.1.209')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    const s = useLoaderStore.getState()
    expect(s.dialogOpen).toBe(true)
    expect(s.target?.version).toBe('21.1.209')
    expect(s.from).toBe('21.1.72')
    expect(s.serverId).toBe('srv1')
    expect(s.serverName).toBe('smp')
    // Nothing has been asked of the backend yet — that is the dialog's job.
    expect(App.UpdateLoader).not.toHaveBeenCalled()
    expect(screen.queryByText(/Update to 21\.1\.209/)).toBeNull()
  })

  // A finished update changes which build is installed.
  it('re-reads the install when refreshKey changes', async () => {
    const { rerender } = render(<LoaderPanel config={cfg} refreshKey={1} />)
    await waitFor(() => expect(App.GetLoaderStatus).toHaveBeenCalledTimes(1))

    rerender(<LoaderPanel config={cfg} refreshKey={2} />)

    await waitFor(() => expect(App.GetLoaderStatus).toHaveBeenCalledTimes(2))
  })
})
