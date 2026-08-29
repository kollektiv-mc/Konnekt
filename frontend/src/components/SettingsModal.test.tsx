import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'
import { SettingsModal } from './SettingsModal'

vi.mock('../../wailsjs/go/main/App')
vi.mock('../../wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: vi.fn(),
  EventsOn: () => () => {},
}))

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
