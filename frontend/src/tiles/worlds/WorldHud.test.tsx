import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { WorldHud } from './WorldHud'
import type { WorldSystem } from './useWorlds'
import type { WorldBackup } from './useWorldBackups'
import { isRemoteBrowser } from '../../lib/ipc'
import { useServerStore } from '../../stores/useServerStore'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ipc')>()),
  isRemoteBrowser: vi.fn(() => false),
}))

afterEach(() => {
  cleanup()
  vi.mocked(isRemoteBrowser).mockReturnValue(false)
  useServerStore.getState().reset()
})

const world = {
  name: 'world',
  active: true,
  dimensions: [],
  meta: {},
} as unknown as WorldSystem

const backup = (filename: string, world: string, displayName = ''): WorldBackup =>
  ({
    filename,
    createdAt: Date.UTC(2026, 0, 1),
    sizeBytes: 2048,
    displayName,
    tags: [],
    kind: 'world',
    world,
  }) as WorldBackup

const renderHud = (
  backups: WorldBackup[] = [],
  handlers: { restore?: () => Promise<void>; remove?: () => Promise<void> } = {},
) =>
  render(
    <WorldHud
      world={world}
      dimension="overworld"
      onClose={() => {}}
      onSetActive={async () => {}}
      onDelete={async () => {}}
      onRename={async () => {}}
      onDuplicate={async () => {}}
      onOpenFolder={async () => {}}
      onBackup={async () => {}}
      backups={backups}
      onRestoreBackup={handlers.restore ?? (async () => {})}
      onDeleteBackup={handlers.remove ?? (async () => {})}
      onRefresh={() => {}}
    />,
  )

describe('WorldHud open folder', () => {
  it('offers open folder on the desktop', () => {
    renderHud()
    expect(screen.getByRole('button', { name: 'open folder' })).toBeTruthy()
  })

  it('does not offer open folder in a remote browser', () => {
    vi.mocked(isRemoteBrowser).mockReturnValue(true)
    renderHud()
    expect(screen.queryByRole('button', { name: 'open folder' })).toBeNull()
    expect(screen.getByRole('button', { name: 'backup' })).toBeTruthy()
  })
})

describe('WorldHud backups', () => {
  const four = [
    backup('1.zip', 'world', 'Before the update'),
    backup('2.zip', 'world'),
    backup('3.zip', 'world'),
    backup('4.zip', 'world'),
    backup('other.zip', 'Nether'),
  ]

  it('says so when the world has no backups', () => {
    renderHud([backup('other.zip', 'Nether')])
    expect(screen.getByText('No backups of this world yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'restore' })).toBeNull()
  })

  it('lists at most three of the world backups and counts the rest', () => {
    renderHud(four)
    expect(screen.getAllByRole('button', { name: 'restore' })).toHaveLength(3)
    expect(screen.getByText('Before the update')).toBeTruthy()
    expect(screen.getByText('+1 more in the Backups tile')).toBeTruthy()
  })

  it('shows no count when everything fits', () => {
    renderHud(four.slice(0, 3))
    expect(screen.queryByText(/more in the Backups tile/)).toBeNull()
  })

  it('asks before restoring, then calls the handler with the filename', async () => {
    const restore = vi.fn(async () => {})
    renderHud(four, { restore })

    fireEvent.click(screen.getAllByRole('button', { name: 'restore' })[0])
    expect(restore).not.toHaveBeenCalled()
    expect(screen.getByText('Replace the current world with this backup?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'yes, restore' }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith('1.zip'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'yes, restore' })).toBeNull())
  })

  it('cancelling the restore confirm calls nothing', () => {
    const restore = vi.fn(async () => {})
    renderHud(four, { restore })

    fireEvent.click(screen.getAllByRole('button', { name: 'restore' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(restore).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'restore' })).toHaveLength(3)
  })

  it('disables restore while the server is running', () => {
    useServerStore.setState({ status: { ...useServerStore.getState().status, running: true } })
    renderHud(four)

    const buttons = screen.getAllByRole('button', { name: 'restore' }) as HTMLButtonElement[]
    for (const b of buttons) {
      expect(b.disabled).toBe(true)
      expect(b.title).toBe('Stop the server before restoring a backup')
    }
  })

  it('asks before deleting, then calls the handler with the filename', async () => {
    const remove = vi.fn(async () => {})
    renderHud(four, { remove })

    const row = screen.getByText('Before the update').closest('div')?.parentElement as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'delete' }))
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'yes, delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('1.zip'))
  })

  it('shows the error when a restore is refused', async () => {
    const restore = vi.fn(async () => {
      throw new Error('stop the server before restoring a backup')
    })
    renderHud(four, { restore })

    fireEvent.click(screen.getAllByRole('button', { name: 'restore' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'yes, restore' }))

    expect(await screen.findByText(/stop the server before restoring a backup/)).toBeTruthy()
  })
})
