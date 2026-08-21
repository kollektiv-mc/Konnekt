import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import type { models } from '../../../wailsjs/go/models'
import { EVENTS } from '../../lib/constants'
import { usePlayers } from './usePlayers'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

function player(name: string, online = true): models.Player {
  return {
    name,
    uuid: `uuid-${name}`,
    online,
    ip: '',
    lastOnline: 0,
    opLevel: 0,
    whitelisted: false,
    banned: false,
    banReason: '',
    primaryGroup: '',
    groups: [],
  } as unknown as models.Player
}

// The hook owns roster lifecycle: one fetch per server, then refetch driven by
// Wails events rather than an interval (agent_docs/HEALTH_CHECKLIST.md, Stable).
describe('usePlayers', () => {
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
    vi.mocked(App.GetPlayerRoster).mockResolvedValue([player('Steve')])
  })

  it('fetches the roster once on mount', async () => {
    const { result } = renderHook(() => usePlayers('srv1'))

    await waitFor(() => expect(result.current.players).toEqual([player('Steve')]))
    expect(App.GetPlayerRoster).toHaveBeenCalledTimes(1)
    expect(App.GetPlayerRoster).toHaveBeenCalledWith('srv1')
  })

  it.each([
    ['player joined', EVENTS.PLAYER_JOINED],
    ['player left', EVENTS.PLAYER_LEFT],
    ['server started', EVENTS.SERVER_STARTED],
    ['server stopped', EVENTS.SERVER_STOPPED],
  ])('refetches on %s', async (_label, event) => {
    const { result } = renderHook(() => usePlayers('srv1'))
    await waitFor(() => expect(result.current.players).toHaveLength(1))

    vi.mocked(App.GetPlayerRoster).mockResolvedValue([player('Steve'), player('Alex')])
    await act(async () => {
      handlers[event]?.()
    })

    await waitFor(() => expect(result.current.players).toHaveLength(2))
  })

  it('does not poll on an interval', async () => {
    vi.useFakeTimers()
    try {
      renderHook(() => usePlayers('srv1'))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(App.GetPlayerRoster).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // Keeping the roster but dropping `reachable` is the point: an unreachable
  // server used to render "No players online", identical to a server nobody is
  // on (HEALTH_LOG.md, 2026-08-20).
  it('keeps the last known roster but marks the server unreachable when the call fails', async () => {
    const { result } = renderHook(() => usePlayers('srv1'))
    await waitFor(() => expect(result.current.players).toHaveLength(1))
    expect(result.current.reachable).toBe(true)

    vi.mocked(App.GetPlayerRoster).mockRejectedValue(new Error('server unreachable'))
    await act(async () => {
      handlers[EVENTS.PLAYER_LEFT]?.()
    })

    expect(result.current.players).toEqual([player('Steve')])
    expect(result.current.reachable).toBe(false)
  })

  it('marks the server reachable again once a later fetch succeeds', async () => {
    vi.mocked(App.GetPlayerRoster).mockRejectedValue(new Error('server unreachable'))
    const { result } = renderHook(() => usePlayers('srv1'))
    await waitFor(() => expect(result.current.reachable).toBe(false))

    vi.mocked(App.GetPlayerRoster).mockResolvedValue([player('Steve')])
    await act(async () => {
      handlers[EVENTS.SERVER_STARTED]?.()
    })

    await waitFor(() => expect(result.current.reachable).toBe(true))
    expect(result.current.players).toEqual([player('Steve')])
  })

  it('unsubscribes every listener on unmount', async () => {
    const { unmount } = renderHook(() => usePlayers('srv1'))
    await waitFor(() => expect(EventsOn).toHaveBeenCalledTimes(4))

    unmount()
    expect(off).toHaveBeenCalledTimes(4)
  })

  it('refetches when the server changes', async () => {
    const { rerender } = renderHook(({ id }) => usePlayers(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(App.GetPlayerRoster).toHaveBeenCalledWith('srv1'))

    rerender({ id: 'srv2' })
    await waitFor(() => expect(App.GetPlayerRoster).toHaveBeenCalledWith('srv2'))
  })
})
