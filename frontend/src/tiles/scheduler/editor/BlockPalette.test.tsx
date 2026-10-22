import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { models } from '../../../../wailsjs/go/models'
import { BlockPalette, PaletteToggle } from './BlockPalette'
import { useSettingsStore } from '../../../stores/useSettingsStore'

vi.mock('../../../../wailsjs/go/main/App')
vi.mock('../../../../wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: vi.fn(),
  EventsOn: vi.fn(() => () => {}),
}))

afterEach(cleanup)

const defs = [
  { id: 'action.command', category: 'action', label: 'Command', description: 'x' },
] as unknown as models.BlockDef[]

const update = vi.fn(() => Promise.resolve())

function setCollapsed(collapsed: boolean) {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      schedulerPaletteCollapsed: collapsed,
      schedulerPaletteClosedCategories: {},
    },
    update,
  })
}

describe('the block browser toggle', () => {
  beforeEach(() => update.mockClear())

  it('opens a closed browser', () => {
    setCollapsed(true)
    render(<PaletteToggle />)

    const toggle = screen.getByRole('button', { name: 'Open blocks' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(update).toHaveBeenCalledWith({ schedulerPaletteCollapsed: false })
  })

  it('closes an open browser', () => {
    setCollapsed(false)
    render(<PaletteToggle />)

    const toggle = screen.getByRole('button', { name: 'Close blocks' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(update).toHaveBeenCalledWith({ schedulerPaletteCollapsed: true })
  })

  it('shows a shut box when closed and an open one when open', () => {
    setCollapsed(true)
    const { rerender } = render(<PaletteToggle />)
    expect(document.querySelector('.lucide-package')).toBeTruthy()

    setCollapsed(false)
    rerender(<PaletteToggle />)
    expect(document.querySelector('.lucide-package-open')).toBeTruthy()
  })
})

describe('the block browser', () => {
  it('has no edge strip of its own', () => {
    setCollapsed(false)
    render(<BlockPalette blockDefs={defs} onAdd={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps a closed list out of reach while it is hidden', () => {
    setCollapsed(true)
    render(<BlockPalette blockDefs={defs} onAdd={() => {}} />)

    const list = screen.getByText('blocks').closest('[aria-hidden]')
    expect(list?.getAttribute('aria-hidden')).toBe('true')
    expect(list?.hasAttribute('inert')).toBe(true)
  })
})
