import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'
import { useNotificationsStore } from '../stores/useNotificationsStore'
import { useUpdateCheck, isDevBuild, isSnapshotVersion } from './useUpdateCheck'

vi.mock('../../wailsjs/go/main/App')

describe('isSnapshotVersion', () => {
  it('flags the stamp snapshot.yml writes', () => {
    expect(isSnapshotVersion('0.1.0-snapshot.202608290400.abc1234')).toBe(true)
  })

  it('does not flag a release or a dev build', () => {
    expect(isSnapshotVersion('0.1.0')).toBe(false)
    expect(isSnapshotVersion('0.1.0-dev')).toBe(false)
  })
})

describe('isDevBuild', () => {
  it('flags a -dev suffix', () => {
    expect(isDevBuild('0.1.0-dev')).toBe(true)
  })

  it('does not flag a release version', () => {
    expect(isDevBuild('0.1.0')).toBe(false)
  })

  // The regression pin for the whole change: a snapshot must not read as a dev
  // build, or it goes back to being unable to check for or install anything.
  it('does not flag a snapshot build', () => {
    expect(isDevBuild('0.1.0-snapshot.202608290400.abc1234')).toBe(false)
  })

  // The pre-2026-08 stamp stays classified as a dev build. Those binaries run
  // the old code and cannot self-update whatever this says.
  it('still flags the pre-2026-08 snapshot stamp', () => {
    expect(isDevBuild('0.1.0-dev.snapshot.00400f8')).toBe(true)
  })
})

describe('useUpdateCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNotificationsStore.setState({ items: [] })
  })

  it('does nothing when disabled', async () => {
    renderHook(() => useUpdateCheck(false))
    await new Promise((r) => setTimeout(r, 0))
    expect(App.GetAppVersion).not.toHaveBeenCalled()
    expect(App.CheckForUpdates).not.toHaveBeenCalled()
  })

  it('skips CheckForUpdates entirely on a -dev build', async () => {
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0-dev')
    renderHook(() => useUpdateCheck(true))
    await waitFor(() => expect(App.GetAppVersion).toHaveBeenCalledTimes(1))
    expect(App.CheckForUpdates).not.toHaveBeenCalled()
  })

  it('notifies when an update is available on a release build', async () => {
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0')
    vi.mocked(App.CheckForUpdates).mockResolvedValue({
      currentVersion: '0.1.0',
      latestVersion: 'v0.2.0',
      updateAvailable: true,
      releaseUrl: 'https://example.com',
      releaseNotes: '',
      publishedAt: '',
      assets: [],
    } as unknown as models.UpdateInfo)
    renderHook(() => useUpdateCheck(true))
    await waitFor(() => expect(useNotificationsStore.getState().items).toHaveLength(1))
    expect(useNotificationsStore.getState().items[0]).toMatchObject({
      kind: 'info',
      text: expect.stringContaining('v0.2.0'),
    })
  })

  it('checks for updates on a snapshot build', async () => {
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0-snapshot.202608280400.aaaaaaa')
    vi.mocked(App.CheckForUpdates).mockResolvedValue({
      currentVersion: '0.1.0-snapshot.202608280400.aaaaaaa',
      latestVersion: '0.1.0-snapshot.202608290400.bbbbbbb',
      updateAvailable: true,
      channel: 'snapshot',
      releaseUrl: 'https://example.com',
      releaseNotes: '',
      publishedAt: '',
      assets: [],
    } as unknown as models.UpdateInfo)
    renderHook(() => useUpdateCheck(true))
    await waitFor(() => expect(App.CheckForUpdates).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useNotificationsStore.getState().items).toHaveLength(1))
    expect(useNotificationsStore.getState().items[0]).toMatchObject({
      kind: 'info',
      text: expect.stringContaining('Snapshot update available'),
    })
  })

  it('does not notify when already up to date', async () => {
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0')
    vi.mocked(App.CheckForUpdates).mockResolvedValue({
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      updateAvailable: false,
      releaseUrl: '',
      releaseNotes: '',
      publishedAt: '',
      assets: [],
    } as unknown as models.UpdateInfo)
    renderHook(() => useUpdateCheck(true))
    await waitFor(() => expect(App.CheckForUpdates).toHaveBeenCalledTimes(1))
    expect(useNotificationsStore.getState().items).toHaveLength(0)
  })

  it('checks only once even if the enabled flag stays true across re-renders', async () => {
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0-dev')
    const { rerender } = renderHook(() => useUpdateCheck(true))
    await waitFor(() => expect(App.GetAppVersion).toHaveBeenCalledTimes(1))
    rerender()
    rerender()
    await new Promise((r) => setTimeout(r, 0))
    expect(App.GetAppVersion).toHaveBeenCalledTimes(1)
  })

  it('fails silently when CheckForUpdates rejects', async () => {
    vi.mocked(App.GetAppVersion).mockResolvedValue('0.1.0')
    vi.mocked(App.CheckForUpdates).mockRejectedValue(new Error('offline'))
    renderHook(() => useUpdateCheck(true))
    await waitFor(() => expect(App.CheckForUpdates).toHaveBeenCalledTimes(1))
    expect(useNotificationsStore.getState().items).toHaveLength(0)
  })
})
