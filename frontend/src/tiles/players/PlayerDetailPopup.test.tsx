import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PlayerDetailPopup } from './PlayerDetailPopup'
import { declaredLayer } from '../../lib/layers'
import type { Player } from '../../types'

vi.mock('../../../wailsjs/go/main/App')

afterEach(cleanup)

const player = {
  name: 'Korbin',
  uuid: 'uuid-korbin',
  online: true,
  ip: '192.168.1.52',
  lastOnline: 0,
  opLevel: 0,
  whitelisted: true,
  banned: false,
  banReason: '',
  primaryGroup: 'member',
  groups: [],
} as unknown as Player

// The bug behind #257: the grid copy of a tile is transformed by
// react-grid-layout, and a transformed ancestor is the containing block for
// `fixed`, so rendered inline this popup and its backdrop covered the Players
// tile's own box rather than the window. Both halves have to hold: the portal
// gets it out of the tile, and z-modal is what carries it over the maximize
// overlay once it is there.
describe('PlayerDetailPopup', () => {
  it('renders outside the tile, on the modal layer', () => {
    const { container } = render(
      <PlayerDetailPopup player={player} serverId="srv1" onClose={() => {}} onMutated={() => {}} />,
    )
    const overlay = screen.getByText('Korbin').closest('.fixed')
    expect(overlay).not.toBeNull()
    expect(container.contains(overlay)).toBe(false)
    expect(declaredLayer(overlay?.className ?? '')).toBe('modal')
  })
})
