import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useInstallStore } from '../../stores/useInstallStore'
import { useLoaderStore } from '../../stores/useLoaderStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useUiStore } from '../../stores/useUiStore'
import { ServerManager } from './index'
import { NEW_SERVER } from './ServerList'
import type { ServerConfig } from '../../types'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

function cfg(id: string, over: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id,
    name: id,
    jarPath: '',
    jvmArgs: ['-Xms512M', '-Xmx2G'],
    workingDir: `/srv/${id}`,
    mcVersion: '1.21.1',
    loader: 'neoforge',
    loaderVersion: '',
    ...over,
  }
}

const summary = (over: Partial<Awaited<ReturnType<typeof App.GetServerSummary>>> = {}) =>
  ({
    mcVersion: '1.21.1',
    loader: 'neoforge',
    workingDir: '/srv/alpha',
    launchFile: 'run.sh',
    running: false,
    loaderVersion: '21.1.72',
    loaderSource: 'script',
    ...over,
  }) as Awaited<ReturnType<typeof App.GetServerSummary>>

function renderManager({ open = true, selection = 'alpha' } = {}) {
  useUiStore.setState({ serverManagerOpen: open, serverManagerSelection: selection })
  return render(<ServerManager />)
}

describe('ServerManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetServerSummary).mockResolvedValue(summary())
    vi.mocked(App.SaveServerConfig).mockResolvedValue(undefined)
    useServerConfigStore.setState({
      configs: [cfg('alpha'), cfg('beta', { name: 'beta', loader: 'paper' })],
      activeId: 'alpha',
      error: null,
    })
    useInstallStore.setState({ open: false, result: null })
    useLoaderStore.setState({ dialogOpen: false, status: null, versions: [] })
  })

  it('renders nothing when closed', () => {
    renderManager({ open: false })
    expect(screen.queryByText('Servers')).toBeNull()
  })

  it('lists every configured server', () => {
    renderManager()
    expect(screen.getByRole('button', { name: /alpha/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /beta/ })).toBeTruthy()
  })

  // The build, and where it was read from, is the whole point of the panel:
  // it is the number the user needs before touching a mod update.
  it('shows the detected loader build and its provenance', async () => {
    renderManager()
    await waitFor(() => expect(screen.getByText(/21\.1\.72/)).toBeTruthy())
    expect(screen.getByText(/from the launcher script/)).toBeTruthy()
  })

  it('marks a stored build as not a live reading', async () => {
    vi.mocked(App.GetServerSummary).mockResolvedValue(
      summary({ loaderVersion: '21.1.9', loaderSource: 'config' }),
    )
    renderManager()
    await waitFor(() => expect(screen.getByText(/21\.1\.9/)).toBeTruthy())
    expect(screen.getByText(/install not readable/)).toBeTruthy()
  })

  it('switching servers in the list re-seeds the editor', async () => {
    renderManager()
    await waitFor(() => expect(screen.getByDisplayValue('/srv/alpha')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /beta/ }))

    await waitFor(() => expect(screen.getByDisplayValue('/srv/beta')).toBeTruthy())
  })

  it('saves an edit through the store', async () => {
    renderManager()
    const name = await screen.findByDisplayValue('alpha')
    fireEvent.change(name, { target: { value: 'renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(App.SaveServerConfig).toHaveBeenCalledTimes(1))
    expect(vi.mocked(App.SaveServerConfig).mock.calls[0][0]).toMatchObject({
      id: 'alpha',
      name: 'renamed',
      workingDir: '/srv/alpha',
    })
  })

  // The editor holds the only copy of the working directory and the JVM args,
  // so a refused write must not look like it landed.
  it('keeps the editor open and shows the message when a save is refused', async () => {
    Object.assign(window, { go: {} }) // hasWailsBridge(): a real backend refusal
    vi.mocked(App.SaveServerConfig).mockRejectedValue('disk is read-only')
    renderManager()

    const name = await screen.findByDisplayValue('alpha')
    fireEvent.change(name, { target: { value: 'renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('read-only'))
    expect(screen.getByDisplayValue('renamed')).toBeTruthy()
    delete (window as { go?: unknown }).go
  })

  it('will not save a new server without a name and a working directory', async () => {
    renderManager({ selection: NEW_SERVER })
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }))

    await waitFor(() => expect(App.SaveServerConfig).not.toHaveBeenCalled())
  })

  // The install reports the build it laid down; recording it here is what keeps
  // a fresh server from starting life with an unknown loader version.
  it('records a finished install, naming the server after its folder', async () => {
    useInstallStore.setState({
      result: {
        targetDir: '/srv/newsmp',
        mcVersion: '1.21.1',
        loader: 'neoforge',
        loaderVersion: '21.1.209',
      },
    })
    renderManager({ selection: NEW_SERVER })

    await waitFor(() => expect(screen.getByDisplayValue('/srv/newsmp')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }))

    await waitFor(() => expect(App.SaveServerConfig).toHaveBeenCalledTimes(1))
    expect(vi.mocked(App.SaveServerConfig).mock.calls[0][0]).toMatchObject({
      name: 'newsmp',
      workingDir: '/srv/newsmp',
      loader: 'neoforge',
      loaderVersion: '21.1.209',
      mcVersion: '1.21.1',
    })
  })
})
