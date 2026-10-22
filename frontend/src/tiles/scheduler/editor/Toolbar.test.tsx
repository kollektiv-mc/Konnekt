import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react'
import type { Edge as FlowEdge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'
import { NO_GRAPH_KEYS } from './blockMeta'
import { clearClipboard, writeClipboard } from './clipboard'
import type { BlockFlowNode } from './graphMapping'
import { Toolbar } from './Toolbar'

vi.mock('../../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)
beforeEach(clearClipboard)

const graphs = [
  { id: 'g1', name: 'Nightly', nodes: [], edges: [] },
  { id: 'g2', name: 'Weekly', nodes: [], edges: [] },
] as unknown as models.Graph[]

function node(id: string, blockType: string, label: string, selected = false): BlockFlowNode {
  return {
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    selected,
    data: { blockType, config: {}, label },
  }
}

const defMap = new Map<string, models.BlockDef>([
  ['action.command', { id: 'action.command', label: 'Command' } as models.BlockDef],
  ['trigger.cron', { id: 'trigger.cron', label: 'Cron' } as models.BlockDef],
])

function handlers() {
  return {
    onLoadGraph: vi.fn(),
    onNewGraph: vi.fn(),
    onAdd: vi.fn(),
    view: { curvedEdges: true, onToggleCurvedEdges: vi.fn() },
    edit: {
      undo: vi.fn(),
      redo: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      duplicate: vi.fn(),
      paste: vi.fn(),
      deleteSelected: vi.fn(),
      select: vi.fn(),
    },
    onToggleEnabled: vi.fn(),
    onRun: vi.fn(),
    onSave: vi.fn(),
    onRename: vi.fn(),
    onDuplicateGraph: vi.fn(),
    onDeleteGraph: vi.fn(),
    onErrorClick: vi.fn(),
    onRunStatusClick: vi.fn(),
    onWarningsClick: vi.fn(),
  }
}

type Overrides = Partial<React.ComponentProps<typeof Toolbar>>

function setup(overrides: Overrides = {}) {
  const h = handlers()
  const props: React.ComponentProps<typeof Toolbar> = {
    graphs,
    graphId: 'g1',
    graphName: 'Nightly',
    graphEnabled: false,
    dirty: false,
    saving: false,
    nodes: [],
    edges: [],
    defMap,
    canUndo: false,
    canRedo: false,
    runStatus: null,
    schedulerError: null,
    warnings: [],
    ...h,
    ...overrides,
  }
  render(<Toolbar {...props} />)
  return h
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const openEdit = () => fireEvent.click(button('edit'))
const openOverflow = () => fireEvent.click(button('Graph actions'))

const canvas = [
  node('a', 'action.command', 'Command', true),
  node('b', 'action.command', 'Command'),
  node('c', 'trigger.cron', 'Cron'),
]

describe('the toolbar bar', () => {
  it('shows the graph name with the unsaved dot beside it', () => {
    setup({ dirty: true })
    const picker = button(/Nightly/)
    expect(within(picker).getByTitle('Unsaved changes')).toBeTruthy()
  })

  it('has no dot on a clean graph', () => {
    setup()
    expect(screen.queryByTitle('Unsaved changes')).toBeNull()
  })

  it('has neither a new button nor a rename field of its own', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'new' })).toBeNull()
    expect(screen.queryByTitle('Click to rename')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('says so when there is no graph', () => {
    setup({ graphs: [], graphId: null, graphName: '' })
    expect(button(/no graphs/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'run' })).toBeNull()
  })

  it('keeps run, the toggle, the warning count and the status in plain view', () => {
    const h = setup({
      graphEnabled: true,
      warnings: ['stops the server', 'another'],
      runStatus: { text: 'run failed', failed: true, detail: 'why' },
    })
    fireEvent.click(button('run'))
    fireEvent.click(button('[on]'))
    fireEvent.click(button('2 warnings'))
    fireEvent.click(button('run failed'))
    expect(h.onRun).toHaveBeenCalledOnce()
    expect(h.onToggleEnabled).toHaveBeenCalledOnce()
    expect(h.onWarningsClick).toHaveBeenCalledOnce()
    expect(h.onRunStatusClick).toHaveBeenCalledWith(expect.objectContaining({ text: 'run failed' }))
  })

  it('shows a scheduler error in the same slot', () => {
    const h = setup({ schedulerError: 'save refused' })
    fireEvent.click(button('scheduler error'))
    expect(h.onErrorClick).toHaveBeenCalledOnce()
  })

  it('puts the toggle left of the overflow button', () => {
    setup()
    const toggle = button('[off]')
    const overflow = button('Graph actions')
    expect(toggle.compareDocumentPosition(overflow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no del button on the bar, with or without a selection', () => {
    setup({ nodes: canvas })
    expect(screen.queryByRole('button', { name: /^del/ })).toBeNull()
  })
})

// The bar's geometry as classes: jsdom lays nothing out, so what can be pinned
// is that each segment states its own width and that the state does not change it.
const segmentOf = (el: HTMLElement) => el.parentElement as HTMLElement
const widthClass = (el: HTMLElement) => Array.from(el.classList).find((c) => /^w-\d+$/.test(c))

describe('the bar does not shift', () => {
  it('gives the picker one fixed width, dirty or clean, long name or short', () => {
    setup()
    const clean = widthClass(segmentOf(button(/Nightly/)))
    expect(clean).toBe('w-60')
    cleanup()
    setup({ dirty: true, graphName: 'A graph name far longer than the picker could ever hold' })
    expect(widthClass(segmentOf(button(/A graph name/)))).toBe(clean)
  })

  it('lays the unsaved dot over the name instead of beside it', () => {
    setup({ dirty: true })
    const dot = screen.getByTitle('Unsaved changes')
    expect(dot.classList).toContain('absolute')
    // The name's field is a sibling that fades out, not a text node with the dot after it.
    const name = within(button(/Nightly/)).getByText('Nightly')
    expect(name.className).toContain('mask-image')
    expect(name.contains(dot)).toBe(false)
  })

  it('gives [on] and [off] the same width', () => {
    setup({ graphEnabled: true })
    const on = widthClass(segmentOf(button('[on]')))
    cleanup()
    setup({ graphEnabled: false })
    expect(on).toBe('w-12')
    expect(widthClass(segmentOf(button('[off]')))).toBe(on)
  })

  it('keeps a slot for the warning count when there are none', () => {
    setup()
    const quiet = screen.getByTitle('No warnings')
    const slot = widthClass(segmentOf(quiet))
    expect(slot).toBeTruthy()
    cleanup()
    setup({ warnings: ['one', 'two'] })
    expect(widthClass(segmentOf(button('2 warnings')))).toBe(slot)
  })

  it('puts the status outside the bars, right-aligned in the gap', () => {
    setup({ runStatus: { text: 'running…', failed: false } })
    const status = screen.getByText('running…')
    expect(status.closest('[class*="border-hairline"]')).toBeNull()
    expect(status.parentElement?.className).toContain('justify-end')
  })

  it('makes every segment the same height', () => {
    setup({ graphEnabled: true, warnings: ['x'] })
    const segs = [
      button(/Nightly/),
      button('add'),
      button('edit'),
      button('1 warning'),
      button('run'),
      button('[on]'),
      button('Graph actions'),
    ]
    for (const b of segs) expect(b.classList).toContain('h-6')
  })

  it('shows no pointer cursor on the bar or in its menus', () => {
    setup({ nodes: canvas })
    openEdit()
    for (const b of screen.getAllByRole('button'))
      expect(b.className).not.toContain('cursor-pointer')
  })
})

describe('the graph menu', () => {
  it('lists the graphs and loads the one picked', () => {
    const h = setup()
    fireEvent.click(button(/Nightly/))
    fireEvent.click(button('Weekly'))
    expect(h.onLoadGraph).toHaveBeenCalledWith(graphs[1])
  })

  it('starts a new graph from a row of its own', () => {
    const h = setup()
    fireEvent.click(button(/Nightly/))
    fireEvent.click(button('New graph'))
    expect(h.onNewGraph).toHaveBeenCalledOnce()
  })

  it('offers new graph when there are no graphs yet', () => {
    const h = setup({ graphs: [], graphId: null, graphName: '' })
    fireEvent.click(button(/no graphs/))
    fireEvent.click(button('New graph'))
    expect(h.onNewGraph).toHaveBeenCalledOnce()
  })

  it('names an unsaved new graph in the list', () => {
    setup({ graphId: '', graphName: 'Fresh' })
    fireEvent.click(button(/Fresh/))
    // The picker itself, and the one row for the graph that is not saved yet.
    expect(screen.getAllByRole('button', { name: 'Fresh' })).toHaveLength(2)
  })
})

describe('the view menu', () => {
  const openView = () => fireEvent.click(button('view'))
  const curved = () => screen.getByRole('switch', { name: 'Curved connectors' })

  it('sits right after the edit button', () => {
    setup()
    expect(
      button('edit').compareDocumentPosition(button('view')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('is closed until the button is pressed', () => {
    setup()
    expect(screen.queryByRole('switch')).toBeNull()
    openView()
    expect(curved()).toBeTruthy()
  })

  it('shows curved connectors on, with the mark visible', () => {
    setup()
    openView()
    expect(curved().getAttribute('aria-checked')).toBe('true')
    expect(curved().querySelector('svg')?.getAttribute('class')).toContain('opacity-100')
  })

  it('shows curved connectors off, with the mark hidden', () => {
    setup({ view: { curvedEdges: false, onToggleCurvedEdges: vi.fn() } })
    openView()
    expect(curved().getAttribute('aria-checked')).toBe('false')
    expect(curved().querySelector('svg')?.getAttribute('class')).toContain('opacity-0')
  })

  it('flips the preference and stays open for the next choice', () => {
    const onToggleCurvedEdges = vi.fn()
    setup({ view: { curvedEdges: true, onToggleCurvedEdges } })
    openView()
    fireEvent.click(curved())
    expect(onToggleCurvedEdges).toHaveBeenCalledOnce()
    expect(curved()).toBeTruthy()
  })
})

describe('the add menu', () => {
  it('opens the quick-add list at the corner under its button', () => {
    const h = setup()
    fireEvent.click(button('add'))
    expect(h.onAdd).toHaveBeenCalledOnce()
    const at = h.onAdd.mock.calls[0][0]
    expect(typeof at.x).toBe('number')
    expect(typeof at.y).toBe('number')
  })
})

describe('the edit menu', () => {
  it('holds every row, with its shortcut where it has one', () => {
    setup({ nodes: canvas })
    openEdit()
    for (const name of [
      /^Undo/,
      /^Redo/,
      /^Cut/,
      /^Copy/,
      /^Duplicate/,
      /^Paste/,
      /^Delete/,
      /^Select all/,
      /^Deselect all/,
      /^Select by type/,
      /^Select by name/,
    ]) {
      expect(button(name)).toBeTruthy()
    }
    expect(button(/^Undo/).textContent).toContain('Ctrl+Z')
    expect(button(/^Redo/).textContent).toContain('Ctrl+Shift+Z')
    expect(button(/^Cut/).textContent).toContain('Ctrl+X')
    expect(button(/^Copy/).textContent).toContain('Ctrl+C')
    expect(button(/^Duplicate/).textContent).toContain('Ctrl+D')
    expect(button(/^Paste/).textContent).toContain('Ctrl+V')
    expect(button(/^Delete/).textContent).toContain('Del')
  })

  it('disables the rows that have nothing to act on', () => {
    setup()
    openEdit()
    for (const name of [
      /^Undo/,
      /^Redo/,
      /^Cut/,
      /^Copy/,
      /^Duplicate/,
      /^Paste/,
      /^Delete/,
      /^Select all/,
      /^Deselect all/,
      /^Select by type/,
      /^Select by name/,
    ]) {
      expect(button(name).disabled).toBe(true)
    }
  })

  it('enables the clipboard rows once nodes are selected', () => {
    setup({ nodes: canvas })
    openEdit()
    for (const name of [/^Cut/, /^Copy/, /^Duplicate/, /^Delete 1/, /^Deselect all/]) {
      expect(button(name).disabled).toBe(false)
    }
    // Nothing has been copied yet.
    expect(button(/^Paste/).disabled).toBe(true)
  })

  it('enables paste when something is on the clipboard', () => {
    writeClipboard({ nodes: [], edges: [] })
    setup()
    openEdit()
    expect(button(/^Paste/).disabled).toBe(false)
  })

  it('counts selected edges into delete, but not into the clipboard rows', () => {
    const edges = [{ id: 'e', source: 'a', target: 'b', selected: true }] as FlowEdge[]
    setup({ nodes: [node('a', 'action.command', 'Command')], edges })
    openEdit()
    expect(button(/^Delete 1/).disabled).toBe(false)
    expect(button(/^Cut/).disabled).toBe(true)
  })

  it('wires undo and redo', () => {
    const h = setup({ canUndo: true, canRedo: true })
    openEdit()
    fireEvent.click(button(/^Undo/))
    openEdit()
    fireEvent.click(button(/^Redo/))
    expect(h.edit.undo).toHaveBeenCalledOnce()
    expect(h.edit.redo).toHaveBeenCalledOnce()
  })

  it.each([
    [/^Cut/, 'cut'],
    [/^Copy/, 'copy'],
    [/^Duplicate/, 'duplicate'],
    [/^Delete 1/, 'deleteSelected'],
  ] as const)('wires %s to its handler and closes', (name, handler) => {
    const h = setup({ nodes: canvas })
    openEdit()
    fireEvent.click(button(name))
    expect(h.edit[handler]).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /^Cut/ })).toBeNull()
  })

  it('wires paste', () => {
    writeClipboard({ nodes: [], edges: [] })
    const h = setup()
    openEdit()
    fireEvent.click(button(/^Paste/))
    expect(h.edit.paste).toHaveBeenCalledOnce()
  })

  it('selects all and deselects all', () => {
    const h = setup({ nodes: canvas })
    openEdit()
    fireEvent.click(button(/^Select all/))
    openEdit()
    fireEvent.click(button(/^Deselect all/))
    expect(h.edit.select).toHaveBeenNthCalledWith(1, { kind: 'all' })
    expect(h.edit.select).toHaveBeenNthCalledWith(2, { kind: 'none' })
  })

  it('opens the types present in a fly-out and selects by the one picked', () => {
    const h = setup({ nodes: canvas })
    openEdit()
    fireEvent.click(button(/^Select by type/))
    expect(screen.getAllByRole('button', { name: /^(Command|Cron)$/ })).toHaveLength(2)
    fireEvent.click(button('Cron'))
    expect(h.edit.select).toHaveBeenCalledWith({ kind: 'type', blockType: 'trigger.cron' })
  })

  it('puts the fly-out in the body, outside the popover and its overflow', () => {
    setup({ nodes: canvas })
    openEdit()
    const row = button(/^Select by type/)
    const popover = row.closest('.overflow-hidden') as HTMLElement
    fireEvent.click(row)
    const flyout = screen.getByRole('menu', { name: 'Select by type' })
    expect(flyout.parentElement).toBe(document.body)
    expect(popover.contains(flyout)).toBe(false)
    expect(flyout.className).toContain('fixed')
    // The popover holds the same rows it did: nothing was inserted into it.
    expect(within(popover).queryByRole('button', { name: 'Cron' })).toBeNull()
    expect(row.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens the fly-out on hover, and folds it when another row is hovered', async () => {
    setup({ nodes: canvas })
    openEdit()
    fireEvent.mouseEnter(button(/^Select by type/).parentElement as HTMLElement)
    expect(screen.getByRole('menu', { name: 'Select by type' })).toBeTruthy()
    // Hover alone leaves focus where it was.
    expect(document.activeElement).not.toBe(button('Cron'))

    fireEvent.mouseEnter(button(/^Undo/).parentElement as HTMLElement)
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Select by type' })).toBeNull())
  })

  it('opens the fly-out from the keyboard and focuses into it', () => {
    setup({ nodes: canvas })
    openEdit()
    fireEvent.keyDown(button(/^Select by type/), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(button('Command'))
    fireEvent.keyDown(button('Command'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(button('Cron'))
  })

  it('folds the fly-out back to its row on Escape or the left arrow', async () => {
    setup({ nodes: canvas })
    openEdit()
    const row = button(/^Select by type/)
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    fireEvent.keyDown(button('Command'), { key: 'Escape' })
    window.removeEventListener('keydown', onWindow)
    expect(onWindow).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Select by type' })).toBeNull())
    expect(document.activeElement).toBe(row)
    // The edit menu itself is still open.
    expect(button(/^Undo/)).toBeTruthy()

    fireEvent.keyDown(row, { key: 'ArrowRight' })
    fireEvent.keyDown(button('Command'), { key: 'ArrowLeft' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Select by type' })).toBeNull())
  })

  it('selects by name on Enter, and not on a blank query', () => {
    const h = setup({ nodes: canvas })
    openEdit()
    fireEvent.click(button(/^Select by name/))
    const input = screen.getByRole('textbox', { name: 'Select by name' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(h.edit.select).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'cro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(h.edit.select).toHaveBeenCalledWith({ kind: 'name', query: 'cro' })
  })

  it('folds the name fly-out on Escape without closing the editor', async () => {
    setup({ nodes: canvas })
    openEdit()
    fireEvent.click(button(/^Select by name/))
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Select by name' }), { key: 'Escape' })
    window.removeEventListener('keydown', onWindow)
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Select by name' })).toBeNull(),
    )
    expect(onWindow).not.toHaveBeenCalled()
  })

  it('opts every row out of graph key handling', () => {
    setup({ nodes: canvas })
    openEdit()
    const rows = screen
      .getAllByRole('button')
      .filter((b) => /^(Undo|Cut|Delete)/.test(b.textContent ?? ''))
    expect(rows.length).toBe(3)
    for (const row of rows) expect(row.closest(`.${NO_GRAPH_KEYS}`)).not.toBeNull()
    for (const row of rows) expect(row.classList).toContain(NO_GRAPH_KEYS)
  })
})

describe('switching and dismissing', () => {
  // A real press is a pointerdown and then a click; fireEvent.click alone skips
  // the first half, which is what the dismissal listens to.
  const press = (el: Element) => {
    fireEvent.pointerDown(el)
    fireEvent.click(el)
  }

  it('opens edit in one click with the graph list open', () => {
    setup({ nodes: canvas })
    press(button(/Nightly/))
    expect(button('Weekly')).toBeTruthy()
    press(button('edit'))
    expect(button(/^Undo/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Weekly' })).toBeNull()
  })

  it('opens the overflow menu in one click with edit open', () => {
    setup()
    press(button('edit'))
    press(button('Graph actions'))
    expect(button('Save')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('closes a menu when its own button is pressed again', () => {
    setup()
    press(button('edit'))
    press(button('edit'))
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('closes any open menu when add opens the quick-add list', () => {
    const h = setup()
    openEdit()
    fireEvent.click(button('add'))
    expect(h.onAdd).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('closes on a press outside, and lets that press carry on', () => {
    setup()
    openEdit()
    const canvas = document.createElement('div')
    document.body.appendChild(canvas)
    const seen = vi.fn((e: Event) => e.defaultPrevented)
    canvas.addEventListener('pointerdown', seen)
    const down = new Event('pointerdown', { bubbles: true, cancelable: true })
    act(() => void canvas.dispatchEvent(down))
    canvas.remove()

    expect(seen).toHaveBeenCalledOnce()
    expect(down.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('has no full-screen backdrop in front of the canvas', () => {
    setup()
    openEdit()
    expect(document.querySelector('.fixed.inset-0')).toBeNull()
  })

  it('stays open for a press inside the menu, on its row, or in a fly-out', () => {
    setup({ nodes: canvas })
    openEdit()
    fireEvent.pointerDown(button(/^Undo/))
    fireEvent.click(button(/^Select by type/))
    fireEvent.pointerDown(button('Cron'))
    expect(button(/^Undo/)).toBeTruthy()
    expect(button('Cron')).toBeTruthy()
  })

  it('closes on Escape before the tile does', () => {
    setup()
    openEdit()
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', onWindow)
    expect(onWindow).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('does not hijack Escape typed into the rename field', () => {
    setup()
    openOverflow()
    fireEvent.click(button('Rename'))
    fireEvent.keyDown(screen.getByLabelText('Graph name'), { key: 'Escape' })
    expect(button('Rename')).toBeTruthy()
  })
})

describe('menus fade out', () => {
  it('keeps the rows, hidden from the tree, while the exit plays, then drops them', async () => {
    setup()
    openEdit()
    fireEvent.click(button('edit'))
    // Out of the accessibility tree at once, still in the document.
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
    expect(screen.getByText('Undo').closest('[aria-hidden="true"]')).not.toBeNull()
    await waitFor(() => expect(screen.queryByText('Undo')).toBeNull())
  })

  it('opens a new menu at once while the old one is still fading', () => {
    setup()
    openEdit()
    fireEvent.click(button('Graph actions'))
    expect(button('Save')).toBeTruthy()
    expect(screen.getByText('Undo').closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('the overflow menu', () => {
  it('saves', () => {
    const h = setup()
    openOverflow()
    fireEvent.click(button('Save'))
    expect(h.onSave).toHaveBeenCalledOnce()
  })

  it('shows a save in progress and disables the row', () => {
    setup({ saving: true })
    openOverflow()
    expect(button('Saving...').disabled).toBe(true)
  })

  it('renames in a row of its own, committing on Enter', () => {
    const h = setup()
    openOverflow()
    fireEvent.click(button('Rename'))
    const input = screen.getByLabelText('Graph name') as HTMLInputElement
    expect(input.value).toBe('Nightly')
    fireEvent.change(input, { target: { value: '  Hourly  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(h.onRename).toHaveBeenCalledWith('Hourly')
    expect(screen.queryByRole('textbox', { name: 'Graph name' })).toBeNull()
  })

  it('does not rename to a blank or an unchanged name', () => {
    const h = setup()
    openOverflow()
    fireEvent.click(button('Rename'))
    const input = screen.getByLabelText('Graph name')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    openOverflow()
    fireEvent.click(button('Rename'))
    fireEvent.keyDown(screen.getByLabelText('Graph name'), { key: 'Enter' })
    expect(h.onRename).not.toHaveBeenCalled()
  })

  it('backs out of a rename on Escape and starts over on reopen', () => {
    const h = setup()
    openOverflow()
    fireEvent.click(button('Rename'))
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    fireEvent.change(screen.getByLabelText('Graph name'), { target: { value: 'half typed' } })
    fireEvent.keyDown(screen.getByLabelText('Graph name'), { key: 'Escape' })
    window.removeEventListener('keydown', onWindow)
    expect(onWindow).not.toHaveBeenCalled()
    expect(button('Rename')).toBeTruthy()
    expect(h.onRename).not.toHaveBeenCalled()
  })

  it('duplicates and deletes the graph', () => {
    const h = setup()
    openOverflow()
    fireEvent.click(button('Duplicate graph'))
    openOverflow()
    fireEvent.click(button('Delete graph'))
    expect(h.onDuplicateGraph).toHaveBeenCalledOnce()
    expect(h.onDeleteGraph).toHaveBeenCalledOnce()
  })

  it('disables duplicate and delete before the graph exists', () => {
    setup({ graphId: '', graphName: 'New graph' })
    openOverflow()
    expect(button('Duplicate graph').disabled).toBe(true)
    expect(button('Delete graph').disabled).toBe(true)
    expect(button('Save').disabled).toBe(false)
    expect(button('Rename').disabled).toBe(false)
  })

  it('has no export or import rows yet', () => {
    setup()
    openOverflow()
    expect(screen.queryByRole('button', { name: /export|import/i })).toBeNull()
  })
})
