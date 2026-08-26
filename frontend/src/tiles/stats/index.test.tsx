import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useServerStore } from '../../stores/useServerStore'
import type { ServerStatus } from '../../types'
import { StatsTile } from './index'

const BASE: ServerStatus = {
  running: false,
  state: 'offline',
  uptime: '0s',
  players: 0,
  maxPlayers: 20,
  tps: 0,
  ramUsed: 0,
  ramTotal: 2048,
}

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

// The status pill implements #101 via #108: the two-state Online/Offline label
// becomes five faces, keyed on the lifecycle phase the backend now tracks.
// Running stays "process alive", so Starting and Stopping render with
// running: true — exactly the case the old boolean pill could not show.
describe('StatsTile status pill', () => {
  beforeEach(() => {
    useServerStore.setState({ status: BASE, reachable: true })
  })

  it.each([
    ['Offline', { ...BASE }, true],
    ['Starting', { ...BASE, running: true, state: 'starting' }, true],
    ['Online', { ...BASE, running: true, state: 'running', uptime: '1m 0s', tps: 20 }, true],
    ['Stopping', { ...BASE, running: true, state: 'stopping', uptime: '1m 0s' }, true],
    ['Unreachable', { ...BASE, running: true, state: 'running' }, false],
  ] as [string, ServerStatus, boolean][])('labels the pill %s', (label, status, reachable) => {
    useServerStore.setState({ status, reachable })
    render(<StatsTile serverId="srv1" />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('does not show Online for a booting server the way the boolean pill did', () => {
    useServerStore.setState({ status: { ...BASE, running: true, state: 'starting' } })
    render(<StatsTile serverId="srv1" />)
    expect(screen.queryByText('Online')).toBeNull()
  })

  it('lets Unreachable win over any phase', () => {
    useServerStore.setState({
      status: { ...BASE, running: true, state: 'starting' },
      reachable: false,
    })
    render(<StatsTile serverId="srv1" />)
    expect(screen.getByText('Unreachable')).toBeTruthy()
    expect(screen.queryByText('Starting')).toBeNull()
  })
})
