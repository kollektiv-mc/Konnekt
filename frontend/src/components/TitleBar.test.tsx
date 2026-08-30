import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import * as runtime from '../../wailsjs/runtime/runtime'
import { TitleBar } from './TitleBar'

vi.mock('../../wailsjs/runtime/runtime')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

// The component reads the maximised state through a promise, so every render
// has a microtask to settle before its glyph is the right one.
const settle = () => act(async () => {})

describe('TitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(runtime.WindowIsMaximised).mockResolvedValue(false)
  })

  it('sends each window control to its runtime command', async () => {
    render(<TitleBar onOpenSettings={() => {}} />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }))
    expect(runtime.WindowMinimise).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }))
    expect(runtime.WindowToggleMaximise).toHaveBeenCalledTimes(1)

    // Quit rather than a window close, so app.go's beforeClose still stops the
    // scheduler and the running server.
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))
    expect(runtime.Quit).toHaveBeenCalledTimes(1)
  })

  it('opens settings from the gear', async () => {
    const onOpenSettings = vi.fn()
    render(<TitleBar onOpenSettings={onOpenSettings} />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('names the maximise control from the window it finds on mount', async () => {
    vi.mocked(runtime.WindowIsMaximised).mockResolvedValue(true)
    render(<TitleBar onOpenSettings={() => {}} />)
    await settle()

    expect(screen.getByRole('button', { name: 'Restore window' })).toBeTruthy()
  })

  it('flips the control without waiting for the window to answer', async () => {
    render(<TitleBar onOpenSettings={() => {}} />)
    await settle()

    // The resize-driven resync is debounced by 120ms, which is long enough to
    // read as a dropped click if the glyph waited for it.
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }))
    expect(screen.getByRole('button', { name: 'Restore window' })).toBeTruthy()
  })

  it('resyncs from the window after a resize, so a snap is not missed', async () => {
    vi.useFakeTimers()
    try {
      render(<TitleBar onOpenSettings={() => {}} />)
      await act(async () => {})
      expect(screen.getByRole('button', { name: 'Maximize window' })).toBeTruthy()

      // Nothing in this app maximises the window — the window manager did,
      // dropping it on a screen edge. The only trace is that the webview
      // resized.
      vi.mocked(runtime.WindowIsMaximised).mockResolvedValue(true)
      fireEvent(window, new Event('resize'))
      await act(async () => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.getByRole('button', { name: 'Restore window' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})
