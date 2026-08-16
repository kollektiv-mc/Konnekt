import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'
import { useNotificationsStore } from '../stores/useNotificationsStore'
import { useUpdateCheck, isDevBuild } from './useUpdateCheck'

vi.mock('../../wailsjs/go/main/App')

describe('isDevBuild', () => {
  it('flags a -dev suffix', () => {
    expect(isDevBuild('0.1.0-dev')).toBe(true)
  })

  it('does not flag a release version', () => {
    expect(isDevBuild('0.1.0')).toBe(false)
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
