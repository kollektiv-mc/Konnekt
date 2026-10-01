import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useRemoteStore } from '../stores/useRemoteStore'
import type { RemoteAccessState } from '../stores/useRemoteStore'
import { emitNotification } from '../lib/notify'
import { LAYER, declaredLayer } from '../lib/layers'
import { RemotePrompts } from './RemotePrompts'

vi.mock('../lib/notify', () => ({ emitNotification: vi.fn() }))

// A stand-in for settings/PendingDeviceCard, so this file tests the prompt and
// not the card (which has a test of its own).
vi.mock('./settings/PendingDeviceCard', () => ({
  PendingDeviceCard: (props: {
    request: { code: string }
    onApprove: (name: string) => Promise<void>
    onDeny: () => Promise<void>
  }) => (
    <div>
      <span>code {props.request.code}</span>
      <input aria-label="Device name" />
      <button onClick={() => void props.onApprove('My phone')}>Approve</button>
      <button onClick={() => void props.onDeny()}>Deny device</button>
    </div>
  ),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useRemoteStore.setState({ loaded: false, error: null })
})

const NOW = 1_700_000_000_000

type Approval = RemoteAccessState['approvals'][number]
type Pending = RemoteAccessState['pendingDevices'][number]

const approval = (over: Partial<Approval> = {}): Approval =>
  ({
    id: 'a1',
    device: 'Pixel',
    method: 'SaveServerConfig',
    reason: 'It rewrites how the server launches.',
    args: ['{"jvmArgs":["-Xmx2G"]}'],
    requestedAt: NOW,
    expiresAt: NOW + 60_000,
    ...over,
  }) as Approval

const pendingDevice = (over: Partial<Pending> = {}): Pending =>
  ({
    id: 'p1',
    code: 'K7QX2M',
    userAgent: 'Chrome on Android',
    requestedAt: NOW,
    ...over,
  }) as Pending

const actions = {
  answerApproval: vi.fn().mockResolvedValue(undefined),
  approveDevice: vi.fn().mockResolvedValue(undefined),
  denyDevice: vi.fn().mockResolvedValue(undefined),
}

function seed(approvals: Approval[] = [], pendingDevices: Pending[] = []) {
  useRemoteStore.setState({
    access: {
      passwordSet: true,
      running: true,
      addr: 'http://192.168.1.2:4747',
      clients: 0,
      devices: [],
      pendingDevices,
      approvals,
    } as unknown as RemoteAccessState,
    loaded: true,
    error: null,
    ...actions,
  })
}

describe('RemotePrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when nothing waits', () => {
    seed()
    const { container } = render(<RemotePrompts />)
    expect(container.firstChild).toBeNull()
  })

  it('shows an approval with its device, method, reason and pretty-printed arguments', () => {
    seed([approval()])
    render(<RemotePrompts />)

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('Pixel wants to make a change')).toBeTruthy()
    expect(screen.getByText('SaveServerConfig')).toBeTruthy()
    expect(screen.getByText('It rewrites how the server launches.')).toBeTruthy()
    expect(screen.getByText('What it sent')).toBeTruthy()
    const pre = document.querySelector('pre')
    expect(pre?.textContent).toBe(JSON.stringify({ jvmArgs: ['-Xmx2G'] }, null, 2))
  })

  it('falls back to the raw string for an argument that is not JSON', () => {
    seed([approval({ args: ['not json {'] })])
    render(<RemotePrompts />)
    expect(document.querySelector('pre')?.textContent).toBe('not json {')
  })

  it('answers Allow once with true and Deny with false', () => {
    seed([approval()])
    render(<RemotePrompts />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(actions.answerApproval).toHaveBeenCalledWith('a1', true)

    // The first answer left the buttons disabled, so ask again from a fresh prompt.
    cleanup()
    render(<RemotePrompts />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(actions.answerApproval).toHaveBeenLastCalledWith('a1', false)
  })

  it('disables both buttons while the answer is in flight', async () => {
    let finish: () => void = () => {}
    actions.answerApproval.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)))
    seed([approval()])
    render(<RemotePrompts />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect((screen.getByRole('button', { name: 'Allow once' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => finish())
  })

  it('shows the store error and re-enables the buttons when the answer is refused', async () => {
    actions.answerApproval.mockRejectedValueOnce(new Error('expired'))
    seed([approval()])
    render(<RemotePrompts />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    })
    useRemoteStore.setState({ error: 'approval expired' })
    expect(await screen.findByText('approval expired')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('moves focus to Deny, the safe default', () => {
    seed([approval()])
    render(<RemotePrompts />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deny' }))
  })

  it('counts down the seconds left and ticks once a second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    seed([approval({ expiresAt: NOW + 60_000 })])
    render(<RemotePrompts />)
    expect(screen.getByText('Refused in 60s if you do nothing')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('Refused in 57s if you do nothing')).toBeTruthy()
  })

  it('shows approvals before pending devices, and the oldest first', () => {
    seed(
      [
        approval({ id: 'a-new', device: 'Newer', requestedAt: NOW + 5 }),
        approval({ id: 'a-old', device: 'Older', requestedAt: NOW }),
      ],
      [pendingDevice({ requestedAt: NOW - 1000 })],
    )
    render(<RemotePrompts />)
    expect(screen.getByText('Older wants to make a change')).toBeTruthy()
    expect(screen.queryByText('Newer wants to make a change')).toBeNull()
    expect(screen.queryByText(/code K7QX2M/)).toBeNull()
  })

  it('says how many are waiting only when there is more than one', () => {
    seed([approval()])
    const { unmount } = render(<RemotePrompts />)
    expect(screen.queryByText(/waiting$/)).toBeNull()
    unmount()

    seed([approval()], [pendingDevice()])
    render(<RemotePrompts />)
    expect(screen.getByText('1 of 2 waiting')).toBeTruthy()
  })

  it('renders a pending device through the card and approves it under the typed name', () => {
    seed([], [pendingDevice()])
    render(<RemotePrompts />)

    expect(screen.getByText('A new device wants to connect')).toBeTruthy()
    expect(screen.getByText('Approve it only if this code is on your own screen.')).toBeTruthy()
    expect(screen.getByText('code K7QX2M')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Device name'))

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(actions.approveDevice).toHaveBeenCalledWith('p1', 'My phone')

    fireEvent.click(screen.getByRole('button', { name: 'Deny device' }))
    expect(actions.denyDevice).toHaveBeenCalledWith('p1')
  })

  it('is not dismissed by a click on the backdrop or by Escape', () => {
    seed([approval()])
    render(<RemotePrompts />)

    const backdrop = screen.getByRole('alertdialog').parentElement as HTMLElement
    fireEvent.click(backdrop)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(actions.answerApproval).not.toHaveBeenCalled()
  })

  it('notifies once per new item, without naming an argument or a code', () => {
    seed([approval()], [pendingDevice()])
    const { rerender } = render(<RemotePrompts />)

    expect(emitNotification).toHaveBeenCalledTimes(2)
    const texts = vi.mocked(emitNotification).mock.calls.map((c) => c[1])
    expect(texts).toContain('Pixel is asking to make a change through remote access')
    expect(texts).toContain('A device is waiting to be approved for remote access')
    for (const t of texts) {
      expect(t).not.toContain('Xmx')
      expect(t).not.toContain('K7QX2M')
    }
    expect(vi.mocked(emitNotification).mock.calls.every((c) => c[0] === 'warn')).toBe(true)

    rerender(<RemotePrompts />)
    expect(emitNotification).toHaveBeenCalledTimes(2)

    act(() => seed([approval(), approval({ id: 'a2' })], [pendingDevice()]))
    expect(emitNotification).toHaveBeenCalledTimes(3)
  })

  it('sits on the dialog layer, above a modal', () => {
    seed([approval()])
    render(<RemotePrompts />)
    const layer = declaredLayer(
      (screen.getByRole('alertdialog').closest('.fixed') as HTMLElement).className,
    )
    expect(layer).toBe('dialog')
    expect(LAYER.dialog).toBeGreaterThan(LAYER.modal)
  })

  it('uses no em dash in what it shows', () => {
    seed([approval()], [pendingDevice()])
    render(<RemotePrompts />)
    expect(document.body.textContent).not.toContain('—')
  })
})
