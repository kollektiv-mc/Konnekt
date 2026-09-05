import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EulaModal } from './EulaModal'
import { declaredLayer } from '../lib/layers'

vi.mock('../../wailsjs/go/main/App')
vi.mock('../../wailsjs/runtime/runtime', () => ({ BrowserOpenURL: vi.fn() }))

afterEach(cleanup)

// The bug behind #256: this prompt is raised by the server:eula-required event,
// not by a click, so it can open while the server manager or Settings is up.
// All three sat on z-modal and App renders this one first, so it lost the tie
// on document order and the server appeared to refuse to start with no prompt.
// By the scale's own rule, what opens on top of a modal is a dialog.
describe('EulaModal', () => {
  it('opens on the dialog layer, above the modals it can interrupt', () => {
    render(<EulaModal serverId="srv1" onClose={() => {}} />)
    const overlay = screen.getByText('EULA Required').closest('.fixed')
    expect(overlay).not.toBeNull()
    expect(declaredLayer(overlay?.className ?? '')).toBe('dialog')
  })
})
