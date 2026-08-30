import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { NavSection } from './NavSection'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { IconButton } from './IconButton'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const settingsWith = (navClosedSections: Record<string, boolean>) => ({
  ...useSettingsStore.getState().settings,
  navClosedSections,
})

// `hasWailsBridge()` reads window.go's presence, and jsdom has none — so a
// rejected write is treated as the no-bridge preview and the optimistic value
// stands. Attach a stub to exercise the real-backend-rejection path.
const attachBridge = () => Object.assign(window, { go: {} })

describe('NavSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.SaveAppSettings).mockResolvedValue(undefined)
    Reflect.deleteProperty(window, 'go')
    useSettingsStore.setState({ settings: settingsWith({}), error: null })
  })

  it('opens by default, and says so on the toggle', () => {
    render(
      <NavSection id="servers" title="Servers">
        <div>body</div>
      </NavSection>,
    )
    expect(screen.getByRole('button', { name: /Servers/ }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('a section marked closed in settings starts collapsed', () => {
    useSettingsStore.setState({ settings: settingsWith({ servers: true }) })
    render(
      <NavSection id="servers" title="Servers">
        <div>body</div>
      </NavSection>,
    )
    expect(screen.getByRole('button', { name: /Servers/ }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  // Each card reads and writes its own key, so closing one cannot close another
  // — the failure mode of a single shared "collapsed" flag.
  it('closing one section leaves the others alone', async () => {
    render(
      <>
        <NavSection id="widgets" title="Widgets">
          <div>a</div>
        </NavSection>
        <NavSection id="tiles" title="Tiles">
          <div>b</div>
        </NavSection>
      </>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Widgets/ }))
    })

    expect(useSettingsStore.getState().settings.navClosedSections).toEqual({ widgets: true })
    expect(screen.getByRole('button', { name: /Tiles/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('toggling writes through to the settings file', async () => {
    render(
      <NavSection id="layouts" title="Layouts">
        <div>body</div>
      </NavSection>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Layouts/ }))
    })
    expect(vi.mocked(App.SaveAppSettings).mock.calls[0][0].navClosedSections).toEqual({
      layouts: true,
    })
  })

  // The store reverts a refused write itself, which is the whole reason this
  // holds no local copy of the flag: the card has to spring back with it.
  it('a refused write puts the section back', async () => {
    attachBridge()
    vi.mocked(App.SaveAppSettings).mockRejectedValue(new Error('disk full'))
    render(
      <NavSection id="layouts" title="Layouts">
        <div>body</div>
      </NavSection>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Layouts/ }))
    })

    expect(screen.getByRole('button', { name: /Layouts/ }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    expect(useSettingsStore.getState().error).toContain('disk full')
  })

  // A control nested inside the disclosure button would be a button inside a
  // button, and clicking it would toggle the section on the way through.
  it('the section action is not part of the toggle', async () => {
    const onAction = vi.fn()
    render(
      <NavSection
        id="servers"
        title="Servers"
        action={
          <IconButton onClick={onAction} title="Manage servers">
            <span />
          </IconButton>
        }
      >
        <div>body</div>
      </NavSection>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Manage servers' }))
    })

    expect(onAction).toHaveBeenCalledOnce()
    expect(useSettingsStore.getState().settings.navClosedSections).toEqual({})
    expect(screen.getByRole('button', { name: /Servers/ }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('reports the state the header moved to, for a section with something to disarm', async () => {
    const onToggle = vi.fn()
    render(
      <NavSection id="layouts" title="Layouts" onToggle={onToggle}>
        <div>body</div>
      </NavSection>,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Layouts/ }))
    })
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('shows the count beside the title', () => {
    render(
      <NavSection id="tiles" title="Tiles" count={9}>
        <div>body</div>
      </NavSection>,
    )
    expect(screen.getByRole('button', { name: /Tiles/ }).textContent).toContain('9')
  })
})
