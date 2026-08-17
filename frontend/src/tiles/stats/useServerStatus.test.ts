import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { useServerStore } from '../../stores/useServerStore'
import { EVENTS } from '../../lib/constants'
import type { ServerStatus } from '../../types'
import { useServerStatus } from './useServerStatus'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

function status(over: Partial<ServerStatus> = {}): ServerStatus {
  return {
    running: true,
    uptime: '1m 0s',
    players: 2,
    maxPlayers: 20,
    tps: 19.8,
    ramUsed: 512,
    ramTotal: 2048,
    ...over,
  }
}

const OFFLINE = status({ running: false, uptime: '0s', players: 0, tps: 0, ramUsed: 0 })

// The hook owns status lifecycle: one fetch per server, then updates driven by
// Wails events rather than an interval (agent_docs/HEALTH_CHECKLIST.md, Stable).
describe('useServerStatus', () => {
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
    useServerStore.setState({ status: OFFLINE })
  })

  it('fetches status once on mount', async () => {
    const { result } = renderHook(() => useServerStatus('srv1'))

    await waitFor(() => expect(result.current.status.running).toBe(true))
    expect(App.GetServerStatus).toHaveBeenCalledTimes(1)
    expect(App.GetServerStatus).toHaveBeenCalledWith('srv1')
  })

  // The whole point of the event: it carries the full struct, so a push needs no
  // follow-up binding call. stats:snapshot could not do this — it has no
  // running/uptime/maxPlayers and never fires while the server is stopped.
  it('applies a server:status push without refetching', async () => {
    const { result } = renderHook(() => useServerStatus('srv1'))
    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(1))

    await act(async () => {
      handlers[EVENTS.SERVER_STATUS]?.(status({ uptime: '5m 0s', players: 7 }))
    })

    expect(result.current.status.uptime).toBe('5m 0s')
    expect(result.current.status.players).toBe(7)
    expect(App.GetServerStatus).toHaveBeenCalledTimes(1)
  })

  it('reports the server going offline', async () => {
    const { result } = renderHook(() => useServerStatus('srv1'))
    await waitFor(() => expect(result.current.status.running).toBe(true))

    await act(async () => {
      handlers[EVENTS.SERVER_STATUS]?.(OFFLINE)
    })

    expect(result.current.status.running).toBe(false)
  })

  it.each([
    ['server started', EVENTS.SERVER_STARTED],
    ['server stopped', EVENTS.SERVER_STOPPED],
  ])('refetches on %s', async (_label, event) => {
    renderHook(() => useServerStatus('srv1'))
    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(1))

    await act(async () => {
      handlers[event]?.()
    })

    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(2))
  })

  it('does not poll on an interval', async () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useServerStatus('srv1'))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(App.GetServerStatus).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last known status when the call fails', async () => {
    const { result } = renderHook(() => useServerStatus('srv1'))
    await waitFor(() => expect(result.current.status.running).toBe(true))

    vi.mocked(App.GetServerStatus).mockRejectedValue(new Error('server unreachable'))
    await act(async () => {
      handlers[EVENTS.SERVER_STARTED]?.()
    })

    expect(result.current.status.running).toBe(true)
    expect(result.current.status.uptime).toBe('1m 0s')
  })

  it('unsubscribes every listener on unmount', async () => {
    const { unmount } = renderHook(() => useServerStatus('srv1'))
    await waitFor(() => expect(EventsOn).toHaveBeenCalledTimes(3))

    unmount()
    expect(off).toHaveBeenCalledTimes(3)
  })

  it('refetches when the server changes', async () => {
    const { rerender } = renderHook(({ id }) => useServerStatus(id), {
      initialProps: { id: 'srv1' },
    })
    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledTimes(1))

    rerender({ id: 'srv2' })

    await waitFor(() => expect(App.GetServerStatus).toHaveBeenCalledWith('srv2'))
  })
})
