import { useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { Edge as FlowEdge } from '@xyflow/react'
import { Popover } from '../../../components/ui/Popover'
import { Icon } from '../../../components/ui/Icon'
import { Check, Ellipsis, Plus, TriangleAlert } from '../../../lib/icons'
import { usePresence } from '../../../hooks/usePresence'
import type { models } from '../../../../wailsjs/go/models'
import { NO_GRAPH_KEYS } from './blockMeta'
import { EditMenuRows } from './EditMenu'
import { editMenuRows, editMenuState, type EditMenuActions } from './editMenuRows'
import { shortGraphId } from './graphId'
import type { BlockFlowNode } from './graphMapping'
import { warningLine, warningRows } from './graphWarnings'
import { MenuDivider, MenuRow } from './MenuRow'
import type { RunStatus } from './runStatus'
import { WarningsMenu } from './WarningsMenu'

/** The View menu's choices. The editor owns the preference; the bar only flips it. */
export interface ViewOptions {
  curvedEdges: boolean
  onToggleCurvedEdges: () => void
  snapToGrid: boolean
  onToggleSnapToGrid: () => void
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
  warnings: models.GraphWarning[]

  // The editor owns the state and the handlers; the bar only calls them.
  onLoadGraph: (g: models.Graph) => void
  onNewGraph: () => void
  /** Opens the quick-add list with its corner at this viewport point. */
  onAdd: (at: { x: number; y: number }) => void
  /** The quick-add list is open, from this button or any other way in. */
  addOpen?: boolean
  /**
   * The add button, held by the editor so the quick-add list can tell a press
   * on it from a press outside and let its click close the list (a toggle, like
   * the bar's other menus).
   */
  addButtonRef?: RefObject<HTMLButtonElement | null>
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
  /** A warning that names a block was picked in the list: select it and show it. */
  onSelectNode: (nodeId: string) => void
  /** The list's footer: raise the warnings as a notification bubble again. */
  onWarningsClick: () => void
}

type MenuId = 'graph' | 'edit' | 'view' | 'overflow' | 'warnings'

// The bar is two groups, each one bordered box of flush segments split by a
// hairline. Every segment is the same height and a fixed height at that, so
// the baseline is shared by construction rather than by matching paddings.
const GROUP = 'border-border-subtle border-hairline bg-surface flex shrink-0 rounded'
const SEGMENT_H = 'h-6'

// A menu row that is a switch: the check shows when it is on and keeps its room
// when it is off, so the label does not move as it flips.
function SwitchRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <MenuRow
      label={label}
      checked={on}
      leading={
        <Icon
          icon={Check}
          size="xs"
          className={`text-accent ${on ? 'opacity-100' : 'opacity-0'}`}
        />
      }
      onClick={onToggle}
    />
  )
}

/**
 * One cell of a group. It is the anchor a menu's popover hangs from, and it
 * owns the corner radius and the divider: the first cell has no divider and
 * rounds the group's left corners, the last rounds its right, and the button
 * inside takes whichever it got (`rounded-[inherit]`), so a hover fill never
 * squares off a rounded corner. Give it a width to fix one.
 */
function Segment({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`border-border-subtle border-l-hairline relative flex shrink-0 first:rounded-l first:border-l-0 last:rounded-r ${className}`}
    >
      {children}
    </div>
  )
}

// A segment's button or label: the same box whatever is in it. The tone and the
// fill are the caller's, so there is one colour utility on it, not two to race.
function segmentClass(tone: string, fill: string): string {
  return `${SEGMENT_H} text-1xs flex w-full items-center justify-center gap-1 rounded-[inherit] px-2 font-mono whitespace-nowrap transition-colors ${tone} ${fill}`
}
const IDLE_FILL = 'bg-transparent hover:bg-hover'

