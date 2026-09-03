import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LAYER, declaredLayer } from '../lib/layers'
import { EulaModal } from './EulaModal'

vi.mock('../../wailsjs/go/main/App')
vi.mock('../../wailsjs/runtime/runtime')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

// The layer a node declares, resolved through lib/layers.ts; a bare number
// fails here on purpose, because it means the surface has left the scale.
function declaredZ(el: Element | null): number {
  const layer = declaredLayer(el?.className ?? '')
  if (!layer) throw new Error(`no z-<layer> class on ${el?.className || 'a missing element'}`)
  return LAYER[layer]
}

describe('EulaModal', () => {
  // Raised by server:eula-required rather than a click, so it can open while
  // the server manager or Settings is already up: a scheduled start on a
  // server whose EULA was never accepted, or a Start clicked a few seconds
  // before opening either. All three used to share z-modal, and App renders
  // this one first, so it lost the tie and the user saw a server refusing to
  // start with no prompt to accept (#256).
  it('declares the dialog layer, above the modals it can open over', () => {
    render(<EulaModal serverId="alpha" onClose={() => {}} />)
    const surface = screen.getByText('EULA Required').closest('.fixed')
    expect(declaredZ(surface)).toBe(LAYER.dialog)
    expect(declaredZ(surface)).toBeGreaterThan(LAYER.modal)
  })
})
