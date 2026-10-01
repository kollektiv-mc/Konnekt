import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { RemoteClient } from '../lib/remoteRuntime'
import { signOut } from '../lib/remoteRuntime'
import { RemoteBanner, RemoteSession } from './RemoteChrome'

// The runtime is the remote half's whole world; a stand-in lets each test set
// what the page knows and fire the subscription by hand.
const mocks = vi.hoisted(() => ({
  client: { device: '', waiting: [] } as RemoteClient,
  watchers: new Set<() => void>(),
}))

vi.mock('../lib/remoteRuntime', () => ({
  getRemoteClient: () => mocks.client,
  subscribeRemoteClient: (w: () => void) => {
    mocks.watchers.add(w)
    return () => mocks.watchers.delete(w)
  },
  signOut: vi.fn(() => Promise.resolve()),
}))

const setClient = (next: RemoteClient) =>
  act(() => {
    mocks.client = next
    for (const w of mocks.watchers) w()
  })

afterEach(cleanup)

beforeEach(() => {
  mocks.client = { device: '', waiting: [] }
  mocks.watchers.clear()
  vi.mocked(signOut).mockClear()
})

describe('RemoteBanner', () => {
  it('renders nothing while nothing is waiting', () => {
    const { container } = render(<RemoteBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('names the waiting methods once each, as a polite status', () => {
    mocks.client = {
      device: 'Pixel',
      waiting: ['SaveServerConfig', 'DeleteBackup', 'SaveServerConfig'],
    }
    render(<RemoteBanner />)
    const bar = screen.getByRole('status')
    expect(bar.getAttribute('aria-live')).toBe('polite')
    expect(bar.textContent).toContain('Waiting for approval on the desktop')
    expect(screen.getByText('SaveServerConfig, DeleteBackup')).toBeTruthy()
  })

  it('follows the subscription in and out', () => {
    render(<RemoteBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    setClient({ device: 'Pixel', waiting: ['SaveServerConfig'] })
    expect(screen.getByText('SaveServerConfig')).toBeTruthy()
    setClient({ device: 'Pixel', waiting: [] })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('RemoteSession', () => {
  it('shows the device it is signed in as', () => {
    mocks.client = { device: 'Pixel', waiting: [] }
    render(<RemoteSession />)
    const name = screen.getByText('Pixel')
    expect(name.getAttribute('title')).toBe('Signed in as Pixel')
  })

  it('signs out once and disables the button', () => {
    render(<RemoteSession />)
    const button = screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement
    fireEvent.click(button)
    fireEvent.click(button)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
  })
})
