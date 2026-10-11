import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { EVENTS } from '../../lib/constants'
import { useWorldBackups, backupsOfWorld } from './useWorldBackups'
import type { WorldBackup } from './useWorldBackups'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

const backup = (filename: string, kind: string, world?: string): WorldBackup =>
  ({
    filename,
    createdAt: 1,
    sizeBytes: 10,
    displayName: '',
    tags: [],
    kind,
    world,
  }) as WorldBackup

const LIST = [
  backup('a.zip', 'world', 'Overworld'),
  backup('b.zip', 'server'),
  backup('c.zip', 'world', 'Nether'),
  backup('d.zip', 'world', 'Overworld'),
]

let handlers: Record<string, (...data: unknown[]) => void>

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
  vi.mocked(App.ListBackups).mockResolvedValue(LIST)
})

describe('useWorldBackups', () => {
  it('keeps world backups only and filters them by world', async () => {
    const { result } = renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(result.current.backups).toHaveLength(3))

    expect(App.ListBackups).toHaveBeenCalledWith('srv1')
    expect(backupsOfWorld(result.current.backups, 'Overworld').map((b) => b.filename)).toEqual([
      'a.zip',
      'd.zip',
    ])
    expect(backupsOfWorld(result.current.backups, 'Nether')).toHaveLength(1)
    expect(backupsOfWorld(result.current.backups, 'Nope')).toEqual([])
  })

  it.each([
    EVENTS.BACKUP_COMPLETED,
    EVENTS.BACKUP_FAILED,
    EVENTS.RESTORE_COMPLETED,
    EVENTS.RESTORE_FAILED,
  ])('refetches on %s for its own server', async (event) => {
    renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(1))

    emit(event, { serverID: 'srv1' })

    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(2))
  })

  it.each([
    EVENTS.BACKUP_COMPLETED,
    EVENTS.BACKUP_FAILED,
    EVENTS.RESTORE_COMPLETED,
    EVENTS.RESTORE_FAILED,
  ])('ignores %s for another server', async (event) => {
    renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(1))

    emit(event, { serverID: 'srv2' })

    expect(App.ListBackups).toHaveBeenCalledTimes(1)
  })

  it('refetches for an event that names no server', async () => {
    renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(1))

    emit(EVENTS.BACKUP_COMPLETED, {})

    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(2))
  })

  it('restore calls the binding and refetches', async () => {
    vi.mocked(App.RestoreBackup).mockResolvedValue(undefined)
    const { result } = renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(result.current.backups).toHaveLength(3))

    await act(async () => {
      await result.current.restore('a.zip')
    })

    expect(App.RestoreBackup).toHaveBeenCalledWith('srv1', 'a.zip')
    expect(App.ListBackups).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
  })

  it('remove calls the binding and refetches', async () => {
    vi.mocked(App.DeleteBackup).mockResolvedValue(undefined)
    const { result } = renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(result.current.backups).toHaveLength(3))

    await act(async () => {
      await result.current.remove('a.zip')
    })

    expect(App.DeleteBackup).toHaveBeenCalledWith('srv1', 'a.zip')
    expect(App.ListBackups).toHaveBeenCalledTimes(2)
  })

  it('records a failed restore and rethrows it', async () => {
    vi.mocked(App.RestoreBackup).mockRejectedValue('stop the server before restoring a backup')
    const { result } = renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(result.current.backups).toHaveLength(3))

    await act(async () => {
      await expect(result.current.restore('a.zip')).rejects.toBe(
        'stop the server before restoring a backup',
      )
    })

    expect(result.current.error).toBe('stop the server before restoring a backup')
    expect(App.ListBackups).toHaveBeenCalledTimes(1)
  })

  it('records a failed delete and rethrows it', async () => {
    vi.mocked(App.DeleteBackup).mockRejectedValue('disk is read-only')
    const { result } = renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(result.current.backups).toHaveLength(3))

    await act(async () => {
      await expect(result.current.remove('a.zip')).rejects.toBe('disk is read-only')
    })

    expect(result.current.error).toBe('disk is read-only')
  })

  it('keeps the list when a refetch fails', async () => {
    const { result } = renderHook(() => useWorldBackups('srv1'))
    await waitFor(() => expect(result.current.backups).toHaveLength(3))

    vi.mocked(App.ListBackups).mockRejectedValue(new Error('boom'))
    emit(EVENTS.BACKUP_COMPLETED, { serverID: 'srv1' })
    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(2))

    expect(result.current.backups).toHaveLength(3)
  })
})
