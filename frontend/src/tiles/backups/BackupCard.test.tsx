import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BackupCard } from './BackupCard'
import type { Backup } from './useBackups'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime')

function card(over: Partial<Backup>, inProgress = false) {
  const backup = {
    filename: '00001_01_01_26_000000.zip',
    createdAt: 1_700_000_000_000,
    sizeBytes: 1024,
    displayName: '',
    tags: [],
    kind: 'server',
    ...over,
  } as Backup
  render(
    <BackupCard
      backup={backup}
      focused={false}
      inProgress={inProgress}
      serverRunning={false}
      onRequestRestore={() => {}}
      onRequestDelete={() => {}}
    />,
  )
}

afterEach(cleanup)

describe('BackupCard LODs note', () => {
  it('says the LODs are missing from a backup taken while the server ran', () => {
    card({ lodsSkipped: true })
    expect(screen.getByText('LODs not included (server was running)')).toBeTruthy()
  })

  it('stays quiet for a backup that holds them', () => {
    card({ lodsSkipped: false })
    expect(screen.queryByText(/LODs not included/)).toBeNull()
  })

  it('stays quiet for an archive from before the flag existed', () => {
    card({})
    expect(screen.queryByText(/LODs not included/)).toBeNull()
  })

  it('shows no note on a row that is still being written', () => {
    card({ lodsSkipped: true }, true)
    expect(screen.queryByText(/LODs not included/)).toBeNull()
  })
})
