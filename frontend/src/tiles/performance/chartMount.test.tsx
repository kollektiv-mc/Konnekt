import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { PerformanceTile } from '.'
import { PerformanceSummary } from './PerformanceSummary'

// #285: both faces mounted their lazy chart only once `GetStatsHistory` had
// resolved with a series to draw, so recharts' first render landed wherever
// that round trip did. They now mount it on tile mount with whatever series
// there is, empty included, and lay the empty-state copy over it.
//
// `./charts` is stubbed because jsdom has no layout: recharts' responsive
// container measures zero and renders nothing, so asserting on its SVG would
// say nothing about whether the chart was mounted. The stub records the series
// it was handed instead.
vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')
vi.mock('./charts', () => ({
  SparkChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="spark" data-points={data.length} />
  ),
  HistoryChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="history" data-points={data.length} />
  ),
}))

beforeEach(() => {
  // The history IPC never resolves: the chart has to be there without it.
  vi.mocked(App.GetStatsHistory).mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Performance chart mount', () => {
  it('mounts the spark chart on an empty series, under the waiting copy', async () => {
    render(<PerformanceSummary history={[]} />)

    const chart = await screen.findByTestId('spark')
    expect(chart.getAttribute('data-points')).toBe('0')
    expect(screen.getByText('waiting for data…')).toBeTruthy()
  })

  it('mounts the spark chart while the tile is still waiting on the history IPC', async () => {
    render(<PerformanceTile serverId="srv1" />)

    expect(await screen.findByTestId('spark')).toBeTruthy()
    expect(screen.getByText('waiting for data…')).toBeTruthy()
  })

  it('mounts the history chart on an empty series, under the existing copy', async () => {
    render(<PerformanceTile serverId="srv1" maximized />)

    const chart = await screen.findByTestId('history')
    expect(chart.getAttribute('data-points')).toBe('0')
    expect(screen.getByText('No data yet — start the server to begin recording')).toBeTruthy()
  })

  it('drops the waiting copy once there is a series to draw', async () => {
    const at = (i: number) => ({
      timestamp: 1_700_000_000_000 + i * 10_000,
      tps: 20,
      ramUsedMB: 1024,
      ramTotalMB: 4096,
      cpuPercent: 10,
      players: 0,
    })
    render(<PerformanceSummary history={[at(0), at(1), at(2)]} />)

    expect((await screen.findByTestId('spark')).getAttribute('data-points')).toBe('3')
    expect(screen.queryByText('waiting for data…')).toBeNull()
  })
})
