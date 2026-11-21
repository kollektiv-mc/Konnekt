import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import * as Runtime from '../../../wailsjs/runtime/runtime'
import { models } from '../../../wailsjs/go/models'
import { EVENTS } from '../../lib/constants'
import { usePackSync } from './usePackSync'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

const source = models.PackSource.createFrom({
  serverID: 'srv1',
  format: 'packwiz',
  location: 'url',
  address: 'https://packs.example/frangfurd/pack.toml',
  exclude: [],
  include: [],
})

const plan = models.ModSyncPlan.createFrom({
  serverID: 'srv1',
  planId: 'p1',
  packName: 'Frangfurd',
  packVersion: '1.0.14',
  rows: [],
  blockers: [],
  warnings: [],
  added: 1,
  upToDate: false,
})

describe('usePackSync', () => {
  let listeners: Record<string, (d?: unknown) => void>

  beforeEach(() => {
    vi.clearAllMocks()
    listeners = {}
    vi.mocked(Runtime.EventsOn).mockImplementation((name, cb) => {
      listeners[name] = cb
      return () => delete listeners[name]
    })
    vi.mocked(App.ModSyncState).mockResolvedValue(
      models.ModSyncState.createFrom({ source, history: [] }),
    )
    vi.mocked(App.ModPlanSync).mockResolvedValue(plan)
    vi.mocked(App.ModApplySync).mockResolvedValue(plan)
    vi.mocked(App.ModSetPackSource).mockResolvedValue(undefined)
  })

  it('reads the bound source on mount', async () => {
    const { result } = renderHook(() => usePackSync('srv1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source?.address).toBe(source.address)
    expect(App.ModPlanSync).not.toHaveBeenCalled()
  })

  it('applies the plan id the person was shown', async () => {
    const { result } = renderHook(() => usePackSync('srv1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.check())
    expect(result.current.plan?.planId).toBe('p1')

    await act(() => result.current.apply())
    expect(App.ModApplySync).toHaveBeenCalledWith('srv1', 'p1')
    expect(result.current.plan).toBeNull()
  })

  it('keeps the plan and records why an apply was refused', async () => {
    vi.mocked(App.ModApplySync).mockRejectedValue(new Error('the pack changed; check again'))
    const { result } = renderHook(() => usePackSync('srv1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.check())

    await act(() => result.current.apply().catch(() => undefined))
    expect(result.current.error).toBe('the pack changed; check again')
    expect(result.current.plan?.planId).toBe('p1')
  })

  it('drops the plan when the source changes', async () => {
    const { result } = renderHook(() => usePackSync('srv1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.check())

    await act(() =>
      result.current.saveSource({
        location: 'url',
        address: source.address,
        exclude: ['fancymenu'],
        include: [],
      }),
    )
    expect(App.ModSetPackSource).toHaveBeenCalledWith(
      'srv1',
      expect.objectContaining({ serverID: 'srv1', exclude: ['fancymenu'] }),
    )
    expect(result.current.plan).toBeNull()
  })

  it("re-reads on its own server's sync event only", async () => {
    renderHook(() => usePackSync('srv1'))
    await waitFor(() => expect(App.ModSyncState).toHaveBeenCalledTimes(1))

    act(() => listeners[EVENTS.MOD_SYNC_CHANGED]?.({ serverID: 'other' }))
    expect(App.ModSyncState).toHaveBeenCalledTimes(1)
    act(() => listeners[EVENTS.MOD_SYNC_CHANGED]?.({ serverID: 'srv1' }))
    await waitFor(() => expect(App.ModSyncState).toHaveBeenCalledTimes(2))
  })
})
