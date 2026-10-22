import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import {
  render,
  screen,
  cleanup,
  fireEvent,
  createEvent,
  waitFor,
  within,
} from '@testing-library/react'
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
const selectedNodes = (c: HTMLElement) => c.querySelectorAll('.react-flow__node.selected')
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

async function loaded(container: HTMLElement) {
  await waitFor(() => expect(flowNodes(container)).toHaveLength(2))
}

const menu = () => screen.queryByRole('menu', { name: 'Edit' })
const quickAdd = () => screen.queryByPlaceholderText('search blocks…')
const selectedIds = (c: HTMLElement) =>
  Array.from(selectedNodes(c)).map((n) => n.getAttribute('data-id'))
const node = (c: HTMLElement, id: string) =>
  c.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement
const pane = (c: HTMLElement) => c.querySelector('.react-flow__pane') as HTMLElement
const rowOf = (name: RegExp) => within(menu() as HTMLElement).getByRole('button', { name })

describe('right-clicking a block opens the edit menu', () => {
  it('opens the edit menu, not quick-add, on a block', async () => {
    const { container } = renderEditor()
    await loaded(container)

    const event = createEvent.contextMenu(node(container, 'n1'), { clientX: 40, clientY: 50 })
    fireEvent(node(container, 'n1'), event)

    // The WebView's own menu never shows.
    expect(event.defaultPrevented).toBe(true)
    expect(menu()).toBeTruthy()
    expect(quickAdd()).toBeNull()
    expect(rowOf(/^Undo/)).toBeTruthy()
    expect(rowOf(/^Select all/)).toBeTruthy()
  })

  it('opens quick-add, not the edit menu, on the empty canvas', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.contextMenu(pane(container), { clientX: 40, clientY: 50 })

    expect(quickAdd()).toBeTruthy()
    expect(menu()).toBeNull()
  })

  it('makes an unselected block the whole selection', async () => {
    const { container } = renderEditor()
    await loaded(container)
    fireEvent.click(node(container, 'n1'))
    await waitFor(() => expect(selectedIds(container)).toEqual(['n1']))

    fireEvent.contextMenu(node(container, 'n2'))

    await waitFor(() => expect(selectedIds(container)).toEqual(['n2']))
    expect(menu()).toBeTruthy()
    // Delete names what it acts on: the one block that was right-clicked.
    expect(rowOf(/^Delete 1/)).toBeTruthy()
  })

  it('keeps a multi-selection when the block is inside it', async () => {
    const { container } = renderEditor()
    await loaded(container)
    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Select all/))
    await waitFor(() => expect(selectedIds(container)).toHaveLength(2))

    fireEvent.contextMenu(node(container, 'n2'))

    expect(menu()).toBeTruthy()
    expect(selectedIds(container).sort()).toEqual(['n1', 'n2'])
    expect(rowOf(/^Delete 2/)).toBeTruthy()
  })

  it('acts on the selection from a row and closes', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.contextMenu(node(container, 'n1'))
    fireEvent.click(rowOf(/^Delete 1/))

    await waitFor(() => expect(flowNodes(container)).toHaveLength(1))
    expect(flowNodes(container)[0].getAttribute('data-id')).toBe('n2')
    await waitFor(() => expect(menu()).toBeNull())
  })

  it('pastes through the menu and undoes it as one step', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.contextMenu(node(container, 'n1'))
    fireEvent.click(rowOf(/^Copy/))
    await waitFor(() => expect(menu()).toBeNull())

    fireEvent.contextMenu(node(container, 'n2'))
    fireEvent.click(rowOf(/^Paste/))
    await waitFor(() => expect(flowNodes(container)).toHaveLength(3))

    fireEvent.contextMenu(node(container, 'n2'))
    fireEvent.click(rowOf(/^Undo/))
    await waitFor(() => expect(flowNodes(container)).toHaveLength(2))
  })

  it('closes on Escape without reaching the maximized tile', async () => {
    const { container } = renderEditor()
    await loaded(container)
    fireEvent.contextMenu(node(container, 'n1'))
    expect(menu()).toBeTruthy()

    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    fireEvent.keyDown(window, { key: 'Escape' })
    window.removeEventListener('keydown', onWindow)

    expect(onWindow).not.toHaveBeenCalled()
    await waitFor(() => expect(menu()).toBeNull())
  })

  it('closes on a press outside, and lets the press through', async () => {
    const { container } = renderEditor()
    await loaded(container)
    fireEvent.contextMenu(node(container, 'n1'))

    const reached = vi.fn()
    pane(container).addEventListener('pointerdown', reached)
    fireEvent.pointerDown(pane(container))

    expect(reached).toHaveBeenCalledOnce()
    await waitFor(() => expect(menu()).toBeNull())
  })

  it('keeps the menu on a press inside it', async () => {
    const { container } = renderEditor()
    await loaded(container)
    fireEvent.contextMenu(node(container, 'n1'))

    fireEvent.pointerDown(rowOf(/^Undo/))

    expect(menu()).toBeTruthy()
  })

  it('swaps one menu for the other, never showing both', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.contextMenu(pane(container))
    expect(quickAdd()).toBeTruthy()
    fireEvent.contextMenu(node(container, 'n1'))
    expect(menu()).toBeTruthy()
    await waitFor(() => expect(quickAdd()).toBeNull())

    fireEvent.contextMenu(pane(container))
    expect(quickAdd()).toBeTruthy()
    await waitFor(() => expect(menu()).toBeNull())
  })

  it('does not show the native menu over its own rows', async () => {
    const { container } = renderEditor()
    await loaded(container)
    fireEvent.contextMenu(node(container, 'n1'))

    const event = createEvent.contextMenu(rowOf(/^Undo/))
    fireEvent(rowOf(/^Undo/), event)

    expect(event.defaultPrevented).toBe(true)
  })
})
