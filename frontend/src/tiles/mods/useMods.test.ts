import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useMods } from './useMods'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

// A jar copied into mods/ or plugins/ outside the app fires no event, so the
// tile has to ask. These are the two moments it asks at — mount, and the window
// regaining focus after the user dropped the file in — plus the guarantee that
// asking can fail without taking anything down (#52).
// Vitest runs with `globals: false`, so RTL cannot register its own
// auto-cleanup. It matters more than usual here: a hook left mounted keeps its
// window focus listener, and the next test's focus event would reach both.
afterEach(cleanup)

describe('useMods folder rescan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.ModListInstalled).mockResolvedValue([])
    vi.mocked(App.ModCheckUpdates).mockResolvedValue([])
    vi.mocked(App.ModCategories).mockResolvedValue([])
    vi.mocked(App.ModRescan).mockResolvedValue(undefined)
  })

  it('asks the backend to look when the tile mounts', async () => {
    renderHook(() => useMods('srv1'))
    await waitFor(() => expect(App.ModRescan).toHaveBeenCalledWith('srv1'))
  })

  it('asks again when the window regains focus', async () => {
    renderHook(() => useMods('srv1'))
    await waitFor(() => expect(App.ModRescan).toHaveBeenCalledTimes(1))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(App.ModRescan).toHaveBeenCalledTimes(2))
  })

  it('stops asking once the tile unmounts', async () => {
    const { unmount } = renderHook(() => useMods('srv1'))
    await waitFor(() => expect(App.ModRescan).toHaveBeenCalledTimes(1))

    unmount()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(App.ModRescan).toHaveBeenCalledTimes(1)
  })

  it('does not ask about a server that has not been chosen yet', () => {
    renderHook(() => useMods(''))
    expect(App.ModRescan).not.toHaveBeenCalled()
  })

  it('survives a rescan that fails', async () => {
    // Offline, or the browser-only preview with no Wails bridge. A rescan is a
    // refresh: failing it costs freshness, and the next focus tries again.
    vi.mocked(App.ModRescan).mockRejectedValue(new Error('network unreachable'))
    const { result } = renderHook(() => useMods('srv1'))

    await waitFor(() => expect(App.ModRescan).toHaveBeenCalled())
    expect(result.current.installedError).toBeNull()
  })
})
