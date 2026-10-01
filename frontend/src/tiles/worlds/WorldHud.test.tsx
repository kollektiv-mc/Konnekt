import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WorldHud } from './WorldHud'
import type { WorldSystem } from './useWorlds'
import { isRemoteBrowser } from '../../lib/ipc'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ipc')>()),
  isRemoteBrowser: vi.fn(() => false),
}))

afterEach(() => {
  cleanup()
  vi.mocked(isRemoteBrowser).mockReturnValue(false)
})

const world = {
  name: 'world',
  active: true,
  dimensions: [],
  meta: {},
} as unknown as WorldSystem

const renderHud = () =>
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
