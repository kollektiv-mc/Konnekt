import { useMemo, useState } from 'react'
import type { Edge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'
import { usePresence, useRetained } from '../../../hooks/usePresence'
import { NO_GRAPH_KEYS } from './blockMeta'
import type { BlockFlowNode, NodeData } from './graphMapping'
import { NodeConfigPanel } from './NodeConfigPanel'
import { NodeDataPanel } from './NodeDataPanel'

export type PanelTab = 'config' | 'data'

interface Props {
  /** The selected node; undefined slides the panel out. */
  node: BlockFlowNode | undefined
  def: models.BlockDef | undefined
  edges: Edge[]
  tab: PanelTab
  onTab: (tab: PanelTab) => void
  onChange: (key: string, value: unknown) => void
  /** Called only while the data tab is showing, so a config edit never pays for it. */
  getGraph: () => models.Graph
  onPreview: (graph: models.Graph, nodeId: string) => Promise<models.NodePreview>
}

/**
 * The selected node's config and data tabs, floating over the right edge of the
 * canvas rather than taking a column beside it, so selecting never resizes the
 * canvas (#671). The canvas wrapper it sits in is `relative`.
 *
 * bg-overlay, not bg-surface: surface is a translucent tint, so over the canvas
 * the panel read as no background at all. Overlay is the opaque floating-panel
 * surface, with the hairline border and no shadow (#604).
 *
 * The shell stays mounted and only slides (a transition, so a node picked again
 * mid-exit reverses from where the panel is instead of restarting); its
 * contents are kept for as long as the exit runs and dropped after, so a closed
 * panel does not keep dry-running the graph. usePresence supplies that timer,
 * which is also the reduced-motion shortcut; its modal class names, `inert` and
 * `animationend` handler are for dialogs and go unused. The slide itself is
 * `motion-reduce:transition-none`.
 */
export function NodePanel({ node, def, edges, tab, onTab, onChange, getGraph, onPreview }: Props) {
  const open = node !== undefined
  const { mounted } = usePresence(open)
  const selection = useMemo(() => (node ? { node, def } : null), [node, def])
  // The exit has to draw the node the panel had, and the parent has already
  // cleared it.
  const held = useRetained(selection)

  // Whether the contents changed hands while the panel was already on screen,
  // which is what earns the crossfade. The first open slides and does not dip,
  // and a node picked after the panel has fully left is a first open again.
  const [shown, setShown] = useState<{ id: string | null; swap: boolean }>({
    id: null,
    swap: false,
  })
  if (!mounted) {
    if (shown.id !== null) setShown({ id: null, swap: false })
  } else if (held && shown.id !== held.node.id) {
    setShown({ id: held.node.id, swap: shown.id !== null })
  }

  return (
    <div
      // Also what keeps focus out of the closed panel, parked off to the side.
      inert={!open}
      aria-hidden={!open}
      className={`border-border-subtle bg-overlay border-hairline duration-panel ease-standard absolute top-2 right-2 bottom-2 z-10 flex w-60 flex-col overflow-y-auto rounded-lg transition-[translate,opacity] motion-reduce:transition-none ${NO_GRAPH_KEYS} ${
        open
          ? 'translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-[calc(100%+0.75rem)] opacity-0'
      }`}
    >
      {mounted && held && (
        <>
          <div className="border-border-subtle border-b-hairline flex shrink-0">
            {(['config', 'data'] as const).map((t) => (
              <button
                key={t}
                onClick={() => onTab(t)}
                className={`flex-1 cursor-pointer border-b py-1.5 font-mono text-xs ${
                  tab === t
                    ? 'bg-surface text-text-primary border-accent'
                    : 'text-text-faint border-transparent bg-transparent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Keyed on the node so the dip replays for each one picked. */}
          <div key={held.node.id} className={shown.swap ? 'node-panel-swap' : undefined}>
            {tab === 'config' ? (
              <NodeConfigPanel
                nodeId={held.node.id}
                data={held.node.data as NodeData}
                def={held.def}
                edges={edges}
                onChange={onChange}
              />
            ) : (
              <NodeDataPanel graph={getGraph()} nodeId={held.node.id} onPreview={onPreview} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
