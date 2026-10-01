import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'
import { useRemoteStore } from '../../stores/useRemoteStore'
import type { RemoteAccessState } from '../../stores/useRemoteStore'
import { RemoteAccessPane } from './RemoteAccessPane'

vi.mock('../../../wailsjs/go/main/App')
vi.mock('../../../wailsjs/runtime/runtime', () => ({ BrowserOpenURL: vi.fn() }))

afterEach(cleanup)

const access = (over: Partial<RemoteAccessState> = {}): RemoteAccessState =>
  ({
    passwordSet: true,
    running: false,
    addr: '',
    clients: 0,
    devices: [],
    pendingDevices: [],
    approvals: [],
    ...over,
  }) as RemoteAccessState

const ok = () => vi.fn(() => Promise.resolve())
const actions = {
  start: ok(),
  stop: ok(),
  setPassword: ok(),
  removeDevice: ok(),
  revokeSessions: ok(),
  approveDevice: ok(),
  denyDevice: ok(),
}

const seed = (over: Partial<RemoteAccessState> = {}, extra: object = {}) =>
  useRemoteStore.setState({ access: access(over), loaded: true, error: null, ...actions, ...extra })

const toggle = () => screen.getByRole('switch') as HTMLButtonElement
const passwordInput = () => screen.getByLabelText('New password') as HTMLInputElement

const device = (over = {}) => ({
  id: 'd1',
  name: 'Pixel',
  approvedAt: 1,
  lastSeen: Date.now() - 5 * 60_000,
  sessions: 0,
  ...over,
})