/**
 * The editor's toolbar: on the left one connected bar of the graph picker (its
 * name and unsaved dot), add and edit; on the right another of the warning
 * count, run, the on/off toggle and an overflow menu for what acts on the graph
 * as a whole. The run status sits in the gap between them.
 *
 * Nothing on the bar moves another item. The picker and the toggle have one
 * width in every state, the unsaved dot is overlaid on the picker's right end
 * rather than added beside the name, the warning count has a slot of its own
 * whether or not there is one, and the status lives in the gap, right-aligned,
 * so it grows into space nothing else is using.
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
  addOpen = false,
  addButtonRef,
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
  onSelectNode,
  onWarningsClick,
}: ToolbarProps) {
  // One menu open at a time, so opening one is closing the others. Each
  // popover's presence keeps its rows drawn while it fades (see usePresence);
  // the popover's own panel animates by transition, and a new menu opens at
  // once while the old one is still fading.
  const [menu, setMenu] = useState<MenuId | null>(null)
  const graphPresence = usePresence(menu === 'graph', 'menu')
  const editPresence = usePresence(menu === 'edit', 'menu')
  const viewPresence = usePresence(menu === 'view', 'menu')
  const overflowPresence = usePresence(menu === 'overflow', 'menu')
  const warningsPresence = usePresence(menu === 'warnings', 'menu')
  const graphButton = useRef<HTMLButtonElement>(null)
  const ownAddButton = useRef<HTMLButtonElement>(null)
  const addButton = addButtonRef ?? ownAddButton
  const editButton = useRef<HTMLButtonElement>(null)
  const viewButton = useRef<HTMLButtonElement>(null)
  const overflowButton = useRef<HTMLButtonElement>(null)
  const warningsButton = useRef<HTMLButtonElement>(null)
  // The rename draft lives in the overflow menu's own row; null is the row at
  // rest. Opening the menu clears it, so a reopen starts from the name again.
  // It is cleared on open rather than on close so the row does not flip back
  // to "Rename" while the menu is still fading out.
  const [renameDraft, setRenameDraft] = useState<string | null>(null)

  // The list goes with its last warning: a menu id left open with no button to
  // own it would open the list by itself on the next one.
  if (menu === 'warnings' && warnings.length === 0) setMenu(null)

  const toggleMenu = (id: MenuId) => {
    if (id === 'overflow' && menu !== 'overflow') setRenameDraft(null)
    setMenu((cur) => (cur === id ? null : id))
  }
  // A close that names its own menu, so a late close from one popover cannot
  // shut the menu that has since opened beside it.
  const closeMenu = (id: MenuId) => setMenu((cur) => (cur === id ? null : cur))

  const commitRename = () => {
    const name = (renameDraft ?? '').trim()
    if (name !== '' && name !== graphName) onRename(name)
    closeMenu('overflow')
  }

  // The clipboard is module state, not React state, so nothing re-renders the
  // bar when a copy lands. Opening the menu does, which is when this is read.
  const rows = editMenuRows(editMenuState({ nodes, edges, defMap, canUndo, canRedo }), edit)

  // Read when the list is drawn: the label is the node's as it is on the canvas.
  const warningList = warningRows(warnings, nodes)

  const graphLabel =
    graphId === null && graphs.length === 0 ? '— no graphs —' : graphName || 'Untitled'

  // The rows of a fading menu are out of the accessibility tree and the tab
  // order, so a menu that is closing is not one a keystroke can still reach.
  const fading = (leaving: boolean) => ({ 'aria-hidden': leaving || undefined, inert: leaving })

  return (
    <div
      className={`border-border-subtle bg-surface border-b-hairline flex shrink-0 flex-wrap items-center gap-2 px-3 py-1.5 ${NO_GRAPH_KEYS}`}
    >
      <div className={GROUP}>
        {/* Graph selector: the list and a way to start a new graph. The unsaved
            dot is laid over the right end of the name's field, and the name
            fades out before it (a mask, not an ellipsis, so nothing ends in
            "..." and nothing runs under the dot). Both the field and the room
            for the dot are there whether or not the dot is. */}
        <Segment className="w-60">
          <button
            ref={graphButton}
            type="button"
            onClick={() => toggleMenu('graph')}
            className={`${segmentClass('text-text-primary', menu === 'graph' ? 'bg-hover' : IDLE_FILL)} relative justify-start pr-5`}
          >
            {/* The graph's short id where an icon would sit, so the selector
                does not repeat the tile header's scheduler icon beside it.
                Hidden from the accessible name, which stays the graph's. */}
            <span
              aria-hidden="true"
              data-testid="graph-short-id"
              className="text-text-faint text-2xs w-7 shrink-0 text-left font-mono"
            >
              {shortGraphId(graphId)}
            </span>
            <span className="min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] text-left [-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)]">
              {graphLabel}
            </span>
            {dirty && (
              <span
                className="bg-accent absolute top-1/2 right-2 h-1.5 w-1.5 -translate-y-1/2 rounded-full"
                title="Unsaved changes"
              />
            )}
          </button>
          <Popover
            open={menu === 'graph'}
            onClose={() => closeMenu('graph')}
            dismiss="pointerdown"
            trigger={graphButton}
            width={240}
            maxHeight={280}
            align="left"
          >
            {graphPresence.mounted && (
              <div {...fading(graphPresence.leaving)}>
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
                        closeMenu('graph')
                      }}
                    />
                  )
                })}
                {graphId === '' && (
                  <MenuRow
                    label={graphName || 'Untitled'}
                    active
                    leading={<Icon icon={Check} size="xs" className="text-accent" />}
                    onClick={() => closeMenu('graph')}
                  />
                )}
                <MenuDivider />
                <MenuRow
                  label="New graph"
                  leading={<Icon icon={Plus} size="xs" className="text-text-faint" />}
                  onClick={() => {
                    onNewGraph()
                    closeMenu('graph')
                  }}
                />
              </div>
            )}
          </Popover>
        </Segment>

        {/* Add: the quick-add list, which is not a popover of ours, so the
            button closes whatever menu is open and says where its corner goes. */}
        <Segment>
          <button
            ref={addButton}
            type="button"
            className={`${segmentClass('text-text-muted', addOpen ? 'bg-hover' : IDLE_FILL)} px-3`}
            onClick={() => {
              setMenu(null)
              const r = addButton.current?.getBoundingClientRect()
              onAdd(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 })
            }}
          >
            add
          </button>
        </Segment>

        <Segment>
          <button
            ref={editButton}
            type="button"
            className={`${segmentClass('text-text-muted', menu === 'edit' ? 'bg-hover' : IDLE_FILL)} px-3`}
            onClick={() => toggleMenu('edit')}
          >
            edit
          </button>
          <Popover
            open={menu === 'edit'}
            onClose={() => closeMenu('edit')}
            dismiss="pointerdown"
            trigger={editButton}
            width={224}
            align="left"
          >
            {editPresence.mounted && (
              <div {...fading(editPresence.leaving)}>
                <EditMenuRows
                  rows={rows}
                  active={menu === 'edit'}
                  onDone={() => closeMenu('edit')}
                />
              </div>
            )}
          </Popover>
        </Segment>

        {/* View: how the canvas looks and behaves, as switches. Unlike the edit
            rows these stay open when flipped, so a choice shows on the canvas
            beside the menu and the next one is a click away. */}
        <Segment>
          <button
            ref={viewButton}
            type="button"
            className={`${segmentClass('text-text-muted', menu === 'view' ? 'bg-hover' : IDLE_FILL)} px-3`}
            onClick={() => toggleMenu('view')}
          >
            view
          </button>
          <Popover
            open={menu === 'view'}
            onClose={() => closeMenu('view')}
            dismiss="pointerdown"
            trigger={viewButton}
            width={200}
            align="left"
          >
            {viewPresence.mounted && (
              <div {...fading(viewPresence.leaving)}>
                <SwitchRow
                  label="Curved connectors"
                  on={view.curvedEdges}
                  onToggle={view.onToggleCurvedEdges}
                />
                <SwitchRow
                  label="Snap to grid"
                  on={view.snapToGrid}
                  onToggle={view.onToggleSnapToGrid}
                />
              </div>
            )}
          </Popover>
        </Segment>
      </div>

      {/* The status takes the gap between the groups and is right-aligned in
          it, so it grows into room nothing else is using and the bar never
          moves for it. IPC errors and a failed run stay until clicked. Two
          words here, whatever the message: the message is in a bubble, and the
          click moves it there if that was dismissed or its category is turned
          off. */}
      <div className="flex min-w-0 flex-1 items-center justify-end">
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
      </div>

      <div className={GROUP}>
        {/* The icon and a count, never the text: a bar that grows moves every
            control beside it, and a cut sentence cannot be read. The count opens
            a list of the warnings by block, below it, whose footer raises the
            bubble again. The slot is there at zero too,
            quiet, so a warning arriving fills it rather than pushing the rest
            of the bar along. */}
        <Segment className="w-11">
          {warnings.length > 0 ? (
            <>
              <button
                ref={warningsButton}
                type="button"
                onClick={() => toggleMenu('warnings')}
                className={segmentClass(
                  'text-warning',
                  menu === 'warnings' ? 'bg-hover' : IDLE_FILL,
                )}
                title={warningList.map(warningLine).join('\n')}
                aria-label={warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`}
                aria-haspopup="menu"
                aria-expanded={menu === 'warnings'}
              >
                <Icon icon={TriangleAlert} size="xs" />
                {warnings.length}
              </button>
              <Popover
                open={menu === 'warnings'}
                onClose={() => closeMenu('warnings')}
                dismiss="pointerdown"
                trigger={warningsButton}
                width={320}
                maxHeight={280}
                align="right"
              >
                {warningsPresence.mounted && (
                  <div {...fading(warningsPresence.leaving)}>
                    <WarningsMenu
                      rows={warningList}
                      onPick={(id) => {
                        onSelectNode(id)
                        closeMenu('warnings')
                      }}
                      onNotify={() => {
                        onWarningsClick()
                        closeMenu('warnings')
                      }}
                    />
                  </div>
                )}
              </Popover>
            </>
          ) : (
            <span className={segmentClass('text-text-faint', 'bg-transparent')} title="No warnings">
              <Icon icon={TriangleAlert} size="xs" />0
            </span>
          )}
        </Segment>

        {graphId && (
          <Segment>
            <button
              type="button"
              className={`${segmentClass('text-text-muted', IDLE_FILL)} px-3`}
              onClick={onRun}
            >
              run
            </button>
          </Segment>
        )}

        {graphId && (
          <Segment className="w-12">
            <button
              type="button"
              className={segmentClass(
                graphEnabled ? 'text-black' : 'text-text-muted',
                graphEnabled ? 'bg-accent' : IDLE_FILL,
              )}
              onClick={onToggleEnabled}
              aria-pressed={graphEnabled}
            >
              {graphEnabled ? '[on]' : '[off]'}
            </button>
          </Segment>
        )}

        {/* Overflow: what acts on the graph as a whole rather than on its nodes. */}
        <Segment className="w-8">
          <button
            ref={overflowButton}
            type="button"
            title="Graph actions"
            aria-label="Graph actions"
            onClick={() => toggleMenu('overflow')}
            className={segmentClass(
              'text-text-muted hover:text-text-primary',
              menu === 'overflow' ? 'bg-hover' : IDLE_FILL,
            )}
          >
            <Icon icon={Ellipsis} size="sm" />
          </button>
          <Popover
            open={menu === 'overflow'}
            onClose={() => closeMenu('overflow')}
            dismiss="pointerdown"
            trigger={overflowButton}
            width={176}
            align="right"
          >
            {overflowPresence.mounted && (
              <div {...fading(overflowPresence.leaving)}>
                <MenuRow
                  label={saving ? 'Saving...' : 'Save'}
                  disabled={saving}
                  onClick={() => {
                    onSave()
                    closeMenu('overflow')
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
                    closeMenu('overflow')
                  }}
                />
                <MenuDivider />
                <MenuRow
                  label="Delete graph"
                  danger
                  disabled={!graphId}
                  onClick={() => {
                    onDeleteGraph()
                    closeMenu('overflow')
                  }}
                />
              </div>
            )}
          </Popover>
        </Segment>
      </div>
    </div>
  )
}
