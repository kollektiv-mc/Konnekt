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

// A failed version lookup and a mod with no build for this server both left
// `versions` empty, so the panel rendered "No compatible versions found." for
// each — and the rejection escaped unhandled. They are different answers, and
// telling them apart is what made a server described with a bogus Minecraft
// version diagnosable instead of just quiet.
describe('useMods version lookups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.ModListInstalled).mockResolvedValue([])
    vi.mocked(App.ModCheckUpdates).mockResolvedValue([])
    vi.mocked(App.ModCategories).mockResolvedValue([])
    vi.mocked(App.ModRescan).mockResolvedValue(undefined)
  })

  it('records why a version lookup failed instead of reporting no versions', async () => {
    vi.mocked(App.ModGetVersions).mockRejectedValue(new Error('modrinth: HTTP 429'))
    const { result } = renderHook(() => useMods('srv1'))

    await act(async () => {
      await result.current.getVersions('AABBCCDD')
    })

    expect(result.current.versions).toEqual([])
    expect(result.current.versionsError).toContain('429')
    expect(result.current.versionsLoading).toBe(false)
  })

  it('leaves no error behind when a project genuinely has no matching build', async () => {
    vi.mocked(App.ModGetVersions).mockResolvedValue([])
    const { result } = renderHook(() => useMods('srv1'))

    await act(async () => {
      await result.current.getVersions('AABBCCDD')
    })

    expect(result.current.versions).toEqual([])
    expect(result.current.versionsError).toBeNull()
  })

  it('clears a stale error when the unfiltered list is asked for', async () => {
    vi.mocked(App.ModGetVersions).mockRejectedValue(new Error('modrinth: HTTP 429'))
    vi.mocked(App.ModGetAllVersions).mockResolvedValue([])
    const { result } = renderHook(() => useMods('srv1'))

    await act(async () => {
      await result.current.getVersions('AABBCCDD')
    })
    expect(result.current.versionsError).not.toBeNull()

    await act(async () => {
      await result.current.getAllVersions('AABBCCDD')
    })
    expect(result.current.versionsError).toBeNull()
  })
})

// Switching a mod's version starts with a dependency check, and Modrinth
// answers 429 often enough to matter. A rejection here used to reach an empty
// catch in ModPreviewDialog with nothing recorded anywhere: the Switch button
// did nothing, stayed enabled, and did nothing again on the next click.
describe('useMods dependency resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.ModListInstalled).mockResolvedValue([])
    vi.mocked(App.ModCheckUpdates).mockResolvedValue([])
    vi.mocked(App.ModCategories).mockResolvedValue([])
    vi.mocked(App.ModRescan).mockResolvedValue(undefined)
  })

  it('records why a dependency check failed, and still rethrows', async () => {
    vi.mocked(App.ModResolveDependencies).mockRejectedValue(new Error('modrinth: HTTP 429'))
    const { result } = renderHook(() => useMods('srv1'))

    await act(async () => {
      await expect(result.current.resolveDeps('ver2')).rejects.toThrow('429')
    })

    expect(result.current.installError).toContain('429')
  })

  it('clears a stale error when the check is retried and works', async () => {
    vi.mocked(App.ModResolveDependencies).mockRejectedValueOnce(new Error('modrinth: HTTP 429'))
    vi.mocked(App.ModResolveDependencies).mockResolvedValue([])
    const { result } = renderHook(() => useMods('srv1'))

    await act(async () => {
      await expect(result.current.resolveDeps('ver2')).rejects.toThrow()
    })
    expect(result.current.installError).not.toBeNull()

    await act(async () => {
      expect(await result.current.resolveDeps('ver2')).toEqual([])
    })
    expect(result.current.installError).toBeNull()
  })
})

// The switch itself is one call: ModInstall replaces the file the new version
// supersedes. It used to be three — install, list, uninstall the old file by
// name — and the last two were skipped whenever the lookup in between came back
// empty, which is how two jars of one mod ended up in mods/.
describe('useMods version switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.ModListInstalled).mockResolvedValue([])
    vi.mocked(App.ModCheckUpdates).mockResolvedValue([])
    vi.mocked(App.ModCategories).mockResolvedValue([])
    vi.mocked(App.ModRescan).mockResolvedValue(undefined)
    vi.mocked(App.ModInstall).mockResolvedValue(undefined)
  })

  it('installs the new version and leaves the old file to the backend', async () => {
    const { result } = renderHook(() => useMods('srv1'))

    await act(async () => {
      await result.current.changeVersion('EssentialsX-2.21.0.jar', 'ver2')
    })

    expect(App.ModInstall).toHaveBeenCalledWith('srv1', ['ver2'])
    expect(App.ModUninstall).not.toHaveBeenCalled()
    expect(result.current.installError).toBeNull()
  })

  it('records a failed switch and rethrows so the dialog stays open', async () => {
    vi.mocked(App.ModInstall).mockRejectedValue(new Error('sha512 mismatch'))
    const { result } = renderHook(() => useMods('srv1'))

    await act(async () => {
      await expect(result.current.changeVersion('EssentialsX-2.21.0.jar', 'ver2')).rejects.toThrow(
        'sha512 mismatch',
      )
    })

    expect(result.current.installError).toContain('sha512 mismatch')
    expect(result.current.installing).toBe(false)
  })
})
