import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { models } from '../../../../wailsjs/go/models'
import { clearClipboard, readClipboard } from './clipboard'

vi.mock('../../../../wailsjs/go/main/App')
vi.mock('../../../../wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: vi.fn(),
  EventsOn: vi.fn(() => () => {}),
}))

// The first import of React Flow is slow on a cold run, so it is paid for here
// rather than inside a test's own timeout.
let GraphEditor: typeof import('./GraphEditor').GraphEditor
beforeAll(async () => {
  ;({ GraphEditor } = await import('./GraphEditor'))
}, 30_000)

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  clearClipboard()
  // React Flow measures its viewport and reads the transform through a matrix,
  // neither of which jsdom has.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1
    },
  )
})

const commandDef = models.BlockDef.createFrom({
  id: 'action.command',
  category: 'action',
  label: 'Command',
  controlInputs: ['trigger'],
  controlOutputs: ['onComplete'],
  configSchema: [{ key: 'command', label: 'Command', type: 'command' }],
})

const graph = models.Graph.createFrom({
  id: 'g1',
  name: 'Only',
  enabled: false,
  createdAt: 1,
  updatedAt: 1,
  nodes: [
    { id: 'n1', type: 'action.command', config: { command: 'one' }, position: { x: 0, y: 0 } },
    { id: 'n2', type: 'action.command', config: { command: 'two' }, position: { x: 300, y: 0 } },
  ],
  edges: [
    {
      id: 'e1',
      kind: 'control',
      source: 'n1',
      sourcePort: 'onComplete',
      target: 'n2',
      targetPort: 'trigger',
    },
  ],
})

function renderEditor() {
  return render(
    <GraphEditor
      graphs={[graph]}
      blockDefs={[commandDef]}
      onSave={async (g) => g}
      onDelete={async () => {}}
      onSetEnabled={async () => {}}
      onRun={async () => ({}) as models.RunRecord}
      onPreviewNode={async () => ({}) as models.NodePreview}
    />,
  )
}

const flowNodes = (c: HTMLElement) => c.querySelectorAll('.react-flow__node')
const key = (k: string, init: KeyboardEventInit = { ctrlKey: true }) =>
  fireEvent.keyDown(window, { key: k, ...init })

async function selectFirst(container: HTMLElement) {
  await waitFor(() => expect(flowNodes(container)).toHaveLength(2))
  fireEvent.click(flowNodes(container)[0])
  await waitFor(() => expect(flowNodes(container)[0].classList).toContain('selected'))
}

describe('the editor clipboard keys (#128)', () => {
  it('copies on Ctrl+C and pastes a second node on Ctrl+V', async () => {
    const { container } = renderEditor()
    await selectFirst(container)

    key('c')
    expect(readClipboard()?.nodes).toHaveLength(1)
    expect(flowNodes(container)).toHaveLength(2)

    key('v')
    await waitFor(() => expect(flowNodes(container)).toHaveLength(3))
  })

  it('removes the original on Ctrl+X and still pastes it', async () => {
    const { container } = renderEditor()
    await selectFirst(container)

    key('x')
    await waitFor(() => expect(flowNodes(container)).toHaveLength(1))

    key('v')
    await waitFor(() => expect(flowNodes(container)).toHaveLength(2))
  })

  it('duplicates on Ctrl+D without touching the clipboard', async () => {
    const { container } = renderEditor()
    await selectFirst(container)

    key('d')
    await waitFor(() => expect(flowNodes(container)).toHaveLength(3))
    expect(readClipboard()).toBeNull()
  })

  it('leaves Ctrl+C and Ctrl+V to a focused text field', async () => {
    const { container } = renderEditor()
    await selectFirst(container)
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()

    key('c')
    expect(readClipboard()).toBeNull()

    // The same key with the focus back on the page is a copy.
    document.body.removeChild(field)
    key('c')
    expect(readClipboard()?.nodes).toHaveLength(1)
  })

  it('does nothing on Ctrl+V with an empty clipboard', async () => {
    const { container } = renderEditor()
    await waitFor(() => expect(flowNodes(container)).toHaveLength(2))

    key('v')
    expect(flowNodes(container)).toHaveLength(2)
  })
})
