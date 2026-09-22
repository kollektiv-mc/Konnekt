import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useServerStore } from '../../stores/useServerStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { ServerStatus } from '../../types'
import { OverviewTile } from './index'

const ONLINE: ServerStatus = {
  running: true,
  state: 'running',
  uptime: '2h 14m',
  players: 4,
  maxPlayers: 20,
  tps: 19.8,
  ramUsed: 4218,
  ramTotal: 8192,
}

afterEach(cleanup)

// The three in-tile layouts and the classic toggle, checked on the one tile
// whose face reads a store the test can set directly. The other tiles route
// `layout` and the toggle the same way; what differs per tile is which detail
// each layout adds, and that is the tile's own concern.
describe('Overview compact face layouts', () => {
  beforeEach(() => {
    useServerStore.setState({ status: ONLINE, reachable: true })
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, classicTileFaces: false } }))
  })

  it('default: four figures and the memory bar, nothing the figures already say', () => {
    render(<OverviewTile serverId="srv1" layout="default" />)
    expect(screen.getByText('Uptime')).toBeTruthy()
    expect(screen.getByText('4218 / 8192 MB')).toBeTruthy()
    expect(screen.queryByText('Memory free')).toBeNull()
  })

  it('expanded: the figures only', () => {
    render(<OverviewTile serverId="srv1" layout="expanded" />)
    expect(screen.getByText('2h 14m')).toBeTruthy()
    expect(screen.queryByText('4218 / 8192 MB')).toBeNull()
  })

  it('detailed: small figures, the bar, and rows the figures do not cover', () => {
    render(<OverviewTile serverId="srv1" layout="detailed" />)
    expect(screen.getByText('2h 14m').className).toContain('text-sm')
    expect(screen.getByText('4218 / 8192 MB')).toBeTruthy()
    expect(screen.getByText('3974 MB')).toBeTruthy()
    expect(screen.getByText('steady')).toBeTruthy()
  })

  it('classic faces win over the layout while the setting is on', async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, classicTileFaces: true } }))
    render(<OverviewTile serverId="srv1" layout="detailed" />)
    // The classic face labels its row RAM and never had an Uptime figure. It
    // arrives through a lazy chunk, hence the wait.
    expect(await screen.findByText('RAM')).toBeTruthy()
    expect(screen.queryByText('Uptime')).toBeNull()
    expect(screen.queryByText('Memory free')).toBeNull()
  })
})
