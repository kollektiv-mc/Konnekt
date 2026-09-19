import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useServerStore } from '../stores/useServerStore'
import { useConsoleStore } from '../stores/useConsoleStore'
import { useServerStatusSync } from '../hooks/useServerStatus'
import { useConsoleSync } from '../hooks/useConsoleSync'
import { usePerformanceHistory } from './performance/usePerformanceHistory'
import { usePlayers } from './players/usePlayers'
import { useWorlds } from './worlds/useWorlds'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useConfigEditor } from './config/useConfigEditor'
import { EVENTS } from '../lib/constants'
import type { ConfigFile, ServerStatus } from '../types'

vi.mock('../../wailsjs/go/main/App')
vi.mock('../../wailsjs/runtime/runtime')

// Switching server is a transition, not a write (#234). `setActiveId` used to
// set one string and notify nobody, so one server's data stayed on screen under
// another server's name: the console kept the previous output and appended the
// new server's to it, the performance chart spliced two servers' samples
// together, and a 10s server:status push for whichever server was *running*
// overwrote the status just fetched for the one selected.
//
// Every fix below is a filter or a reset that the backend could not support
// until #233 put a serverID on every server-scoped event. These tests are
// therefore also the check that #233 is actually being read.
//
// Each case is written to fail when its own fix is reverted, and each was
// confirmed to do so. A test that passes either way is worse than no test: it
// reports this class of bug as closed.
//
// globals: false in vite.config.ts, so cleanup is explicit.
afterEach(cleanup)

function status(over: Partial<ServerStatus> = {}): ServerStatus {
  return {
    running: true,
    state: 'running',
    uptime: '1m 0s',
    players: 2,
    maxPlayers: 20,
    tps: 19.8,
    ramUsed: 512,
    ramTotal: 2048,
    ...over,
  }
}

let handlers: Record<string, (...data: unknown[]) => void>

/** Fires a Wails event at whatever subscribed to it, as the bus would. */
function emit(event: string, payload: unknown) {
  act(() => {
    handlers[event]?.(payload)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers = {}
  vi.mocked(EventsOn).mockImplementation((name: string, cb: (...data: unknown[]) => void) => {
    handlers[name] = cb
    return vi.fn()
  })
})

describe('server status on switch', () => {
  beforeEach(() => {
    vi.mocked(App.GetServerStatus).mockResolvedValue(status())
    useServerStore.getState().reset()
  })

  // The defect #239 filed and could not close: it corrected GetServerStatus to
  // answer for the server it was asked about, but the next 10s push overwrote
  // that answer with whichever server the stats ticker reports on.
  it('ignores a server:status push for another server', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(useServerStore.getState().status.uptime).toBe('1m 0s'))

    emit(EVENTS.SERVER_STATUS, { ...status({ uptime: '9h 9m', players: 41 }), serverID: 'srv2' })

    expect(useServerStore.getState().status.uptime).toBe('1m 0s')
    expect(useServerStore.getState().status.players).toBe(2)
  })

  it('applies a server:status push for its own server', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(useServerStore.getState().status.uptime).toBe('1m 0s'))

    emit(EVENTS.SERVER_STATUS, { ...status({ uptime: '4m 0s' }), serverID: 'srv1' })

    expect(useServerStore.getState().status.uptime).toBe('4m 0s')
  })

  // A payload with no id belongs to no server in particular. Dropping those
  // would blank the status of a freshly launched app, because StatsService.tick
  // reports on CurrentServerID, which is empty until a start claims one.
  it('applies a push that names no server', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(useServerStore.getState().status.uptime).toBe('1m 0s'))

    emit(EVENTS.SERVER_STATUS, status({ uptime: '7m 0s' }))

    expect(useServerStore.getState().status.uptime).toBe('7m 0s')
  })

  it('ignores a server:state push for another server', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(useServerStore.getState().status.state).toBe('running'))

    emit(EVENTS.SERVER_STATE, { state: 'stopping', serverID: 'srv2' })

    expect(useServerStore.getState().status.state).toBe('running')
  })

  // The gap between a switch and the new fetch resolving used to render as the
  // previous server's uptime and player count under the new server's name.
  it('blanks the status before fetching the new server', async () => {
    const { rerender } = renderHook(({ id }) => useServerStatusSync(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(useServerStore.getState().status.uptime).toBe('1m 0s'))

    // Never resolves, so the state under assertion is the gap itself.
    vi.mocked(App.GetServerStatus).mockReturnValue(new Promise(() => {}))
    rerender({ id: 'srv2' })

    expect(useServerStore.getState().status.uptime).toBe('0s')
    expect(useServerStore.getState().status.players).toBe(0)
  })
})

