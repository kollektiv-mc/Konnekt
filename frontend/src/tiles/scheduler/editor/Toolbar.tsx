import { useMemo, useRef, useState } from 'react'
import type { Edge as FlowEdge } from '@xyflow/react'
import { Popover } from '../../../components/ui/Popover'
import { Icon } from '../../../components/ui/Icon'
import { IconButton } from '../../../components/ui/IconButton'
import { Check, Ellipsis, Plus, TriangleAlert } from '../../../lib/icons'
import { usePopover } from '../../../hooks/usePopover'
import type { models } from '../../../../wailsjs/go/models'
import { NO_GRAPH_KEYS } from './blockMeta'
import { hasClipboard } from './clipboard'
import { EditMenuRows } from './EditMenu'
import { editMenuRows, type EditMenuActions } from './editMenuRows'
import type { BlockFlowNode } from './graphMapping'
import { MenuDivider, MenuRow } from './MenuRow'
import type { RunStatus } from './runStatus'
import { typesPresent } from './selection'

/** The View menu's choices. The editor owns the preference; the bar only flips it. */
export interface ViewOptions {
  curvedEdges: boolean
  onToggleCurvedEdges: () => void
}

interface ToolbarProps {
  graphs: models.Graph[]
  /** Null before anything loads, '' for a graph that has not been saved yet. */
  graphId: string | null
  graphName: string
  graphEnabled: boolean
  dirty: boolean
  saving: boolean
  nodes: BlockFlowNode[]
  edges: FlowEdge[]
  defMap: Map<string, models.BlockDef>
  canUndo: boolean
  canRedo: boolean
  runStatus: RunStatus | null
  schedulerError: string | null
  warnings: string[]

  // The editor owns the state and the handlers; the bar only calls them.
  onLoadGraph: (g: models.Graph) => void
  onNewGraph: () => void
  /** Opens the quick-add list with its corner at this viewport point. */
  onAdd: (at: { x: number; y: number }) => void
  edit: EditMenuActions
  view: ViewOptions
  onToggleEnabled: () => void
  onRun: () => void
  onSave: () => void
  onRename: (name: string) => void
  onDuplicateGraph: () => void
  onDeleteGraph: () => void
  onErrorClick: () => void
  onRunStatusClick: (status: RunStatus) => void
  onWarningsClick: () => void
}

// A small bordered button, the toolbar's one control shape. `active` fills it.
function btnClass(active = false, danger = false): string {
  const base = 'cursor-pointer rounded border-hairline px-2 py-0.5 text-1xs font-mono'
  const borderClass = danger ? 'border-danger' : 'border-border-subtle'
  if (active) return `${base} ${borderClass} bg-accent text-black`
  if (danger) return `${base} ${borderClass} bg-transparent text-danger`
  return `${base} ${borderClass} bg-surface text-text-muted`
}

// A button that opens a menu: the same shape, held in the hover surface while
// its menu is open so the bar says which one the menu belongs to.
function menuButtonClass(open: boolean): string {
  const base =
    'border-border-subtle text-text-muted border-hairline text-1xs shrink-0 cursor-pointer rounded px-2 py-0.5 font-mono transition-colors'
  return `${base} ${open ? 'bg-hover' : 'bg-surface hover:bg-hover'}`
}

/**
 * The editor's toolbar: the graph picker with its name and unsaved dot, the add
 * and edit menus, then on the right the status slot, run, the on/off toggle and
 * an overflow menu for what acts on the graph as a whole.
 *
 * Pulled out of GraphEditor (#133) so the menus have somewhere to grow. It
 * holds only what is about the bar itself: which menu is open, and the draft of
 * a rename in progress. The graph, the canvas and every handler stay with the
 * editor and arrive as props.
 *
 * `run`, the error and run-status indicator and the warning count stay on the
 * bar and out of every menu on purpose: they are what the user looks at
 * mid-run, and a menu hides what it holds.
 */
