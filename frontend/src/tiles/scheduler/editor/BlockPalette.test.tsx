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

const grouped = [
  { id: 'action.command', category: 'action', label: 'Command', description: 'x' },
  {
    id: 'action.dhA',
    category: 'action',
    label: 'DH A',
    description: 'a',
    group: 'Distant Horizons',
  },
  { id: 'action.upload', category: 'action', label: 'Upload', description: 'u' },
  {
    id: 'action.dhB',
    category: 'action',
    label: 'DH B',
    description: 'b',
    group: 'Distant Horizons',
  },
] as unknown as models.BlockDef[]

const update = vi.fn(() => Promise.resolve())

function setCollapsed(collapsed: boolean, openGroups: Record<string, boolean> = {}) {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      schedulerPaletteCollapsed: collapsed,
      schedulerPaletteClosedCategories: {},
      schedulerPaletteOpenGroups: openGroups,
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

describe('block groups in the palette', () => {
  beforeEach(() => update.mockClear())

  it('shows a group as one collapsed row, with the other blocks as they were', () => {
    setCollapsed(false)
    render(<BlockPalette blockDefs={grouped} onAdd={() => {}} />)

    expect(
      screen.getByRole('button', { name: /Distant Horizons/ }).getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByText('DH A')).toBeNull()
    expect(screen.getByText('Command')).toBeTruthy()
    expect(screen.getByText('Upload')).toBeTruthy()
  })

  it('opens a group by its category-scoped key', () => {
    setCollapsed(false)
    render(<BlockPalette blockDefs={grouped} onAdd={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /Distant Horizons/ }))
    expect(update).toHaveBeenCalledWith({
      schedulerPaletteOpenGroups: { 'action/Distant Horizons': true },
    })
  })

  it('lists the members of an open group, and adds one on click', () => {
    setCollapsed(false, { 'action/Distant Horizons': true })
    const onAdd = vi.fn()
    render(<BlockPalette blockDefs={grouped} onAdd={onAdd} />)

    expect(screen.getByText('DH A')).toBeTruthy()
    fireEvent.click(screen.getByText('DH B'))
    expect(onAdd).toHaveBeenCalledWith(grouped[3])
  })

  it('drags a grouped block by its own type id', () => {
    setCollapsed(false, { 'action/Distant Horizons': true })
    render(<BlockPalette blockDefs={grouped} onAdd={() => {}} />)

    const setData = vi.fn()
    fireEvent.dragStart(screen.getByText('DH A'), { dataTransfer: { setData } })
    expect(setData).toHaveBeenCalledWith('blockType', 'action.dhA')
  })
})
