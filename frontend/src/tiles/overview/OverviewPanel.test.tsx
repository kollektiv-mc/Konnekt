import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { useServerStore } from '../../stores/useServerStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useSchedulerStore } from '../../stores/useSchedulerStore'
import { useUiStore } from '../../stores/useUiStore'
import { Database } from '../../lib/icons'
import type { ServerStatus } from '../../types'
import { OverviewTile } from './index'
import { Section } from './Section'

// Mocked rather than bridge-less, so these cases can drive the panel through
// states a user actually sees — a populated dashboard, and a genuinely empty
// one. `tiles/noBridge.test.tsx` covers the no-bridge path for the whole panel
// already, by rendering every registry tile maximized with no `window.go`.
vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

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

const HOUR_AGO = Date.now() - 3_600_000

function snapshot(i: number): models.StatsSnapshot {
  return {
    timestamp: HOUR_AGO + i * 10_000,
    tps: 20,
    ramUsedMB: 1024 + i,
    ramTotalMB: 4096,
    cpuPercent: 12 + i,
    players: i,
  } as unknown as models.StatsSnapshot
}

// globals: false in vite.config.ts, so cleanup is explicit.
afterEach(cleanup)

/** Point every binding the panel reaches at empty results. */
function mockEmpty() {
  vi.mocked(App.GetStatsHistory).mockResolvedValue([])
  vi.mocked(App.GetPlayerRoster).mockResolvedValue([])
  vi.mocked(App.ListWorlds).mockResolvedValue([])
  vi.mocked(App.ListBackups).mockResolvedValue([])
  vi.mocked(App.GetScheduleGraphs).mockResolvedValue([])
  vi.mocked(App.GetScheduleBlockDefs).mockResolvedValue([])
  vi.mocked(App.GetScheduleNextRuns).mockResolvedValue({})
}

