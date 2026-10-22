import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloseConfirmDialog } from './CloseConfirmDialog'

// jsdom has no AnimationEvent, so React listens for the prefixed name; see
// components/commands/CommandDialogs.test.tsx for the same helper.
function panelExitEnds(panel: Element | null) {
  const ev = new Event('webkitAnimationEnd', { bubbles: true })
  Object.defineProperty(ev, 'animationName', { value: 'modal-panel-out' })
  fireEvent(panel as Element, ev)
}

afterEach(cleanup)

const dialog = (open: boolean, onCancel = () => {}) => (
  <CloseConfirmDialog
    open={open}
    saving={false}
    onCancel={onCancel}
    onDiscard={() => {}}
    onSaveAndContinue={() => {}}
  />
)

describe('CloseConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(dialog(false))
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('opens with the shared entrance', () => {
    render(dialog(true))
    const overlay = screen.getByText('Unsaved changes').closest('.fixed')
    expect(overlay?.className).toContain('modal-overlay-in')
    expect(overlay?.firstElementChild?.className).toContain('modal-panel-in')
  })

  it('plays the exit, inert, before it unmounts', () => {
    const { rerender } = render(dialog(true))
    rerender(dialog(false))

    const overlay = screen.getByText('Unsaved changes').closest('.fixed')
    expect(overlay?.className).toContain('modal-overlay-out')
    expect(overlay?.hasAttribute('inert')).toBe(true)

    panelExitEnds(overlay?.firstElementChild ?? null)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('stops answering Escape once it is closing', () => {
    const onCancel = vi.fn()
    const { rerender } = render(dialog(true, onCancel))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(dialog(false, onCancel))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
