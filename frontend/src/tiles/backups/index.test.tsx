import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { BackupsTile } from './index'
import { isRemoteBrowser } from '../../lib/ipc'
import * as App from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')
vi.mock('../../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ipc')>()),
  isRemoteBrowser: vi.fn(() => false),
}))
vi.mock('./useBackupWorlds', () => ({ useBackupWorlds: () => [] }))

function backup(over: Partial<models.Backup>): models.Backup {
  return {
    filename: '00001_01_01_26_000000.zip',
    createdAt: 1_700_000_000_000,
    sizeBytes: 1024,
    displayName: '',
    tags: [],
    kind: 'server',
    ...over,
  } as models.Backup
}

function world(name: string, active = false): models.WorldSystem {
  return { name, active } as models.WorldSystem
}

const SERVER = backup({ filename: '00010_a.zip', displayName: 'Nightly full', kind: 'server' })
const OVERWORLD_1 = backup({
  filename: '00020_a.zip',
  displayName: 'Before the raid',
  kind: 'world',
  world: 'Overworld',
})
const OVERWORLD_2 = backup({
  filename: '00021_a.zip',
  displayName: 'After the raid',
  kind: 'world',
  world: 'Overworld',
})
const CREATIVE = backup({
  filename: '00030_a.zip',
  displayName: 'Build plot',
  kind: 'world',
  world: 'Creative',
})

beforeEach(() => {
  vi.mocked(App.ListBackups).mockResolvedValue([SERVER, OVERWORLD_1, OVERWORLD_2, CREATIVE])
  vi.mocked(App.ListWorlds).mockResolvedValue([
    world('Overworld'),
    world('Creative'),
    world('Spare', true),
  ])
  vi.mocked(App.BackupWorld).mockResolvedValue(CREATIVE)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

// The list panel renders every row at all times (it slides, it does not mount),
// so a backup's name appearing there is how these assert what the view holds.
const shown = (name: string) => screen.queryAllByText(name).length > 0

async function openWorldView() {
  render(<BackupsTile serverId="s1" maximized />)
  await screen.findAllByText('Nightly full')
  fireEvent.click(screen.getByRole('button', { name: 'Worlds' }))
}

describe('BackupsTile server view', () => {
  it('lists only full-server backups', async () => {
    render(<BackupsTile serverId="s1" maximized />)
    await screen.findAllByText('Nightly full')
    expect(shown('Before the raid')).toBe(false)
    expect(shown('Build plot')).toBe(false)
    expect(screen.queryByRole('combobox', { name: 'Filter by world' })).toBeNull()
  })
})

describe('BackupsTile world view', () => {
  it('lists world backups, each carrying its world name, and no server ones', async () => {
    await openWorldView()
    await screen.findAllByText('Before the raid')
    expect(shown('After the raid')).toBe(true)
    expect(shown('Build plot')).toBe(true)
    expect(shown('Nightly full')).toBe(false)
    expect(screen.getAllByTitle('World backed up').length).toBeGreaterThan(0)
    expect(screen.getByText('3 world backups')).toBeTruthy()
    expect(screen.queryByText(/coming soon/)).toBeNull()
  })

  it('narrows to one world with the world filter', async () => {
    await openWorldView()
    await screen.findAllByText('Before the raid')

    const filter = screen.getByRole('listbox', { name: 'Filter by world' })
    expect(
      within(filter)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All worlds', 'Creative', 'Overworld'])

    fireEvent.click(within(filter).getByRole('option', { name: 'Creative' }))

    expect(shown('Build plot')).toBe(true)
    expect(shown('Before the raid')).toBe(false)
    expect(shown('After the raid')).toBe(false)
    expect(screen.getByText('1 world backup')).toBeTruthy()
  })

  it('searches by world name', async () => {
    await openWorldView()
    await screen.findAllByText('Before the raid')
    fireEvent.change(screen.getByPlaceholderText('Search by #tag, date, world, or ID'), {
      target: { value: 'creat' },
    })
    expect(shown('Build plot')).toBe(true)
    expect(shown('After the raid')).toBe(false)
  })

  it('backs up the active world by default', async () => {
    await openWorldView()
    await screen.findAllByText('Before the raid')
    await waitFor(() => expect(App.ListWorlds).toHaveBeenCalledWith('s1'))

    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }))
    await screen.findByRole('combobox', { name: 'World to back up' })
    fireEvent.click(screen.getByRole('button', { name: 'Back up' }))

    await waitFor(() => expect(App.BackupWorld).toHaveBeenCalledWith('s1', 'Spare'))
    expect(App.CreateBackup).not.toHaveBeenCalled()
  })

  it('defaults the picker to the world filter, and lets another world be chosen', async () => {
    await openWorldView()
    await screen.findAllByText('Before the raid')
    const filter = screen.getByRole('listbox', { name: 'Filter by world' })
    fireEvent.click(within(filter).getByRole('option', { name: 'Creative' }))

    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }))
    const picker = await screen.findByRole('combobox', { name: 'World to back up' })
    expect(picker.textContent).toContain('Creative')

    const list = screen.getByRole('listbox', { name: 'World to back up' })
    fireEvent.click(within(list).getByRole('option', { name: 'Overworld' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back up' }))

    await waitFor(() => expect(App.BackupWorld).toHaveBeenCalledWith('s1', 'Overworld'))
  })

  it('does not back anything up when the picker is cancelled', async () => {
    await openWorldView()
    await screen.findAllByText('Before the raid')
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }))
    await screen.findByRole('combobox', { name: 'World to back up' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('combobox', { name: 'World to back up' })).toBeNull()
    expect(App.BackupWorld).not.toHaveBeenCalled()
  })

  it('disables Back up now when the server has no worlds', async () => {
    vi.mocked(App.ListWorlds).mockResolvedValue([])
    await openWorldView()
    await screen.findAllByText('Before the raid')
    const button = screen.getByRole('button', { name: 'Back up now' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('names the world in the restore confirmation', async () => {
    await openWorldView()
    await screen.findAllByText('Before the raid')
    fireEvent.click(screen.getAllByRole('button', { name: 'restore' })[0])
    expect(
      screen.getByText(/This will replace your current "Overworld" world folder\./),
    ).toBeTruthy()
  })

  it('shows the empty state when there are no world backups', async () => {
    vi.mocked(App.ListBackups).mockResolvedValue([SERVER])
    await openWorldView()
    await screen.findByText(/No world backups yet/)
  })
})
