import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { models } from '../../../../wailsjs/go/models'
import { clearClipboard } from './clipboard'
import * as App from '../../../../wailsjs/go/main/App'
import { useSettingsStore } from '../../../stores/useSettingsStore'

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

describe('the toolbar menus drive the editor', () => {
  it('selects everything and deletes it from the edit menu', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('edit'))
    fireEvent.click(button(/^Select all/))
    await waitFor(() => expect(selectedNodes(container)).toHaveLength(2))

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
    const input = screen.getByRole('textbox', { name: 'Select by name' })
    fireEvent.change(input, { target: { value: 'comm' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(selectedNodes(container)).toHaveLength(2))
  })

  it('persists curved connectors from the view menu without touching the graph', async () => {
    const before = useSettingsStore.getState().settings
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('view'))
    const row = screen.getByRole('switch', { name: 'Curved connectors' })
    expect(row.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(row)

    await waitFor(() =>
      expect(App.SaveAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ schedulerCurvedEdges: false }),
      ),
    )
    expect(
      screen.getByRole('switch', { name: 'Curved connectors' }).getAttribute('aria-checked'),
    ).toBe('false')
    // A view preference is not an edit: no unsaved dot, nothing to undo.
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
    fireEvent.click(button('edit'))
    expect(button(/^Undo/).disabled).toBe(true)
    useSettingsStore.setState({ settings: before })
  })

  it('persists snap to grid from the view menu, off until chosen', async () => {
    const before = useSettingsStore.getState().settings
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('view'))
    const row = screen.getByRole('switch', { name: 'Snap to grid' })
    expect(row.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(row)

    await waitFor(() =>
      expect(App.SaveAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ schedulerSnapToGrid: true, schedulerCurvedEdges: true }),
      ),
    )
    expect(screen.getByRole('switch', { name: 'Snap to grid' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull()
    useSettingsStore.setState({ settings: before })
  })

  it('opens the quick-add list from the add button', async () => {
    const { container } = renderEditor()
    await loaded(container)

    expect(screen.queryByPlaceholderText('search blocks…')).toBeNull()
    fireEvent.click(button('add'))
    expect(screen.getByPlaceholderText('search blocks…')).toBeTruthy()
  })

  it('closes the quick-add list on a second press of add', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('add'))
    expect(screen.getByPlaceholderText('search blocks…')).toBeTruthy()
    // The press on the button is not a press outside, so the click toggles the
    // list shut rather than the press closing it and the click reopening it.
    fireEvent.pointerDown(button('add'))
    fireEvent.click(button('add'))
    await waitFor(() => expect(screen.queryByPlaceholderText('search blocks…')).toBeNull())
  })

  it('opens edit in one click with the quick-add list open', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('add'))
    expect(screen.getByPlaceholderText('search blocks…')).toBeTruthy()
    // A press is a pointerdown and a click: the first closes the list, and it is
    // not a backdrop, so the click lands on the button.
    fireEvent.pointerDown(button('edit'))
    fireEvent.click(button('edit'))
    expect(button(/^Undo/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByPlaceholderText('search blocks…')).toBeNull())
  })

  it('closes the quick-add list on a press on the canvas, and lets it through', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('add'))
    const pane = container.querySelector('.react-flow__pane') as HTMLElement
    const reached = vi.fn()
    pane.addEventListener('pointerdown', reached)
    fireEvent.pointerDown(pane)
    expect(reached).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByPlaceholderText('search blocks…')).toBeNull())
  })

  it('keeps the quick-add list drawn but out of reach while it fades', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('add'))
    const field = screen.getByPlaceholderText('search blocks…')
    const panel = field.closest('.fixed') as HTMLElement
    expect(panel.className).toContain('menu-in')

    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    fireEvent.keyDown(field, { key: 'Escape' })
    window.removeEventListener('keydown', onWindow)
    // One Escape closes the list and does not go on to close the maximized tile.
    expect(onWindow).not.toHaveBeenCalled()
    expect(panel.className).toContain('menu-out')
    expect(panel.className).toContain('pointer-events-none')
    await waitFor(() => expect(screen.queryByPlaceholderText('search blocks…')).toBeNull())
  })

  it('starts each quick-add opening from a clean search', async () => {
    const { container } = renderEditor()
    await loaded(container)

    fireEvent.click(button('add'))
    fireEvent.change(screen.getByPlaceholderText('search blocks…'), { target: { value: 'zzz' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    // Reopened mid-fade: not the same menu with the old query in it.
    fireEvent.click(button('add'))
    expect((screen.getByPlaceholderText('search blocks…') as HTMLInputElement).value).toBe('')
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

    await waitFor(() => expect(screen.getByLabelText('Unsaved changes')).toBeTruthy())
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
