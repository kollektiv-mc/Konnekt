import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Toasts } from './Toasts'
import { useNotificationsStore } from '../stores/useNotificationsStore'
import { declaredLayer } from '../lib/layers'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The message that wrapped the scheduler's header to four lines (#629).
const SKEWED =
  'cannot read the previous snapshot from "Frangfurd DH": s3 GetObject dh/latest.json: ' +
  "status 403 RequestTimeTooSkewed: The difference between the request time and the server's time is too large."

describe('Toasts', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ toasts: [], dismissedToasts: {} })
  })

  it('renders nothing with no bubble open', () => {
    const { container } = render(<Toasts />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the whole message, selectable, on the toast layer', () => {
    useNotificationsStore.getState().showToast({
      key: 'scheduler:run',
      category: 'errors',
      tone: 'error',
      title: 'Run failed: DH',
      text: SKEWED,
    })
    render(<Toasts />)
    expect(screen.getByRole('alert').textContent).toContain(SKEWED)
    expect(screen.getByText(SKEWED).className).toContain('select-text')
    expect(declaredLayer(screen.getByRole('region', { name: 'Notifications' }).className)).toBe(
      'toast',
    )
  })

  it('copies the message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    useNotificationsStore
      .getState()
      .showToast({ category: 'errors', tone: 'error', title: 'Run failed', text: SKEWED })
    render(<Toasts />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SKEWED))
  })

  it('stays until dismissed, one at a time or all together', () => {
    const { showToast } = useNotificationsStore.getState()
    showToast({ category: 'warnings', tone: 'warn', title: 'Low TPS', text: 'TPS 12' })
    showToast({ category: 'update', tone: 'info', title: 'Update available', text: 'v1.2.0' })
    render(<Toasts />)
    expect(screen.getAllByRole('status')).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.queryByText('TPS 12')).toBeNull()
    // One left: nothing to dismiss "all" of.
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull()

    act(() =>
      showToast({ category: 'crash', tone: 'error', title: 'Server crashed', text: 'exit code 1' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
  })

  it('says how often the same message repeated', () => {
    const { showToast } = useNotificationsStore.getState()
    const t = { category: 'warnings', tone: 'warn', title: 'Low TPS', text: 'TPS 12' } as const
    showToast(t)
    showToast(t)
    showToast(t)
    render(<Toasts />)
    expect(screen.getByText('3 times')).toBeTruthy()
  })
})
