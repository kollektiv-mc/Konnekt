import type { Edge as FlowEdge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'
import { hasClipboard } from './clipboard'
import type { BlockFlowNode } from './graphMapping'
import { typesPresent, type SelectionSpec } from './selection'

/** What the rows need to know about the canvas to say what they can do. */
export interface EditMenuState {
  canUndo: boolean
  canRedo: boolean
  canPaste: boolean
  /** Nodes are selected: cut, copy and duplicate act on nodes, never on edges alone. */
  hasNodeSelection: boolean
  /** Selected nodes and edges together, the number Delete would remove. */
  deleteCount: number
  hasNodes: boolean
  /** The block types on the canvas, for the select-by-type rows. */
  types: { blockType: string; label: string }[]
  /** The type of the one selected block, whose docs page can open; null for none or several. */
  docsBlockType: string | null
}

/**
 * The state the rows read, taken from the canvas. The toolbar's menu and the
 * node's right-click menu both call this, so the two cannot disagree about what
 * is disabled. The clipboard is module state, not React state, so nothing
 * re-renders on a copy: a caller reads this when the menu opens or renders.
 */
export function editMenuState(canvas: {
  nodes: readonly BlockFlowNode[]
  edges: readonly FlowEdge[]
  defMap: ReadonlyMap<string, models.BlockDef>
  canUndo: boolean
  canRedo: boolean
}): EditMenuState {
  const selected = canvas.nodes.filter((n) => n.selected)
  const selectedNodes = selected.length
  return {
    canUndo: canvas.canUndo,
    canRedo: canvas.canRedo,
    canPaste: hasClipboard(),
    hasNodeSelection: selectedNodes > 0,
    deleteCount: selectedNodes + canvas.edges.filter((e) => e.selected).length,
    hasNodes: canvas.nodes.length > 0,
    types: typesPresent(canvas.nodes, (bt) => canvas.defMap.get(bt)?.label ?? bt),
    docsBlockType: selectedNodes === 1 ? selected[0].data.blockType : null,
  }
}

export interface EditMenuActions {
  undo: () => void
  redo: () => void
  cut: () => void
  copy: () => void
  duplicate: () => void
  paste: () => void
  deleteSelected: () => void
  select: (spec: SelectionSpec) => void
  openDocs: () => void
}

export type EditRow =
  | {
      kind: 'item'
      id: string
      label: string
      shortcut?: string
      disabled: boolean
      danger?: boolean
      onSelect: () => void
    }
  | {
      kind: 'group'
      id: string
      label: string
      disabled: boolean
      items: { id: string; label: string; onSelect: () => void }[]
    }
  | {
      kind: 'search'
      id: string
      label: string
      placeholder: string
      disabled: boolean
      onSubmit: (query: string) => void
    }
  | { kind: 'divider'; id: string }

// The chord as the user types it: Cmd on a Mac, Ctrl elsewhere. The handlers
// accept either (clipboard.ts), so this only decides what the row says.
const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent) ? 'Cmd' : 'Ctrl'

/**
 * The Edit menu as data. The toolbar renders it in a popover through
 * `EditMenuRows`; the node's right-click menu (`NodeMenu`, #181) takes the same
 * list and renders it in its own surface, so the set, the order, the shortcuts
 * and the rules for what is disabled live here and in one place.
 *
 * A row that has nothing to act on is disabled rather than left out: the menu
 * keeps one shape, and the shortcut stays visible to learn.
 */
export function editMenuRows(state: EditMenuState, actions: EditMenuActions): EditRow[] {
  const { hasNodeSelection } = state
  return [
    {
      kind: 'item',
      id: 'undo',
      label: 'Undo',
      shortcut: `${MOD}+Z`,
      disabled: !state.canUndo,
      onSelect: actions.undo,
    },
    {
      kind: 'item',
      id: 'redo',
      label: 'Redo',
      shortcut: `${MOD}+Shift+Z`,
      disabled: !state.canRedo,
      onSelect: actions.redo,
    },
    { kind: 'divider', id: 'd-history' },
    {
      kind: 'item',
      id: 'cut',
      label: 'Cut',
      shortcut: `${MOD}+X`,
      disabled: !hasNodeSelection,
      onSelect: actions.cut,
    },
    {
      kind: 'item',
      id: 'copy',
      label: 'Copy',
      shortcut: `${MOD}+C`,
      disabled: !hasNodeSelection,
      onSelect: actions.copy,
    },
    {
      kind: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      shortcut: `${MOD}+D`,
      disabled: !hasNodeSelection,
      onSelect: actions.duplicate,
    },
    {
      kind: 'item',
      id: 'paste',
      label: 'Paste',
      shortcut: `${MOD}+V`,
      disabled: !state.canPaste,
      onSelect: actions.paste,
    },
    { kind: 'divider', id: 'd-clipboard' },
    {
      kind: 'item',
      id: 'delete',
      label: state.deleteCount > 0 ? `Delete ${state.deleteCount}` : 'Delete',
      shortcut: 'Del',
      disabled: state.deleteCount === 0,
      danger: true,
      onSelect: actions.deleteSelected,
    },
    { kind: 'divider', id: 'd-delete' },
    {
      kind: 'item',
      id: 'select-all',
      label: 'Select all',
      disabled: !state.hasNodes,
      onSelect: () => actions.select({ kind: 'all' }),
    },
    {
      kind: 'item',
      id: 'deselect-all',
      label: 'Deselect all',
      disabled: state.deleteCount === 0,
      onSelect: () => actions.select({ kind: 'none' }),
    },
    {
      kind: 'group',
      id: 'select-type',
      label: 'Select by type',
      disabled: state.types.length === 0,
      items: state.types.map((t) => ({
        id: t.blockType,
        label: t.label,
        onSelect: () => actions.select({ kind: 'type', blockType: t.blockType }),
      })),
    },
    {
      kind: 'search',
      id: 'select-name',
      label: 'Select by name',
      placeholder: 'name contains',
      disabled: !state.hasNodes,
      onSubmit: (query) => actions.select({ kind: 'name', query }),
    },
    { kind: 'divider', id: 'd-select' },
    {
      kind: 'item',
      id: 'docs',
      label: 'Open docs',
      shortcut: 'F1',
      disabled: state.docsBlockType === null,
      onSelect: actions.openDocs,
    },
  ]
}
