import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import type { models } from '../../wailsjs/go/models'
import { SettingsModal } from './SettingsModal'
import { useSettingsStore } from '../stores/useSettingsStore'
import { BUILTIN_SKINS, resolveSkin } from '../lib/theme'
import { declaredLayer } from '../lib/layers'
import type { AppSettings } from '../types'

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

// Only the Default skin is solved against the light theme. The rest write their
// tokens as inline custom properties on <html>, which outrank
// [data-theme='light'], so light mode left them with dark surfaces and whatever
// light-theme tokens they happened not to override — near-black text on a
// near-black canvas, for Midnight. `applySkin` refuses the combination; these
// cover the half of the answer the user can actually see.
describe('SettingsModal skin and light mode', () => {
  const settings = (patch: Partial<AppSettings>) => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, ...patch },
      error: null,
    })
  }
  const openAppearance = () => render(<SettingsModal open onClose={() => {}} />)
  const modeOption = (label: RegExp) => screen.getByRole('button', { name: label })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0')
    vi.mocked(App.SaveAppSettings).mockResolvedValue(undefined)
    vi.mocked(EventsOn).mockImplementation(noop)
    // jsdom ships no matchMedia, which applySkin needs for theme: 'system'.
    window.matchMedia = (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    settings({ theme: 'dark', skinId: 'default' })
  })

  const MODE_DESCRIPTION = 'Light, dark, or follow your OS preference.'

  it('offers light mode for the default skin', () => {
    settings({ skinId: 'default' })
    openAppearance()

    expect(modeOption(/Light/).hasAttribute('disabled')).toBe(false)
  })

  it('disables light mode for a dark-only skin', () => {
    settings({ skinId: 'midnight' })
    openAppearance()

    expect(modeOption(/Light/).hasAttribute('disabled')).toBe(true)
  })

  // The disabled option is the whole signal. A description that grew a second
  // line for the dark-only case reflowed every row below it as the skin changed,
  // so the copy is fixed and the lock speaks for itself.
  it('keeps the Mode description fixed across skins so the pane does not reflow', () => {
    settings({ skinId: 'default' })
    const { unmount } = openAppearance()
    expect(screen.getAllByText(MODE_DESCRIPTION)).toHaveLength(1)
    unmount()

    for (const skinId of ['midnight', 'nord', 'forest']) {
      settings({ skinId })
      const view = openAppearance()
      expect(screen.getAllByText(MODE_DESCRIPTION)).toHaveLength(1)
      expect(screen.queryByText(/dark-only/)).toBeNull()
      view.unmount()
    }
  })

  // The decision here: System stays available rather than being taken away from
  // a user whose OS is dark. applySkin resolves it to dark while the skin needs
  // that, without discarding the preference.
  it('leaves dark and system selectable for a dark-only skin', () => {
    settings({ skinId: 'forest' })
    openAppearance()

    expect(modeOption(/Dark/).hasAttribute('disabled')).toBe(false)
    expect(modeOption(/System/).hasAttribute('disabled')).toBe(false)
  })

  // One patch rather than two writes: the store applies the skin on every
  // update, so a follow-up write would paint a frame of light-mode-on-a-dark-
  // skin before correcting itself.
  it('switches to dark in the same write when a dark-only skin is picked in light mode', async () => {
    settings({ theme: 'light', skinId: 'default' })
    openAppearance()

    fireEvent.click(screen.getByRole('button', { name: 'Midnight' }))

    await waitFor(() => expect(App.SaveAppSettings).toHaveBeenCalledTimes(1))
    const written = vi.mocked(App.SaveAppSettings).mock.calls[0][0]
    expect(written.skinId).toBe('midnight')
    expect(written.theme).toBe('dark')
    expect(useSettingsStore.getState().settings.theme).toBe('dark')
  })

  it('leaves a theme that is not light alone when the skin changes', async () => {
    settings({ theme: 'system', skinId: 'default' })
    openAppearance()

    fireEvent.click(screen.getByRole('button', { name: 'Nord' }))

    await waitFor(() => expect(App.SaveAppSettings).toHaveBeenCalledTimes(1))
    expect(useSettingsStore.getState().settings.theme).toBe('system')
    expect(useSettingsStore.getState().settings.skinId).toBe('nord')
  })

  // Unreachable through the UI, which writes `dark` along with the skin. A
  // settings file predating the flag, or hand-edited, still lands here, and
  // showing Light as the selected mode would describe a mode applySkin is
  // actively refusing to render.
  it('shows a stored-but-refused light mode as dark', () => {
    settings({ theme: 'light', skinId: 'midnight' })
    openAppearance()

    const dark = modeOption(/Dark/)
    const light = modeOption(/Light/)
    expect(dark.className).toContain('bg-accent')
    expect(light.className).not.toContain('bg-accent')
    expect(light.hasAttribute('disabled')).toBe(true)
    // The stored preference is displayed differently, not discarded.
    expect(useSettingsStore.getState().settings.theme).toBe('light')
  })

  it('does not touch the theme when the skin picked supports light', async () => {
    settings({ theme: 'light', skinId: 'default' })
    openAppearance()

    fireEvent.click(screen.getByRole('button', { name: 'Default' }))

    await waitFor(() => expect(App.SaveAppSettings).toHaveBeenCalledTimes(1))
    expect(useSettingsStore.getState().settings.theme).toBe('light')
  })
})

