import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { models } from '../../../../wailsjs/go/models'
import { QuickAddMenu } from './QuickAddMenu'

afterEach(cleanup)

const defs = [
  { id: 'trigger.cron', category: 'trigger', label: 'Cron', description: 'c' },
  { id: 'action.command', category: 'action', label: 'Command', description: 'x' },
  {
    id: 'action.dhA',
    category: 'action',
    label: 'DH A',
    description: 'a',
    group: 'Distant Horizons',
  },
  {
    id: 'action.dhB',
    category: 'action',
    label: 'DH B',
    description: 'b',
    group: 'Distant Horizons',
  },
] as unknown as models.BlockDef[]

function open(onPick = vi.fn()) {
  render(
    <QuickAddMenu
      blockDefs={defs}
      screenPos={{ x: 10, y: 10 }}
      onPick={onPick}
      onClose={() => {}}
    />,
  )
  return onPick
}

describe('block groups in the quick-add menu', () => {
  it('shows a group as one row in the category fly-out', () => {
    open()
    fireEvent.mouseEnter(screen.getByText('action'))

    expect(screen.getByText('Command')).toBeTruthy()
    expect(screen.getByText('Distant Horizons')).toBeTruthy()
    expect(screen.queryByText('DH A')).toBeNull()
  })

  it('opens the group beside the fly-out on hover, and picks from it', () => {
    const onPick = open()
    fireEvent.mouseEnter(screen.getByText('action'))
    fireEvent.mouseEnter(screen.getByText('Distant Horizons'))

    expect(screen.getByText('DH A')).toBeTruthy()
    fireEvent.click(screen.getByText('DH B'))
    expect(onPick).toHaveBeenCalledWith(defs[3])
  })

  it('closes the group when the pointer moves to a plain block', () => {
    open()
    fireEvent.mouseEnter(screen.getByText('action'))
    fireEvent.mouseEnter(screen.getByText('Distant Horizons'))
    fireEvent.mouseEnter(screen.getByText('Command'))

    expect(screen.queryByText('DH A')).toBeNull()
  })

  it('keeps the group closed after hopping to another category and back', () => {
    open()
    fireEvent.mouseEnter(screen.getByText('action'))
    fireEvent.mouseEnter(screen.getByText('Distant Horizons'))
    fireEvent.mouseEnter(screen.getByText('trigger'))
    fireEvent.mouseEnter(screen.getByText('action'))

    expect(screen.queryByText('DH A')).toBeNull()
  })

  it('finds grouped blocks directly in search, labelled by their group', () => {
    open()
    fireEvent.change(screen.getByPlaceholderText('search blocks…'), { target: { value: 'dh a' } })

    expect(screen.getByText('DH A')).toBeTruthy()
    expect(screen.getByText('Distant Horizons')).toBeTruthy()
  })

  it('matches a search on the group name', () => {
    open()
    fireEvent.change(screen.getByPlaceholderText('search blocks…'), {
      target: { value: 'distant' },
    })

    expect(screen.getByText('DH A')).toBeTruthy()
    expect(screen.getByText('DH B')).toBeTruthy()
    expect(screen.queryByText('Command')).toBeNull()
  })
})