describe('RemoteAccessPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const fn of Object.values(actions)) fn.mockImplementation(() => Promise.resolve())
  })

  describe('the switch', () => {
    it('is disabled with no password, and says to set one', () => {
      seed({ passwordSet: false })
      render(<RemoteAccessPane />)
      expect(toggle().disabled).toBe(true)
      expect(screen.getByText(/Set a password first\./)).toBeTruthy()
    })

    it('does not mention a password once one is set', () => {
      seed()
      render(<RemoteAccessPane />)
      expect(toggle().disabled).toBe(false)
      expect(screen.queryByText(/Set a password first\./)).toBeNull()
    })

    it('starts when off and stops when on', () => {
      seed()
      const { unmount } = render(<RemoteAccessPane />)
      fireEvent.click(toggle())
      expect(actions.start).toHaveBeenCalledTimes(1)
      unmount()

      seed({ running: true, addr: '127.0.0.1:1' })
      render(<RemoteAccessPane />)
      fireEvent.click(toggle())
      expect(actions.stop).toHaveBeenCalledTimes(1)
    })

    it('is disabled while an action is in flight', async () => {
      let release: () => void = () => {}
      actions.start.mockImplementation(() => new Promise<void>((r) => (release = r)))
      seed()
      render(<RemoteAccessPane />)
      fireEvent.click(toggle())
      await waitFor(() => expect(toggle().disabled).toBe(true))
      release()
      await waitFor(() => expect(toggle().disabled).toBe(false))
    })

    it('renders disabled rather than empty before the first read', () => {
      seed({}, { loaded: false })
      render(<RemoteAccessPane />)
      expect(toggle().disabled).toBe(true)
      expect(passwordInput().disabled).toBe(true)
    })
  })

  describe('the address', () => {
    it('is absent while off', () => {
      seed()
      render(<RemoteAccessPane />)
      expect(screen.queryByText('Address')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Open ↗' })).toBeNull()
    })

    it('shows the URL with Copy and Open while running', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      Object.assign(navigator, { clipboard: { writeText } })
      seed({ running: true, addr: '127.0.0.1:54321' })
      render(<RemoteAccessPane />)
      expect(screen.getByText('http://127.0.0.1:54321')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
      expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:54321')

      fireEvent.click(screen.getByRole('button', { name: 'Open ↗' }))
      expect(BrowserOpenURL).toHaveBeenCalledWith('http://127.0.0.1:54321')
    })

    it('keeps the label when the clipboard refuses', async () => {
      const writeText = vi.fn(() => Promise.reject(new Error('denied')))
      Object.assign(navigator, { clipboard: { writeText } })
      seed({ running: true, addr: '127.0.0.1:1' })
      render(<RemoteAccessPane />)
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await waitFor(() => expect(writeText).toHaveBeenCalled())
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    })

    it.each([
      [0, 'Nobody connected'],
      [1, '1 browser connected'],
      [3, '3 browsers connected'],
    ])('says how many are connected: %i', (clients, text) => {
      seed({ running: true, addr: '127.0.0.1:1', clients })
      render(<RemoteAccessPane />)
      expect(screen.getByText(text)).toBeTruthy()
    })
  })

  describe('the password', () => {
    it('keeps the button disabled under 12 characters', () => {
      seed({ passwordSet: false })
      render(<RemoteAccessPane />)
      const button = screen.getByRole('button', { name: 'Set password' }) as HTMLButtonElement
      expect(screen.getByText('No password yet.')).toBeTruthy()
      fireEvent.change(passwordInput(), { target: { value: 'elevenchars' } })
      expect(button.disabled).toBe(true)
      fireEvent.change(passwordInput(), { target: { value: 'twelve chars' } })
      expect(button.disabled).toBe(false)
    })

    it('sets it and clears the field on success', async () => {
      seed({ passwordSet: false })
      render(<RemoteAccessPane />)
      fireEvent.change(passwordInput(), { target: { value: 'twelve chars' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
      expect(actions.setPassword).toHaveBeenCalledWith('twelve chars')
      await waitFor(() => expect(passwordInput().value).toBe(''))
    })

    it('keeps the field when the backend refuses', async () => {
      actions.setPassword.mockImplementation(() => Promise.reject(new Error('too weak')))
      seed({ passwordSet: false })
      render(<RemoteAccessPane />)
      fireEvent.change(passwordInput(), { target: { value: 'twelve chars' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
      await waitFor(() => expect(actions.setPassword).toHaveBeenCalled())
      await waitFor(() => expect(passwordInput().disabled).toBe(false))
      expect(passwordInput().value).toBe('twelve chars')
    })

    it('offers a change, and warns it signs everyone out, once one is set', () => {
      seed()
      render(<RemoteAccessPane />)
      expect(screen.getByText('A password is set.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy()
      expect(screen.getByText('Changing it signs every device out.')).toBeTruthy()
    })
  })

  describe('devices', () => {
    it('explains the empty list and offers no sign-out', () => {
      seed()
      render(<RemoteAccessPane />)
      expect(screen.getByText(/No device has been approved yet\./)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Sign out everywhere' })).toBeNull()
    })

    it('lists a device and removes it', () => {
      seed({ devices: [device()] as RemoteAccessState['devices'] })
      render(<RemoteAccessPane />)
      expect(screen.getByText('Pixel')).toBeTruthy()
      expect(screen.getByText('Last signed in 5m ago')).toBeTruthy()
      expect(screen.queryByText('signed in')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
      expect(actions.removeDevice).toHaveBeenCalledWith('d1')
    })

    it('badges a device with a live session', () => {
      seed({ devices: [device({ sessions: 2 })] as RemoteAccessState['devices'] })
      render(<RemoteAccessPane />)
      expect(screen.getByText('signed in')).toBeTruthy()
    })

    it('signs everyone out but keeps the devices', () => {
      seed({ devices: [device()] as RemoteAccessState['devices'] })
      render(<RemoteAccessPane />)
      fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
      expect(actions.revokeSessions).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/Devices stay approved/)).toBeTruthy()
    })
  })

  describe('a browser waiting to be approved', () => {
    const waiting = {
      id: 'r1',
      code: 'K7QX-92',
      userAgent: 'Mozilla/5.0 (Android)',
      requestedAt: 1,
    }

    it('shows the code and what the browser says it is', () => {
      seed({ pendingDevices: [waiting] as RemoteAccessState['pendingDevices'] })
      render(<RemoteAccessPane />)
      expect(screen.getByText('A browser is waiting to be approved')).toBeTruthy()
      expect(screen.getByText('K7QX-92')).toBeTruthy()
      expect(screen.getByText('Mozilla/5.0 (Android)')).toBeTruthy()
    })

    it('approves only once named, with the trimmed name', async () => {
      seed({ pendingDevices: [waiting] as RemoteAccessState['pendingDevices'] })
      render(<RemoteAccessPane />)
      const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement
      expect(approve.disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Device name'), { target: { value: '   ' } })
      expect(approve.disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Device name'), { target: { value: '  My phone ' } })
      expect(approve.disabled).toBe(false)
      fireEvent.click(approve)
      expect(actions.approveDevice).toHaveBeenCalledWith('r1', 'My phone')
      await waitFor(() => expect(approve.disabled).toBe(false))
    })

    it('keeps the typed name when the backend refuses', async () => {
      actions.approveDevice.mockImplementation(() => Promise.reject(new Error('expired')))
      seed({ pendingDevices: [waiting] as RemoteAccessState['pendingDevices'] })
      render(<RemoteAccessPane />)
      const name = screen.getByLabelText('Device name') as HTMLInputElement
      fireEvent.change(name, { target: { value: 'Phone' } })
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
      await waitFor(() => expect(actions.approveDevice).toHaveBeenCalled())
      await waitFor(() =>
        expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      )
      expect(name.value).toBe('Phone')
    })

    it('denies', () => {
      seed({ pendingDevices: [waiting] as RemoteAccessState['pendingDevices'] })
      render(<RemoteAccessPane />)
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
      expect(actions.denyDevice).toHaveBeenCalledWith('r1')
    })

    it('sits above everything else in the pane', () => {
      seed({ pendingDevices: [waiting] as RemoteAccessState['pendingDevices'] })
      const { container } = render(<RemoteAccessPane />)
      expect(container.firstElementChild?.firstElementChild?.textContent).toContain(
        'A browser is waiting to be approved',
      )
    })
  })

  it('shows the store error in a banner', () => {
    seed({}, { error: 'password too short' })
    render(<RemoteAccessPane />)
    expect(screen.getByRole('alert').textContent).toBe("Couldn't do that: password too short")
  })

  it('shows no banner without an error', () => {
    seed()
    render(<RemoteAccessPane />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