// Each skin is designed around a hue, so picking one brings its accent with it.
describe('SettingsModal skin accent pairing', () => {
  const settings = (patch: Partial<AppSettings>) => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, ...patch },
      error: null,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0')
    vi.mocked(App.SaveAppSettings).mockResolvedValue(undefined)
    vi.mocked(EventsOn).mockImplementation(noop)
    settings({ theme: 'dark', skinId: 'default', accentColor: resolveSkin('default').accent })
  })

  it.each(BUILTIN_SKINS.filter((s) => s.id !== 'default'))(
    'switches the accent to $id’s when the skin is picked',
    async (skin) => {
      render(<SettingsModal open onClose={() => {}} />)

      fireEvent.click(screen.getByRole('button', { name: skin.name }))

      await waitFor(() => expect(App.SaveAppSettings).toHaveBeenCalledTimes(1))
      const written = vi.mocked(App.SaveAppSettings).mock.calls[0][0]
      expect(written.skinId).toBe(skin.id)
      expect(written.accentColor).toBe(skin.accent)
      expect(useSettingsStore.getState().settings.accentColor).toBe(skin.accent)
    },
  )

  // One write, not two. The store calls applySkin on every update, so a separate
  // accent write would paint a frame of the new skin under the old accent.
  it('carries the skin, its accent and the forced theme in a single patch', async () => {
    settings({ theme: 'light', skinId: 'default' })
    render(<SettingsModal open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Midnight' }))

    await waitFor(() => expect(App.SaveAppSettings).toHaveBeenCalledTimes(1))
    const written = vi.mocked(App.SaveAppSettings).mock.calls[0][0]
    expect(written).toMatchObject({
      skinId: 'midnight',
      accentColor: resolveSkin('midnight').accent,
      theme: 'dark',
    })
  })

  // The paired accent is one of the swatches on offer, so the picker rings it as
  // selected rather than falling through to the custom "+" slot. Scoped to the
  // accent section because the status pickers below reuse some of the same
  // labels ('Amber' is also a warning preset, 'Rose' also a danger one).
  it('selects the matching swatch in the accent picker', async () => {
    render(<SettingsModal open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Midnight' }))
    await waitFor(() => expect(App.SaveAppSettings).toHaveBeenCalledTimes(1))

    const violet = resolveSkin('midnight').accent
    const section = within(
      screen.getByText('Accent color').closest('div.border-b-hairline') as HTMLElement,
    )
    expect(section.getByTitle('Violet').style.outline).toBe(`2.5px solid ${violet}`)
    expect(section.getByTitle('Custom color').style.outline).toBe('2.5px solid transparent')
    // And the skin's own previous accent has let go of the ring.
    expect(section.getByTitle('Green').style.outline).toBe('2.5px solid transparent')
  })

  // A deliberate accent survives everything except the next skin switch, which
  // is the trade the pairing makes.
  it('leaves the accent alone when something other than the skin changes', async () => {
    settings({ skinId: 'nord', accentColor: '#ff0000' })
    render(<SettingsModal open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /System/ }))

    await waitFor(() => expect(App.SaveAppSettings).toHaveBeenCalledTimes(1))
    expect(useSettingsStore.getState().settings.accentColor).toBe('#ff0000')
  })
})

// A backdropped surface that replaces the dashboard, so it sits on the modal
// layer: above the maximized-tile overlay by value, whatever App renders first.
describe('SettingsModal layering', () => {
  it('opens on the modal layer', () => {
    render(<SettingsModal open onClose={() => {}} />)
    const overlay = screen.getByRole('button', { name: 'About' }).closest('.fixed')
    expect(declaredLayer(overlay?.className ?? '')).toBe('modal')
  })
})
