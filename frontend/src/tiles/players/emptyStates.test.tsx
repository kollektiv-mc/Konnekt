import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PlayerList } from './PlayerList'
import { PlayerRoster } from './PlayerRoster'
import type { Player } from '../../types'

function player(name: string): Player {
  return {
    name,
    uuid: `uuid-${name}`,
    online: true,
    ip: '',
    lastOnline: 0,
    opLevel: 0,
    whitelisted: false,
    banned: false,
    banReason: '',
    primaryGroup: '',
    groups: [],
  } as unknown as Player
}

// Both views used to render an empty roster as "No players online" whatever the
// reason, so an unreachable server was indistinguishable from an idle one
// (agent_docs/HEALTH_CHECKLIST.md's ErrorBoundary item; HEALTH_LOG.md 2026-08-20).
// Asserting it here rather than at a desk: a jsdom render is the whole check.
// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

describe('empty-state wording', () => {
  it('PlayerList says nobody is on when the server answered', () => {
    render(<PlayerList players={[]} reachable onSelectPlayer={() => {}} />)
    expect(screen.getByText('No players online')).toBeTruthy()
  })

  it('PlayerList says unreachable when the roster fetch failed', () => {
    render(<PlayerList players={[]} reachable={false} onSelectPlayer={() => {}} />)
    expect(screen.getByText('Server unreachable')).toBeTruthy()
    expect(screen.queryByText('No players online')).toBeNull()
  })

  it('PlayerRoster says nobody is on when the server answered', () => {
    render(<PlayerRoster players={[]} reachable onSelectPlayer={() => {}} />)
    expect(screen.getByText('No players online')).toBeTruthy()
  })

  it('PlayerRoster says unreachable when the roster fetch failed', () => {
    render(<PlayerRoster players={[]} reachable={false} onSelectPlayer={() => {}} />)
    expect(screen.getByText('Server unreachable')).toBeTruthy()
  })

  it('shows the roster rather than either message when players are online', () => {
    render(<PlayerList players={[player('Steve')]} reachable onSelectPlayer={() => {}} />)
    expect(screen.queryByText('No players online')).toBeNull()
    expect(screen.queryByText('Server unreachable')).toBeNull()
  })
})
