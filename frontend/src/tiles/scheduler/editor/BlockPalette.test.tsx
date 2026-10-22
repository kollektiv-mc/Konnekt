import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { models } from '../../../../wailsjs/go/models'
import { BlockPalette } from './BlockPalette'
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

describe('the palette edge strip', () => {
  beforeEach(() => update.mockClear())

  it('expands a collapsed palette from the whole strip', () => {
    setCollapsed(true)
    render(<BlockPalette blockDefs={defs} onAdd={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand blocks' }))
    expect(update).toHaveBeenCalledWith({ schedulerPaletteCollapsed: false })
  })

  it('collapses an open palette from the whole strip', () => {
    setCollapsed(false)
    render(<BlockPalette blockDefs={defs} onAdd={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse blocks' }))
    expect(update).toHaveBeenCalledWith({ schedulerPaletteCollapsed: true })
  })

  it('keeps a collapsed list out of reach while it is hidden', () => {
    setCollapsed(true)
    render(<BlockPalette blockDefs={defs} onAdd={() => {}} />)

    const list = screen.getByText('blocks').closest('[aria-hidden]')
    expect(list?.getAttribute('aria-hidden')).toBe('true')
    expect(list?.hasAttribute('inert')).toBe(true)
  })
})
