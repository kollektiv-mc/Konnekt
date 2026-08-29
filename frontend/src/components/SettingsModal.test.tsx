import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import type { models } from '../../wailsjs/go/models'
import { SettingsModal } from './SettingsModal'

vi.mock('../../wailsjs/go/main/App')
vi.mock('../../wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: vi.fn(),
  EventsOn: vi.fn(() => () => {}),
}))

const noop = () => () => {}

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

const updateInfo = (channel: 'stable' | 'snapshot', latestVersion: string) =>
  ({
    currentVersion: '0.1.0',
    latestVersion,
    updateAvailable: true,
    channel,
    releaseUrl: 'https://example.com/release',
    releaseNotes: '',
    publishedAt: '',
    assets: [],
  }) as unknown as models.UpdateInfo

const openAbout = async () => {
  render(<SettingsModal open onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'About' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
}

// The two-step confirm is the entire mitigation for a setting that is a
// foot-gun by design: one click away from swapping a working install for
// untested nightly code. A later refactor collapsing it back to one button
// would be silent without these.
describe('SettingsModal update install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0')
    vi.mocked(App.GetDataDir).mockResolvedValue('/home/user/.config/konnekt')
    vi.mocked(App.GetLogPath).mockResolvedValue('/home/user/.config/konnekt/konnekt.log')
    vi.mocked(App.DownloadAndInstallUpdate).mockResolvedValue(undefined)
    vi.mocked(EventsOn).mockImplementation(noop)
  })

  it('installs a stable update on a single click', async () => {
    vi.mocked(App.CheckForUpdates).mockResolvedValue(updateInfo('stable', 'v0.2.0'))
    await openAbout()

    fireEvent.click(await screen.findByRole('button', { name: 'Download & Install' }))

    await waitFor(() => expect(App.DownloadAndInstallUpdate).toHaveBeenCalledTimes(1))
  })

  it('warns about a snapshot and needs a second click to install it', async () => {
    vi.mocked(App.CheckForUpdates).mockResolvedValue(
      updateInfo('snapshot', '0.2.0-snapshot.202608290400.abc1234'),
    )
    await openAbout()

    expect(await screen.findByText(/untested/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Install snapshot…' }))
    expect(App.DownloadAndInstallUpdate).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'Install it anyway' }))
    await waitFor(() => expect(App.DownloadAndInstallUpdate).toHaveBeenCalledTimes(1))
  })

  it('cancelling the snapshot confirm returns to the single button', async () => {
    vi.mocked(App.CheckForUpdates).mockResolvedValue(
      updateInfo('snapshot', '0.2.0-snapshot.202608290400.abc1234'),
    )
    await openAbout()

    fireEvent.click(await screen.findByRole('button', { name: 'Install snapshot…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('button', { name: 'Install snapshot…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install it anyway' })).toBeNull()
    expect(App.DownloadAndInstallUpdate).not.toHaveBeenCalled()
  })
})

// The browser-only `frontend-dev` preset, where the generated bindings have no
// `window.go` to dereference and so throw a TypeError instead of rejecting. A
// `.catch()` on such a call is attached to nothing, and the throw escaping an
// effect used to unmount the whole app into ErrorBoundary as soon as Settings
// opened — the one preset where you would want to preview the Appearance pane.
describe('SettingsModal with no Wails bridge', () => {
  const noBridge = () => {
    throw new TypeError("Cannot read properties of undefined (reading 'main')")
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetAppVersion).mockImplementation(noBridge)
    vi.mocked(App.GetDataDir).mockImplementation(noBridge)
    vi.mocked(App.GetLogPath).mockImplementation(noBridge)
    vi.mocked(EventsOn).mockImplementation(noBridge)
  })

  it('opens and renders every pane', async () => {
    render(<SettingsModal open onClose={() => {}} />)
    expect(screen.getByText('Skin')).toBeTruthy()

    const panes = [
      ['General', 'Auto-start active server'],
      ['Console', 'Show timestamps'],
      ['Notifications', 'Crash alerts'],
      ["What's New", 'View full changelog on GitHub ↗'],
      ['About', 'Version'],
    ]
    for (const [nav, marker] of panes) {
      fireEvent.click(screen.getByRole('button', { name: nav }))
      expect(await screen.findByText(marker)).toBeTruthy()
    }
  })

  it('shows the About pane unavailable rather than a stale or invented value', async () => {
    render(<SettingsModal open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))

    // Version has nothing to report.
    expect(await screen.findByText('—')).toBeTruthy()
    // The data directory falls back to the generic label, and the log row,
    // which exists only when there is a path to show, stays out.
    expect(screen.getByRole('button', { name: /Open folder/ })).toBeTruthy()
    expect(screen.queryByText('Log file')).toBeNull()
  })
})
