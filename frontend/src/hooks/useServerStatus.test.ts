import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useServerStore } from '../stores/useServerStore'
import { EVENTS } from '../lib/constants'
import type { ServerStatus } from '../types'
import { useServerStatusSync } from './useServerStatus'

vi.mock('../../wailsjs/go/main/App')
vi.mock('../../wailsjs/runtime/runtime')

function status(over: Partial<ServerStatus> = {}): ServerStatus {
  return {
    running: true,
    state: 'running',
    serverId: 'srv1',
    uptime: '1m 0s',
    players: 2,
    maxPlayers: 20,
    tps: 19.8,
    ramUsed: 512,
    ramTotal: 2048,
    ...over,
  }
}

const OFFLINE = status({
  running: false,
  state: 'offline',
  uptime: '0s',
  players: 0,
  tps: 0,
  ramUsed: 0,
})

const stored = () => useServerStore.getState().status

// The hook owns status lifecycle: one fetch per server, then updates driven by
// Wails events rather than an interval (agent_docs/HEALTH_CHECKLIST.md, Stable).
// It writes into useServerStore and returns nothing — App mounts it once and
// every consumer selects from the store, so the assertions here read the store.
describe('useServerStatusSync', () => {
  let handlers: Record<string, (...data: unknown[]) => void>
  let off: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    off = vi.fn()
    vi.mocked(EventsOn).mockImplementation((name: string, cb: (...data: unknown[]) => void) => {
      handlers[name] = cb
      return off
    })
    vi.mocked(App.GetServerStatus).mockResolvedValue(status())
    useServerStore.setState({ status: OFFLINE, reachable: true })
  })

  it('fetches status once on mount', async () => {
    renderHook(() => useServerStatusSync('srv1'))

    await waitFor(() => expect(stored().running).toBe(true))
    expect(App.GetServerStatus).toHaveBeenCalledTimes(1)
    expect(App.GetServerStatus).toHaveBeenCalledWith('srv1')
  })

  // The whole point of the event: it carries the full struct, so a push needs no
  // follow-up binding call. stats:snapshot could not do this — it has no
  // running/uptime/maxPlayers and never fires while the server is stopped.
  it('applies a server:status push without refetching', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(1))

    await act(async () => {
      handlers[EVENTS.SERVER_STATUS]?.(status({ uptime: '5m 0s', players: 7 }))
    })

    expect(stored().uptime).toBe('5m 0s')
    expect(stored().players).toBe(7)
    expect(App.GetServerStatus).toHaveBeenCalledTimes(1)
  })

  it('reports the server going offline', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(stored().running).toBe(true))

    await act(async () => {
      handlers[EVENTS.SERVER_STATUS]?.(OFFLINE)
    })

    expect(stored().running).toBe(false)
    expect(useServerStore.getState().reachable).toBe(true)
  })

  // The phase event carries everything it announces, so it merges into the
  // stored status directly — no follow-up binding call, and the other fields
  // survive untouched.
  it('applies a server:state push without refetching', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(stored().running).toBe(true))

    await act(async () => {
      handlers[EVENTS.SERVER_STATE]?.({ state: 'stopping', timedOut: false })
    })

    expect(stored().state).toBe('stopping')
    expect(stored().uptime).toBe('1m 0s')
    expect(App.GetServerStatus).toHaveBeenCalledTimes(1)
    expect(useServerStore.getState().reachable).toBe(true)
  })

  it.each([
    ['server started', EVENTS.SERVER_STARTED],
    ['server stopped', EVENTS.SERVER_STOPPED],
  ])('refetches on %s', async (_label, event) => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(1))

    await act(async () => {
      handlers[event]?.()
    })

    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(2))
  })

  it('does not poll on an interval', async () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useServerStatusSync('srv1'))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(App.GetServerStatus).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // Keeping the numbers but dropping `reachable` is the point: a tile that
  // renders them has to be able to say they are stale rather than show an
  // unreachable server as a healthy one.
  it('keeps the last known status but marks the server unreachable when the call fails', async () => {
    renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(stored().running).toBe(true))

    vi.mocked(App.GetServerStatus).mockRejectedValue(new Error('server unreachable'))
    await act(async () => {
      handlers[EVENTS.SERVER_STARTED]?.()
    })

    await waitFor(() => expect(useServerStore.getState().reachable).toBe(false))
    expect(stored().running).toBe(true)
    expect(stored().uptime).toBe('1m 0s')
  })

  it('marks the server reachable again once a later call succeeds', async () => {
    useServerStore.setState({ reachable: false })
    renderHook(() => useServerStatusSync('srv1'))

    await waitFor(() => expect(useServerStore.getState().reachable).toBe(true))
  })

  it('unsubscribes every listener on unmount', async () => {
    const { unmount } = renderHook(() => useServerStatusSync('srv1'))
    await waitFor(() => expect(EventsOn).toHaveBeenCalledTimes(4))

    unmount()
    expect(off).toHaveBeenCalledTimes(4)
  })

  it('refetches when the server changes', async () => {
    const { rerender } = renderHook(({ id }) => useServerStatusSync(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(1))

    rerender({ id: 'srv2' })

    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledWith('srv2'))
  })
})
