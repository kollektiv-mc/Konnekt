import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ServerInstallModal } from './ServerInstallModal'
import { useInstallStore } from '../stores/useInstallStore'
import { isRemoteBrowser } from '../lib/ipc'

vi.mock('../../wailsjs/go/main/App')
vi.mock('../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ipc')>()),
  isRemoteBrowser: vi.fn(() => false),
}))

afterEach(() => {
  cleanup()
  vi.mocked(isRemoteBrowser).mockReturnValue(false)
})

describe('ServerInstallModal browse button', () => {
  beforeEach(() => {
    useInstallStore.getState().openFor(
      {
        jarPath: '/srv/installer.jar',
        loader: 'neoforge',
        version: '21.1.72',
        mcVersion: '1.21.1',
      },
      '/srv/new',
    )
  })

  it('offers Browse on the desktop', () => {
    render(<ServerInstallModal />)
    expect(screen.getByTitle('Browse')).toBeTruthy()
  })

  it('keeps the path input but not Browse in a remote browser', () => {
    vi.mocked(isRemoteBrowser).mockReturnValue(true)
    render(<ServerInstallModal />)
    expect(screen.queryByTitle('Browse')).toBeNull()
    expect(screen.getByPlaceholderText('Install directory')).toBeTruthy()
  })
})
