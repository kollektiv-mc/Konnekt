import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { KickBanDialog, LifecycleConfirmDialog } from './CommandDialogs'
import { declaredLayer } from '../../lib/layers'

afterEach(cleanup)

// The bug behind #257: the compact quick-commands panel sits in a grid tile
// that react-grid-layout positions with a transform, and a transformed
// ancestor is the containing block for `fixed`, so a Stop confirm raised
// from the grid covered the tile's own box rather than the window. Measured
// in the demo: a 1224x456 backdrop on a 1440x900 viewport. Both halves have
// to hold: the portal gets each dialog out of the tile, and z-dialog is what
// orders it above the maximize overlay and the panel that raised it.
describe('command dialogs', () => {
  it('raises the lifecycle confirm outside the tile, on the dialog layer', () => {
    const { container } = render(
      <LifecycleConfirmDialog
        action="force-stop"
        busy={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    const overlay = screen.getByRole('button', { name: 'Cancel' }).closest('.fixed')
    expect(overlay).not.toBeNull()
    expect(container.contains(overlay)).toBe(false)
    expect(declaredLayer(overlay?.className ?? '')).toBe('dialog')
  })

  it('raises the kick dialog outside the tile, on the dialog layer', () => {
    const { container } = render(
      <KickBanDialog type="kick" onCancel={() => {}} onSubmit={() => {}} />,
    )
    const overlay = screen.getByPlaceholderText('Player name').closest('.fixed')
    expect(overlay).not.toBeNull()
    expect(container.contains(overlay)).toBe(false)
    expect(declaredLayer(overlay?.className ?? '')).toBe('dialog')
  })
})

// jsdom has no AnimationEvent, so React listens for the prefixed
// `webkitAnimationEnd` there, and fireEvent.animationEnd (the unprefixed name)
// reaches nothing. The event also needs its `animationName`, which is what
// tells the dialog's own exit from any other animation ending inside it.
function panelExitEnds(panel: Element | null) {
  const ev = new Event('webkitAnimationEnd', { bubbles: true })
  Object.defineProperty(ev, 'animationName', { value: 'modal-panel-out' })
  fireEvent(panel as Element, ev)
}

// Closing is the entrance reversed (hooks/usePresence.ts): the dialog stays up,
// inert, while its exit plays, and goes when the panel's animation ends.
describe('command dialogs closing', () => {
  const kick = (type: 'kick' | 'ban' | null, onCancel = () => {}) => (
    <KickBanDialog type={type} onCancel={onCancel} onSubmit={() => {}} />
  )

  it('plays the exit before the kick dialog unmounts', () => {
    const { rerender } = render(kick('kick'))
    rerender(kick(null))

    const overlay = screen.getByPlaceholderText('Player name').closest('.fixed')
    expect(overlay?.className).toContain('modal-overlay-out')
    expect(overlay?.className).toContain('pointer-events-none')
    expect(overlay?.hasAttribute('inert')).toBe(true)

    panelExitEnds(overlay?.firstElementChild ?? null)
    expect(screen.queryByPlaceholderText('Player name')).toBeNull()
  })

  it('still draws the confirm it was closed from during the exit', () => {
    const confirm = (action: 'force-stop' | null) => (
      <LifecycleConfirmDialog
        action={action}
        busy={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )
    const { rerender } = render(confirm('force-stop'))
    rerender(confirm(null))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('opens with empty fields again after a full exit', () => {
    const { rerender } = render(kick('ban'))
    fireEvent.change(screen.getByPlaceholderText('Player name'), { target: { value: 'Steve' } })
    rerender(kick(null))
    panelExitEnds(
      screen.getByPlaceholderText('Player name').closest('.fixed')?.firstElementChild ?? null,
    )

    rerender(kick('ban'))
    expect((screen.getByPlaceholderText('Player name') as HTMLInputElement).value).toBe('')
  })
})