describe('console on switch', () => {
  beforeEach(() => {
    useConsoleStore.getState().clear()
    vi.mocked(App.GetConsoleHistory).mockResolvedValue([])
  })

  const texts = () => useConsoleStore.getState().lines.map((l) => l.text)

  it('drops a log line from another server', async () => {
    renderHook(() => useConsoleSync('srv1'))
    await waitFor(() => expect(App.GetConsoleHistory).toHaveBeenCalledWith('srv1'))

    emit(EVENTS.LOG_LINE, { timestamp: '12:00:00', line: 'srv2 output', serverID: 'srv2' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })

    expect(texts()).not.toContain('srv2 output')
  })

  it('keeps a log line from its own server', async () => {
    renderHook(() => useConsoleSync('srv1'))
    await waitFor(() => expect(App.GetConsoleHistory).toHaveBeenCalledWith('srv1'))

    emit(EVENTS.LOG_LINE, { timestamp: '12:00:00', line: 'srv1 output', serverID: 'srv1' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })

    expect(texts()).toContain('srv1 output')
  })

  // Narration from the bootstrap instance, which has the empty id, reaches the
  // console before any server has started. It must not be filtered away.
  it('keeps a log line that names no server', async () => {
    renderHook(() => useConsoleSync('srv1'))
    await waitFor(() => expect(App.GetConsoleHistory).toHaveBeenCalledWith('srv1'))

    emit(EVENTS.LOG_LINE, { timestamp: '12:00:00', line: 'Konnekt is starting' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })

    expect(texts()).toContain('Konnekt is starting')
  })

  it('replaces the console with the new server history on switch', async () => {
    vi.mocked(App.GetConsoleHistory).mockResolvedValue([
      { timestamp: '11:00:00', line: 'srv1 old line', source: '', outcome: '' },
    ])
    const { rerender } = renderHook(({ id }) => useConsoleSync(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(texts()).toContain('srv1 old line'))

    vi.mocked(App.GetConsoleHistory).mockResolvedValue([
      { timestamp: '11:30:00', line: 'srv2 old line', source: '', outcome: '' },
    ])
    rerender({ id: 'srv2' })

    await waitFor(() => expect(texts()).toContain('srv2 old line'))
    expect(texts()).not.toContain('srv1 old line')
  })

  // What clear() is actually for. loadHistory replaces the buffer wholesale, so
  // once the reply lands the console is correct either way; the window this
  // covers is the round trip before it, where the previous server's output used
  // to sit on screen under the new server's name. Same gap the status test
  // above covers.
  it('empties the console while the new history is still loading', async () => {
    vi.mocked(App.GetConsoleHistory).mockResolvedValue([
      { timestamp: '11:00:00', line: 'srv1 old line', source: '', outcome: '' },
    ])
    const { rerender } = renderHook(({ id }) => useConsoleSync(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(texts()).toContain('srv1 old line'))

    // Never resolves, so the state under assertion is the gap itself.
    vi.mocked(App.GetConsoleHistory).mockReturnValue(new Promise(() => {}))
    rerender({ id: 'srv2' })

    expect(texts()).toEqual([])
  })

  // A server with nothing on its ring is the case a "only replace when
  // non-empty" guard gets wrong, and it is the same guard usePerformanceHistory
  // had. The console must go empty, not keep the previous server's output.
  it('empties the console when the new server has no history', async () => {
    vi.mocked(App.GetConsoleHistory).mockResolvedValue([
      { timestamp: '11:00:00', line: 'srv1 old line', source: '', outcome: '' },
    ])
    const { rerender } = renderHook(({ id }) => useConsoleSync(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(texts()).toContain('srv1 old line'))

    vi.mocked(App.GetConsoleHistory).mockResolvedValue([])
    rerender({ id: 'srv2' })

    await waitFor(() => expect(texts()).toEqual([]))
  })
})

describe('performance history on switch', () => {
  const snap = (over: Record<string, number> = {}) => ({
    timestamp: 1,
    tps: 20,
    ramUsedMB: 100,
    ramTotalMB: 2048,
    cpuPercent: 5,
    players: 1,
    ...over,
  })

  it('ignores a stats snapshot from another server', async () => {
    vi.mocked(App.GetStatsHistory).mockResolvedValue([])
    const { result } = renderHook(() => usePerformanceHistory('srv1'))
    await waitFor(() => expect(App.GetStatsHistory).toHaveBeenCalledWith('srv1'))

    emit(EVENTS.STATS_SNAPSHOT, { ...snap({ tps: 3 }), serverID: 'srv2' })

    expect(result.current).toHaveLength(0)
  })

  it('keeps a stats snapshot from its own server', async () => {
    vi.mocked(App.GetStatsHistory).mockResolvedValue([])
    const { result } = renderHook(() => usePerformanceHistory('srv1'))
    await waitFor(() => expect(App.GetStatsHistory).toHaveBeenCalledWith('srv1'))

    emit(EVENTS.STATS_SNAPSHOT, { ...snap({ tps: 3 }), serverID: 'srv1' })

    await waitFor(() => expect(result.current).toHaveLength(1))
  })

  // The `if (h?.length)` guard this replaces meant a server with no history kept
  // the previous server's chart, which the unfiltered listener then appended to.
  it('clears the chart when the new server has no history', async () => {
    vi.mocked(App.GetStatsHistory).mockResolvedValue([snap()])
    const { result, rerender } = renderHook(({ id }) => usePerformanceHistory(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(result.current).toHaveLength(1))

    vi.mocked(App.GetStatsHistory).mockResolvedValue([])
    rerender({ id: 'srv2' })

    await waitFor(() => expect(result.current).toHaveLength(0))
  })
})

describe('player roster on switch', () => {
  it('does not refetch for a player event on another server', async () => {
    vi.mocked(App.GetPlayerRoster).mockResolvedValue([])
    renderHook(() => usePlayers('srv1'))
    await waitFor(() => expect(App.GetPlayerRoster).toHaveBeenCalledTimes(1))

    emit(EVENTS.PLAYER_JOINED, { name: 'Alex', ip: '127.0.0.1', serverID: 'srv2' })

    expect(App.GetPlayerRoster).toHaveBeenCalledTimes(1)
  })

  it('refetches for a player event on its own server', async () => {
    vi.mocked(App.GetPlayerRoster).mockResolvedValue([])
    renderHook(() => usePlayers('srv1'))
    await waitFor(() => expect(App.GetPlayerRoster).toHaveBeenCalledTimes(1))

    emit(EVENTS.PLAYER_JOINED, { name: 'Alex', ip: '127.0.0.1', serverID: 'srv1' })

    await waitFor(() => expect(App.GetPlayerRoster).toHaveBeenCalledTimes(2))
  })
})

describe('worlds on switch', () => {
  // useWorlds reads the selection from the config store rather than taking
  // an id, so the store is the fixture. Found by lib/serverScoping.test.ts
  // (#237): the two listeners refreshed unfiltered, so a stop or a backup on
  // any server rescanned this one's worlds.
  beforeEach(() => {
    useServerConfigStore.setState({ activeId: 'srv1' })
    vi.mocked(App.ListWorlds).mockResolvedValue([])
  })

  it('does not rescan for a lifecycle event on another server', async () => {
    renderHook(() => useWorlds())
    await waitFor(() => expect(App.ListWorlds).toHaveBeenCalledTimes(1))

    emit(EVENTS.SERVER_STOPPED, { serverID: 'srv2', expected: true })
    emit(EVENTS.BACKUP_COMPLETED, { serverID: 'srv2' })

    expect(App.ListWorlds).toHaveBeenCalledTimes(1)
  })

  it('rescans for a lifecycle event on its own server', async () => {
    renderHook(() => useWorlds())
    await waitFor(() => expect(App.ListWorlds).toHaveBeenCalledTimes(1))

    emit(EVENTS.BACKUP_COMPLETED, { serverID: 'srv1' })

    await waitFor(() => expect(App.ListWorlds).toHaveBeenCalledTimes(2))
  })
})

describe('config editor on switch', () => {
  const file = (relPath: string): ConfigFile => ({
    relPath,
    name: relPath,
    category: 'server',
    source: '',
    format: 'properties',
    sizeBytes: 1,
    modified: 0,
  })

  // FileList listed the tree on an empty dependency array, so after a switch it
  // showed the previous server's files while selectFile and save, which close
  // over the current id, read and wrote the new one.
  it('relists the tree for the new server', async () => {
    vi.mocked(App.ListConfigFiles).mockResolvedValue([file('server.properties')])
    const { rerender } = renderHook(({ id }) => useConfigEditor(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(App.ListConfigFiles).toHaveBeenCalledWith('srv1'))

    rerender({ id: 'srv2' })

    await waitFor(() => expect(App.ListConfigFiles).toHaveBeenCalledWith('srv2'))
  })

  // A relPath only means something against the tree it came from. Keeping the
  // selection would show one server's file contents under another's list.
  it('drops the open file on switch', async () => {
    vi.mocked(App.ListConfigFiles).mockResolvedValue([file('server.properties')])
    vi.mocked(App.ReadConfigFile).mockResolvedValue('motd=one')
    const { result, rerender } = renderHook(({ id }) => useConfigEditor(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(result.current.files).toHaveLength(1))

    await act(async () => {
      await result.current.selectFile('server.properties')
    })
    expect(result.current.selectedRelPath).toBe('server.properties')
    expect(result.current.content).toBe('motd=one')

    rerender({ id: 'srv2' })

    await waitFor(() => expect(result.current.selectedRelPath).toBeNull())
    expect(result.current.content).toBe('')
  })
})
