import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useBackups } from './useBackups'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(App.ListBackups).mockResolvedValue([])
})

describe('useBackups.createWorld', () => {
  it('backs up the named world on this server, then refetches the list', async () => {
    const { result } = renderHook(() => useBackups('srv1'))
    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(1))

    await act(() => result.current.createWorld('Overworld'))

    expect(App.BackupWorld).toHaveBeenCalledWith('srv1', 'Overworld')
    expect(App.CreateBackup).not.toHaveBeenCalled()
    expect(App.ListBackups).toHaveBeenCalledTimes(2)
    expect(result.current.creating).toBe(false)
    expect(result.current.actionError).toBeNull()
  })

  it('records a failure for the banner and clears the creating flag', async () => {
    vi.mocked(App.BackupWorld).mockRejectedValue(new Error('world folder "x" not found'))
    const { result } = renderHook(() => useBackups('srv1'))
    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(1))

    await act(() => result.current.createWorld('x'))

    expect(result.current.actionError).toContain('world folder "x" not found')
    expect(result.current.creating).toBe(false)
  })

  it('leaves the full-server create unchanged', async () => {
    const { result } = renderHook(() => useBackups('srv1'))
    await waitFor(() => expect(App.ListBackups).toHaveBeenCalledTimes(1))

    await act(() => result.current.create())

    expect(App.CreateBackup).toHaveBeenCalledWith('srv1')
    expect(App.BackupWorld).not.toHaveBeenCalled()
  })
})
