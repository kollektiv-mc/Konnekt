import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { models } from '../../../../wailsjs/go/models'
import { clearClipboard } from './clipboard'

vi.mock('../../../../wailsjs/go/main/App')
vi.mock('../../../../wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: vi.fn(),
  EventsOn: vi.fn(() => () => {}),
}))

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
  name: 'Nightly',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  nodes: [
    { id: 'n1', type: 'action.command', config: { command: 'one' }, position: { x: 0, y: 0 } },
    { id: 'n2', type: 'action.command', config: { command: 'two' }, position: { x: 300, y: 0 } },
  ],
  edges: [],
})

function renderEditor(onSave = vi.fn(async (g: models.Graph) => g)) {
  const utils = render(
    <GraphEditor
      graphs={[graph]}
      blockDefs={[commandDef]}
      onSave={onSave}
      onDelete={async () => {}}
      onSetEnabled={async () => {}}
      onRun={async () => ({}) as models.RunRecord}
      onPreviewNode={async () => ({}) as models.NodePreview}
    />,
  )
  return { ...utils, onSave }
}

const flowNodes = (c: HTMLElement) => c.querySelectorAll('.react-flow__node')
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

async function loaded(container: HTMLElement) {
  await waitFor(() => expect(flowNodes(container)).toHaveLength(2))
}

describe('the toolbar menus drive the editor', () => {
  it('selects everything and deletes it from the edit menu', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Select all/))
    await waitFor(() => expect(button('del 2')).toBeTruthy())

    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Delete 2/))
    await waitFor(() => expect(flowNodes(container)).toHaveLength(0))
  })

  it('copies and pastes from the menu, once, as one undo step', async () => {
    const { container } = renderEditor()
    await loaded(container)
    fireEvent.click(flowNodes(container)[0])
    await waitFor(() => expect(flowNodes(container)[0].classList).toContain('selected'))

    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Copy/))
    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Paste/))
    await waitFor(() => expect(flowNodes(container)).toHaveLength(3))

    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Undo/))
    await waitFor(() => expect(flowNodes(container)).toHaveLength(2))
  })

  it('selects by name from the edit menu', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Select by name/))
    const input = screen.getByLabelText('Select by name')
    fireEvent.change(input, { target: { value: 'comm' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(button('del 2')).toBeTruthy())
  })

  it('opens the quick-add list from the add button', async () => {
    const { container } = renderEditor()
    await loaded(container)

    expect(screen.queryByPlaceholderText('search blocks…')).toBeNull()
    fireEvent.click(button('add'))
    expect(screen.getByPlaceholderText('search blocks…')).toBeTruthy()
  })

  it('adds the picked block to the canvas', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('add'))
    fireEvent.change(screen.getByPlaceholderText('search blocks…'), { target: { value: 'comm' } })
    // Enter takes the highlighted result, the first match.
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(flowNodes(container)).toHaveLength(3))
  })

  it('starts a new graph from the dropdown', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button(/Nightly/))
    fireEvent.click(button('New graph'))

    await waitFor(() => expect(flowNodes(container)).toHaveLength(0))
    expect(button(/New graph/).textContent).toContain('New graph')
  })

  it('renames from the overflow menu and marks the graph unsaved', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('Graph actions'))
    fireEvent.click(button('Rename'))
    const input = screen.getByLabelText('Graph name')
    fireEvent.change(input, { target: { value: 'Hourly' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTitle('Unsaved changes')).toBeTruthy())
    expect(button(/Hourly/)).toBeTruthy()
  })

  it('saves a copy with a blank id and moves onto it', async () => {
    const onSave = vi.fn(
      async (g: models.Graph) => ({ ...g, id: 'g2', createdAt: 5 }) as models.Graph,
    )
    const { container } = renderEditor(onSave)
    await loaded(container)

    fireEvent.click(button('Graph actions'))
    fireEvent.click(button('Duplicate graph'))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const sent = onSave.mock.calls[0][0]
    expect(sent.id).toBe('')
    expect(sent.name).toBe('Nightly copy')
    expect(sent.enabled).toBe(false)
    expect(sent.nodes.map((n) => n.id)).toEqual(['n1', 'n2'])
    await waitFor(() => expect(button(/Nightly copy/)).toBeTruthy())
  })

  it('leaves the editor where it was when the copy fails to save', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('refused')
    })
    const { container } = renderEditor(onSave)
    await loaded(container)

    fireEvent.click(button('Graph actions'))
    fireEvent.click(button('Duplicate graph'))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(button(/Nightly/).textContent).not.toContain('copy')
  })
})
