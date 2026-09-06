import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