describe('OverviewPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockEmpty()
    useServerStore.setState({ status: BASE, reachable: true })
    useUiStore.setState({ maximizeRequest: null })
    // useWorlds is a no-op without one, so every worlds case would pass vacuously.
    useServerConfigStore.setState({ activeId: 'srv1' })
    useSchedulerStore.setState({ graphs: [], nextRuns: {}, hydrated: false, loading: false })
  })

  it('renders the chart and all four blocks', async () => {
    render(<OverviewTile serverId="srv1" maximized />)

    for (const label of ['Performance', 'Players', 'Active world', 'Backups', 'Schedules']) {
      expect(await screen.findByText(label)).toBeTruthy()
    }
  })

  it('renders the vitals, not the dashboard, when the tile is not maximized', () => {
    render(<OverviewTile serverId="srv1" />)

    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.queryByText('Active world')).toBeNull()
  })

  // The panel's headline. A band that cannot tell a stopped server from an
  // unreachable backend shows an unreachable one as healthy and idle — the bug
  // HEALTH_LOG records for 2026-08-20, one level up.
  describe('status band', () => {
    it.each([
      ['Offline', { ...BASE }, true],
      ['Starting', { ...BASE, running: true, state: 'starting' }, true],
      ['Online', { ...BASE, running: true, state: 'running', uptime: '1m', tps: 20 }, true],
      ['Stopping', { ...BASE, running: true, state: 'stopping' }, true],
      ['Unreachable', { ...BASE, running: true, state: 'running' }, false],
    ] as [string, ServerStatus, boolean][])('shows %s', (label, status, reachable) => {
      useServerStore.setState({ status, reachable })
      render(<OverviewTile serverId="srv1" maximized />)
      expect(screen.getByText(label)).toBeTruthy()
    })
  })

  // A section with nothing to report has to say so. A blank block reads as
  // broken, and this is the state every fresh install opens in.
  it('gives every section an empty state rather than a blank block', async () => {
    render(<OverviewTile serverId="srv1" maximized />)

    expect(screen.getByText('waiting for data…')).toBeTruthy()
    expect(await screen.findByText('No players online')).toBeTruthy()
    expect(await screen.findByText('no active world')).toBeTruthy()
    expect(await screen.findByText('no backups yet')).toBeTruthy()
    expect(await screen.findByText('nothing scheduled')).toBeTruthy()
  })

  it('names the active world and its size', async () => {
    vi.mocked(App.ListWorlds).mockResolvedValue([
      { name: 'spawn', active: false, totalSize: 1024, modified: 0 },
      { name: 'survival', active: true, totalSize: 4 * 1024 ** 3, modified: 0 },
    ] as unknown as models.WorldSystem[])

    render(<OverviewTile serverId="srv1" maximized />)

    expect(await screen.findByText('survival')).toBeTruthy()
    // The GB tier is why lib/format's fmtBytes grew one: a world save at this
    // size used to render as "4096.0 MB".
    expect(screen.getByText('4.00 GB')).toBeTruthy()
    expect(screen.queryByText('spawn')).toBeNull()
  })

  it('lists the last backup and no more than three behind it', async () => {
    const now = Date.now()
    vi.mocked(App.ListBackups).mockResolvedValue(
      // Newest first, as backend/services/backup.go sorts them.
      Array.from({ length: 6 }, (_, i) => ({
        filename: `b${i}.zip`,
        createdAt: now - i * 3_600_000,
        sizeBytes: 1024 ** 3,
        displayName: '',
        tags: [],
        kind: 'server',
      })) as unknown as models.Backup[],
    )

    render(<OverviewTile serverId="srv1" maximized />)

    expect(await screen.findByText('just now')).toBeTruthy()
    expect(screen.getByText('3h ago')).toBeTruthy()
    // Four shown, so the fifth and sixth are not.
    expect(screen.queryByText('4h ago')).toBeNull()
  })

  it('lists only the schedules that are enabled', async () => {
    vi.mocked(App.GetScheduleGraphs).mockResolvedValue([
      { id: 'g1', name: 'Nightly backup', enabled: true, nodes: [], edges: [] },
      { id: 'g2', name: 'Retired graph', enabled: false, nodes: [], edges: [] },
    ] as unknown as models.Graph[])
    vi.mocked(App.GetScheduleNextRuns).mockResolvedValue({ g1: Date.now() + 6 * 3_600_000 })

    render(<OverviewTile serverId="srv1" maximized />)

    expect(await screen.findByText('Nightly backup')).toBeTruthy()
    expect(screen.getByText('in 6h')).toBeTruthy()
    expect(screen.queryByText('Retired graph')).toBeNull()
  })

  it.each([
    ['Open Players', 'players'],
    ['Open Active world', 'worlds'],
    ['Open Backups', 'backups'],
    ['Open Schedules', 'scheduler'],
    ['Open Performance', 'performance'],
  ])('asks Dashboard to open the owning tile from %s', (name, tileId) => {
    render(<OverviewTile serverId="srv1" maximized />)

    fireEvent.click(screen.getByRole('button', { name }))

    expect(useUiStore.getState().maximizeRequest).toEqual({ id: tileId, rect: null })
  })

  it('draws the chart once there is more than one sample', async () => {
    vi.mocked(App.GetStatsHistory).mockResolvedValue([snapshot(0), snapshot(1), snapshot(2)])

    render(<OverviewTile serverId="srv1" maximized />)

    // The legend doubles as the readout, and carrying the latest value in it is
    // what keeps numbers off the lines themselves.
    expect(await screen.findByText('14.0%')).toBeTruthy()
    expect(screen.queryByText('waiting for data…')).toBeNull()
  })
})

// Five independent tile-domain subtrees mount side by side in that panel, and
// main.tsx's app-level boundary is the only other one in the tree — so an
// unguarded section throwing would replace the whole window with "render
// error" rather than one block.
describe('Section', () => {
  function Boom(): React.ReactNode {
    throw new Error('section blew up')
  }

  it('contains a body that throws, and keeps its own header', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <Section tileId="backups" icon={Database} label="Backups">
          <Boom />
        </Section>,
      )
      expect(screen.getByText('unavailable')).toBeTruthy()
      // The header survives, so the way into the tile is still there.
      expect(screen.getByRole('button', { name: 'Open Backups' })).toBeTruthy()
    } finally {
      quiet.mockRestore()
    }
  })

  it('leaves a sibling section untouched', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <div>
          <Section tileId="backups" icon={Database} label="Backups">
            <Boom />
          </Section>
          <Section tileId="worlds" icon={Database} label="Active world">
            <span>world content</span>
          </Section>
        </div>,
      )
      expect(screen.getByText('unavailable')).toBeTruthy()
      expect(screen.getByText('world content')).toBeTruthy()
    } finally {
      quiet.mockRestore()
    }
  })
})
