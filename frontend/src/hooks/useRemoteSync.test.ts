import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useRemoteStore } from '../stores/useRemoteStore'
import { EVENTS } from '../lib/constants'
import { isRemoteBrowser } from '../lib/ipc'
import { useRemoteSync } from './useRemoteSync'

vi.mock('../../wailsjs/runtime/runtime', () => ({ EventsOn: vi.fn() }))
vi.mock('../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ipc')>()),
  isRemoteBrowser: vi.fn(() => false),
}))

const refresh = vi.fn(() => Promise.resolve())

describe('useRemoteSync', () => {
  const off = vi.fn()
  let fire: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isRemoteBrowser).mockReturnValue(false)
    vi.mocked(EventsOn).mockImplementation((_name, cb) => {
      fire = cb as () => void
      return off
    })
    useRemoteStore.setState({ refresh })
  })

  it('reads the state once and subscribes to remote:changed on mount', () => {
    renderHook(() => useRemoteSync())
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(EventsOn).toHaveBeenCalledWith(EVENTS.REMOTE_CHANGED, expect.any(Function))
  })

  it('reads again when remote:changed arrives', () => {
    renderHook(() => useRemoteSync())
    fire()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useRemoteSync())
    expect(off).not.toHaveBeenCalled()
    unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('does nothing in a browser served by the listener', () => {
    vi.mocked(isRemoteBrowser).mockReturnValue(true)
    renderHook(() => useRemoteSync())
    expect(refresh).not.toHaveBeenCalled()
    expect(EventsOn).not.toHaveBeenCalled()
  })
})
