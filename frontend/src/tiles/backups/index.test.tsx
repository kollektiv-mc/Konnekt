import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BackupsTile } from './index'
import { isRemoteBrowser } from '../../lib/ipc'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')
vi.mock('../../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ipc')>()),
  isRemoteBrowser: vi.fn(() => false),
}))
vi.mock('./useBackups', () => ({
  useBackups: () => ({
    backups: [],
    loading: false,
    listError: null,
    creating: false,
    creatingFilename: null,
    actionError: null,
    refresh: vi.fn(),
    create: vi.fn(),
    restore: vi.fn(),
    remove: vi.fn(),
    updateMeta: vi.fn(),
    openDir: vi.fn(),
  }),
}))
vi.mock('./useBackupWorlds', () => ({ useBackupWorlds: () => [] }))

afterEach(() => {
  cleanup()
  vi.mocked(isRemoteBrowser).mockReturnValue(false)
})

describe('BackupsTile open backup folder', () => {
  it('offers the folder button on the desktop', () => {
    render(<BackupsTile serverId="s1" maximized />)
    expect(screen.getByTitle('Open backup folder')).toBeTruthy()
  })

  it('does not offer it in a remote browser', () => {
    vi.mocked(isRemoteBrowser).mockReturnValue(true)
    render(<BackupsTile serverId="s1" maximized />)
    expect(screen.queryByTitle('Open backup folder')).toBeNull()
    expect(screen.getByTitle('Set up scheduled backups in the Scheduler tile')).toBeTruthy()
  })
})
