import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { ModsTile } from './index'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { isRemoteBrowser } from '../../lib/ipc'
import type { ServerConfig } from '../../types'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')
vi.mock('../../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ipc')>()),
  isRemoteBrowser: vi.fn(() => false),
}))
const installLocal = vi.hoisted(() => vi.fn<() => Promise<void>>(() => Promise.resolve()))
// Data fields are explicit; every function the tile calls falls through to a no-op.
vi.mock('./useMods', () => {
  const data: Record<string, unknown> = {
    installLocal,
    installed: [],
    updates: {},
    searchResults: [],
    categories: [],
    versions: [],
    installedLoading: false,
    installedError: null,
    installing: false,
    installError: null,
    selectedProject: null,
    projectLoading: false,
  }
  return {
    useMods: () =>
      new Proxy(data, { get: (t, k: string) => (k in t ? t[k] : () => Promise.resolve()) }),
  }
})

afterEach(() => {
  cleanup()
  vi.mocked(isRemoteBrowser).mockReturnValue(false)
})

const stored = {
  id: 'alpha',
  name: 'alpha',
  jarPath: '',
  jvmArgs: [],
  workingDir: '/srv/alpha',
  mcVersion: '1.20.1',
  loader: 'forge',
  loaderVersion: '',
} as unknown as ServerConfig

describe('ModsTile', () => {
  const saveConfig = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Detection disagrees with what is stored, so the desktop saves it.
    vi.mocked(App.DetectServerLoader).mockResolvedValue({
      ...stored,
      loader: 'neoforge',
      mcVersion: '1.21.1',
    } as unknown as ServerConfig)
    useServerConfigStore.setState({ configs: [stored], activeId: 'alpha', saveConfig })
  })

  it('saves a differing detection on the desktop', async () => {
    render(<ModsTile serverId="alpha" />)
    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
  })

  it('does not save a differing detection in a remote browser', async () => {
    vi.mocked(isRemoteBrowser).mockReturnValue(true)
    render(<ModsTile serverId="alpha" />)
    await waitFor(() => expect(App.DetectServerLoader).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(saveConfig).not.toHaveBeenCalled()
  })

  // #473: the detection write is a background sync with nobody waiting on it.
  // A refusal is caught (the store has already recorded it), not rethrown into
  // an unhandled rejection that vitest would fail this test on.
  it('survives a refused detection save without an unhandled rejection', async () => {
    // A plain function, not vi.fn(): a mock records the settled result of the
    // promise it returns, which attaches a handler and hides the rejection.
    let calls = 0
    useServerConfigStore.setState({
      saveConfig: () => {
        calls++
        return Promise.reject(new Error('SaveServerConfig refused'))
      },
    })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      render(<ModsTile serverId="alpha" />)
      await waitFor(() => expect(calls).toBe(1))
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).not.toHaveBeenCalled()
      // Nothing the user did failed, so nothing is shown.
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  // #473: handleAddFiles awaited installLocal with no catch, and the hook's
  // installError renders only in the panels, so a failed add was on screen nowhere.
  it('shows why Add Files failed', async () => {
    installLocal.mockRejectedValueOnce('ModInstallLocal refused: nobody answered')
    render(<ModsTile serverId="alpha" maximized />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Files' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('ModInstallLocal refused: nobody answered')

    // A second try clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Add Files' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('offers Add Files on the desktop and not in a remote browser', () => {
    const { unmount } = render(<ModsTile serverId="alpha" maximized />)
    expect(screen.getByRole('button', { name: 'Add Files' })).toBeTruthy()
    unmount()

    vi.mocked(isRemoteBrowser).mockReturnValue(true)
    render(<ModsTile serverId="alpha" maximized />)
    expect(screen.queryByRole('button', { name: 'Add Files' })).toBeNull()
    expect(screen.getByRole('button', { name: /Add Content|Add Mod/ })).toBeTruthy()
  })
})