export function Toolbar({
  graphs,
  graphId,
  graphName,
  graphEnabled,
  dirty,
  saving,
  nodes,
  edges,
  defMap,
  canUndo,
  canRedo,
  runStatus,
  schedulerError,
  warnings,
  onLoadGraph,
  onNewGraph,
  onAdd,
  edit,
  view,
  onToggleEnabled,
  onRun,
  onSave,
  onRename,
  onDuplicateGraph,
  onDeleteGraph,
  onErrorClick,
  onRunStatusClick,
  onWarningsClick,
}: ToolbarProps) {
  const graphMenu = usePopover()
  const editMenu = usePopover()
  const viewMenu = usePopover()
  const overflowMenu = usePopover()
  const addButton = useRef<HTMLButtonElement>(null)
  // The rename draft lives in the overflow menu's own row; null is the row at
  // rest. The menu closing drops it, so a reopen starts from the name again.
  const [renameDraft, setRenameDraft] = useState<string | null>(null)

  const closeOverflow = () => {
    overflowMenu.close()
    setRenameDraft(null)
  }

  const commitRename = () => {
    const name = (renameDraft ?? '').trim()
    if (name !== '' && name !== graphName) onRename(name)
    closeOverflow()
  }

  const selectedNodes = nodes.filter((n) => n.selected).length
  const selectedCount = selectedNodes + edges.filter((e) => e.selected).length

  const types = useMemo(
    () => typesPresent(nodes, (bt) => defMap.get(bt)?.label ?? bt),
    [nodes, defMap],
  )
  // The clipboard is module state, not React state, so nothing re-renders the
  // bar when a copy lands. Opening the menu does, which is when this is read.
  const rows = editMenuRows(
    {
      canUndo,
      canRedo,
      canPaste: hasClipboard(),
      hasNodeSelection: selectedNodes > 0,
      deleteCount: selectedCount,
      hasNodes: nodes.length > 0,
      types,
    },
    edit,
  )

  const graphLabel =
    graphId === null && graphs.length === 0 ? '— no graphs —' : graphName || 'Untitled'

  return (
    <div
      className={`border-border-subtle bg-surface border-b-hairline flex shrink-0 flex-wrap items-center gap-2 px-3 py-1.5 ${NO_GRAPH_KEYS}`}
    >
      {/* Graph selector: the list, a way to start a new graph, and beside the
          name the dot that says the canvas has unsaved changes. */}
      <div className="relative shrink-0">
        <button
          onClick={graphMenu.toggle}
          className={`border-border-subtle text-text-primary border-hairline text-1xs flex max-w-[220px] shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 font-mono whitespace-nowrap transition-colors ${
            graphMenu.open ? 'bg-hover' : 'bg-canvas'
          }`}
        >
          <span className="text-text-faint text-2xs">☰</span>
          <span className="truncate">{graphLabel}</span>
          {dirty && (
            <span className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" title="Unsaved changes" />
          )}
        </button>

        <Popover
          open={graphMenu.open}
          onClose={graphMenu.close}
          width={180}
          maxHeight={280}
          align="left"
        >
          {graphMenu.open && (
            <>
              {graphs.length === 0 && graphId !== '' && (
                <div className="text-text-faint px-3 py-1.5 font-mono text-xs">— no graphs —</div>
              )}
              {graphs.map((g) => {
                const active = g.id === graphId
                return (
                  <MenuRow
                    key={g.id}
                    label={g.name || g.id}
                    active={active}
                    leading={
                      <Icon
                        icon={Check}
                        size="xs"
                        className={`text-accent ${active ? 'opacity-100' : 'opacity-0'}`}
                      />
                    }
                    onClick={() => {
                      onLoadGraph(g)
                      graphMenu.close()
                    }}
                  />
                )
              })}
              {graphId === '' && (
                <MenuRow
                  label={graphName || 'Untitled'}
                  active
                  leading={<Icon icon={Check} size="xs" className="text-accent" />}
                  onClick={graphMenu.close}
                />
              )}
              <MenuDivider />
              <MenuRow
                label="New graph"
                leading={<Icon icon={Plus} size="xs" className="text-text-faint" />}
                onClick={() => {
                  onNewGraph()
                  graphMenu.close()
                }}
              />
            </>
          )}
        </Popover>
      </div>

      {/* Add: the quick-add list, which is not a popover of ours, so the button
          only says where its corner goes. */}
      <button
        ref={addButton}
        type="button"
        className={menuButtonClass(false)}
        onClick={() => {
          const r = addButton.current?.getBoundingClientRect()
          onAdd(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 })
        }}
      >
        add
      </button>

      <div className="relative shrink-0">
        <button type="button" className={menuButtonClass(editMenu.open)} onClick={editMenu.toggle}>
          edit
        </button>
        <Popover
          open={editMenu.open}
          onClose={editMenu.close}
          width={224}
          maxHeight={360}
          align="left"
        >
          {editMenu.open && <EditMenuRows rows={rows} onDone={editMenu.close} />}
        </Popover>
      </div>

      {/* View: how the canvas looks and behaves, as switches. Unlike the edit
          rows these stay open when flipped, so a choice shows on the canvas
          beside the menu and the next one is a click away. */}
      <div className="relative shrink-0">
        <button type="button" className={menuButtonClass(viewMenu.open)} onClick={viewMenu.toggle}>
          view
        </button>
        <Popover open={viewMenu.open} onClose={viewMenu.close} width={200} align="left">
          {viewMenu.open && (
            <MenuRow
              label="Curved connectors"
              checked={view.curvedEdges}
              leading={
                <Icon
                  icon={Check}
                  size="xs"
                  className={`text-accent ${view.curvedEdges ? 'opacity-100' : 'opacity-0'}`}
                />
              }
              onClick={view.onToggleCurvedEdges}
            />
          )}
        </Popover>
      </div>

      <div className="flex-1" />

      {/* IPC errors and a failed run take the transient status slot and
          stay until clicked. Two words here, whatever the message: the
          message is in a bubble, and the click moves it there if that was
          dismissed or its category is turned off. */}
      {schedulerError ? (
        <button
          type="button"
          onClick={onErrorClick}
          className="text-danger text-2xs shrink-0 font-mono whitespace-nowrap"
          title={schedulerError}
        >
          scheduler error
        </button>
      ) : (
        runStatus &&
        (runStatus.failed ? (
          <button
            type="button"
            onClick={() => onRunStatusClick(runStatus)}
            className="text-danger text-2xs shrink-0 font-mono whitespace-nowrap"
            title={runStatus.detail}
          >
            {runStatus.text}
          </button>
        ) : (
          <span className="text-text-faint text-2xs shrink-0 font-mono whitespace-nowrap">
            {runStatus.text}
          </span>
        ))
      )}

      {selectedCount > 0 && (
        <button className={btnClass(false, true)} onClick={edit.deleteSelected}>
          del {selectedCount}
        </button>
      )}

      {/* The icon and a count, never the text: a bar that grows moves every
          control beside it, and a cut sentence cannot be read. The warnings
          are in a bubble, which this reopens. */}
      {warnings.length > 0 && (
        <button
          type="button"
          onClick={onWarningsClick}
          className="text-warning text-2xs flex shrink-0 items-center gap-1 font-mono whitespace-nowrap"
          title={warnings.join('\n')}
          aria-label={warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`}
        >
          <Icon icon={TriangleAlert} size="xs" />
          {warnings.length}
        </button>
      )}

      {graphId && (
        <button className={btnClass()} onClick={onRun}>
          run
        </button>
      )}

      {graphId && (
        <button
          className={btnClass(graphEnabled)}
          onClick={onToggleEnabled}
          aria-pressed={graphEnabled}
        >
          {graphEnabled ? '[on]' : '[off]'}
        </button>
      )}

      {/* Overflow: what acts on the graph as a whole rather than on its nodes. */}
      <div className="relative shrink-0">
        <IconButton
          title="Graph actions"
          onClick={overflowMenu.toggle}
          className={overflowMenu.open ? 'bg-hover' : ''}
        >
          <Icon icon={Ellipsis} size="sm" />
        </IconButton>
        <Popover open={overflowMenu.open} onClose={closeOverflow} width={176} align="right">
          {overflowMenu.open && (
            <>
              <MenuRow
                label={saving ? 'Saving...' : 'Save'}
                disabled={saving}
                onClick={() => {
                  onSave()
                  closeOverflow()
                }}
              />
              {renameDraft === null ? (
                <MenuRow label="Rename" onClick={() => setRenameDraft(graphName)} />
              ) : (
                <div className={`px-3 py-1 ${NO_GRAPH_KEYS}`}>
                  <input
                    autoFocus
                    type="text"
                    aria-label="Graph name"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') {
                        // Escape closes the maximized tile from a window listener;
                        // here it only backs out of the rename.
                        e.stopPropagation()
                        setRenameDraft(null)
                      }
                    }}
                    className="bg-canvas border-accent text-text-primary border-hairline text-1xs w-full rounded px-1.5 py-0.5 font-mono outline-none"
                  />
                </div>
              )}
              <MenuRow
                label="Duplicate graph"
                disabled={!graphId || saving}
                onClick={() => {
                  onDuplicateGraph()
                  closeOverflow()
                }}
              />
              <MenuDivider />
              <MenuRow
                label="Delete graph"
                danger
                disabled={!graphId}
                onClick={() => {
                  onDeleteGraph()
                  closeOverflow()
                }}
              />
            </>
          )}
        </Popover>
      </div>
    </div>
  )
}
