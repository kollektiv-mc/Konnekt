import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { TOOLTIP_DELAY_MS } from '../../components/ui/Tooltip'
import { PlayerList } from './PlayerList'
import type { Player } from '../../types'

function banned(banReason: string): Player {
  return {
    name: 'Alex',
    uuid: 'uuid-alex',
    online: false,
    ip: '',
    lastOnline: 0,
    opLevel: 0,
    whitelisted: false,
    banned: true,
    banReason,
    primaryGroup: '',
    groups: [],
  } as unknown as Player
}

function hover(el: HTMLElement) {
  fireEvent.pointerEnter(el)
  act(() => {
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS)
  })
}

// The BAN tag is the only place the roster row names why a player is banned.
describe('the BAN tag in the detailed roster', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the ban reason in a tooltip on hover', () => {
    render(
      <PlayerList
        players={[banned('Griefing spawn')]}
        reachable
        detailed
        onSelectPlayer={() => {}}
      />,
    )
    hover(screen.getByText('BAN'))
    expect(screen.getByRole('tooltip').textContent).toBe('Griefing spawn')
  })

  it('shows no tooltip when the ban has no reason', () => {
    render(<PlayerList players={[banned('')]} reachable detailed onSelectPlayer={() => {}} />)
    hover(screen.getByText('BAN'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
