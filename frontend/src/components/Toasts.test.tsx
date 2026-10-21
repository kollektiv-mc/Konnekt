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
// jsdom has no AnimationEvent, so React listens for the prefixed name there;
// a browser sends the plain one.
function endAnimation(el: Element) {
  el.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }))
}

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
    // It fades out where it was, and goes when that ends.
    const leaving = screen.getByText('TPS 12').closest('[aria-hidden]') as HTMLElement
    expect(leaving.className).toContain('toast-out')
    act(() => endAnimation(leaving))
    expect(screen.queryByText('TPS 12')).toBeNull()
    // One left: nothing to dismiss "all" of.
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull()

    act(() =>
      showToast({ category: 'crash', tone: 'error', title: 'Server crashed', text: 'exit code 1' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))
    act(() => document.querySelectorAll('.toast-out').forEach(endAnimation))
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
  })

  it('slides a new bubble in from the right', () => {
    render(<Toasts />)
    act(() =>
      useNotificationsStore
        .getState()
        .showToast({ category: 'warnings', tone: 'warn', title: 'Low TPS', text: 'TPS 12' }),
    )
    expect(screen.getByRole('status').className).toContain('toast-in')
    // Clipped sideways, so the slide brings no horizontal scrollbar that lifts
    // the card until it lands.
    expect(screen.getByRole('region', { name: 'Notifications' }).className).toContain(
      'overflow-x-hidden',
    )
  })

  // jsdom lays nothing out, so each card is 100px tall at its place in the
  // column, and animate records what it was asked to do.
  it('glides the stack when a card below leaves it', () => {
    const animate = vi.fn<(keyframes: Keyframe[], options?: KeyframeAnimationOptions) => unknown>(
      () => ({ playState: 'running', cancel: vi.fn() }),
    )
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const restore = [
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.parentElement ? [...this.parentElement.children].indexOf(this) * 100 : 0
      }),
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.children.length * 100
      }),
    ]
    proto.animate = animate
    try {
      const { showToast } = useNotificationsStore.getState()
      showToast({ category: 'warnings', tone: 'warn', title: 'Low TPS', text: 'TPS 12' })
      showToast({ category: 'update', tone: 'info', title: 'Update available', text: 'v1.2.0' })
      render(<Toasts />)
      expect(animate).not.toHaveBeenCalled()

      // The lower card fades where it is, so nothing moves until it is gone.
      fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1])
      expect(animate).not.toHaveBeenCalled()
      act(() => document.querySelectorAll('.toast-out').forEach(endAnimation))

      // The card above drops one card's height, from where it was.
      expect(animate).toHaveBeenCalledTimes(1)
      expect(animate.mock.calls[0][0]).toEqual([
        { transform: 'translateY(-100px)' },
        { transform: 'translateY(0)' },
      ])
      expect(screen.getByText('TPS 12')).toBeTruthy()
    } finally {
      for (const r of restore) r.mockRestore()
      delete proto.animate
    }
  })

  it('removes a bubble at once with reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    useNotificationsStore
      .getState()
      .showToast({ category: 'warnings', tone: 'warn', title: 'Low TPS', text: 'TPS 12' })
    render(<Toasts />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('TPS 12')).toBeNull()
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
