import React, { memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { SchedulerCtx } from './schedulerContext'
import { CATEGORY_COLOR, CATEGORY_ICON, CTRL_PORT_COLOR, PORT_TYPE_COLOR } from './blockMeta'
import type { BlockFlowNode, NodeData } from './graphMapping'
import { resolveDataPortType } from './portTypes'
import type { models } from '../../../../wailsjs/go/models'

const HEADER_H = 30
const INFO_H = 20
const ROW_H = 22
const PAD = 6

// Border/shadow per run-state — a closed set of 4 states, independent of the
// per-node computed height/category-color that must stay inline (see below).
// `.node-running`'s own CSS animation (scheduler.css) drives its box-shadow, so
// no shadow class is needed for that state.
const RUN_STATE_CLASS: Record<string, string> = {
  running: 'border-accent border-2',
  success: 'border-success border-2 shadow-[0_0_0_1px_#22c55e55,0_0_12px_#22c55e44]',
  failed: 'border-[#ef4444] border-2 shadow-[0_0_0_1px_#ef444466,0_0_12px_#ef444455]',
  cycle: 'border-warning border-thick shadow-[0_0_0_1px_#f59e0b55]',
}

export const BlockNode = memo(function BlockNode({ data, selected }: NodeProps<BlockFlowNode>) {
  const nd = data as NodeData
  const { blockDefs, collapsed, onToggleCollapse, nodeRunState, cycleNodes } =
    useContext(SchedulerCtx)
  const def = blockDefs.get(nd.blockType)

  const runState = nodeRunState.get(nd.id as string)
  const inCycle = cycleNodes.has(nd.id as string)

  const color = CATEGORY_COLOR[def?.category ?? ''] ?? '#6b7280'
  const icon = CATEGORY_ICON[def?.category ?? ''] ?? '?'

  const ctrlIns: string[] = def?.controlInputs ?? []
  const ctrlOuts: string[] = def?.controlOutputs ?? []
  const dataIns: models.DataPort[] = def?.dataInputs ?? []
  const dataOuts: models.DataPort[] = def?.dataOutputs ?? []

  const isCollapsed = collapsed.has(nd.id as string)

  // Required data-input port ids (always shown even when collapsed)
  const requiredKeys = new Set(
    (def?.configSchema ?? []).filter((f) => f.required).map((f) => f.key),
  )

  const visibleDataIns = isCollapsed ? dataIns.filter((p) => requiredKeys.has(p.id)) : dataIns

  type PortEntry = { id: string; label: string; color: string; isData: boolean }
  const leftPorts: PortEntry[] = [
    ...ctrlIns.map((p) => ({
      id: `ctrl:${p}`,
      label: p,
      color: CTRL_PORT_COLOR[p] ?? '#94a3b8',
      isData: false,
    })),
    ...visibleDataIns.map((p) => ({
      id: `data:${p.id}`,
      label: p.label,
      color: PORT_TYPE_COLOR[p.type] ?? '#60a5fa',
      isData: true,
    })),
  ]
  const rightPorts: PortEntry[] = [
    ...ctrlOuts.map((p) => ({
      id: `ctrl:${p}`,
      label: p,
      color: CTRL_PORT_COLOR[p] ?? '#22c55e',
      isData: false,
    })),
    ...dataOuts.map((p) => {
      const resolved = resolveDataPortType(def, p.id, 'output', nd.config)
      const portColor =
        resolved === 'unresolved' ? '#6b7280' : (PORT_TYPE_COLOR[resolved] ?? '#60a5fa')
      return { id: `data:${p.id}`, label: p.label, color: portColor, isData: true }
    }),
  ]

  // Show first non-empty required config value as a hint
  const hint = def?.configSchema
    ?.filter((f) => f.required && f.key !== '_collapsed')
    .map((f) => nd.config?.[f.key])
    .find((v) => v !== undefined && v !== '')

  // All data-input ports (used for rendering hidden handles so edges don't break)
  const allDataInPorts: PortEntry[] = dataIns.map((p) => ({
    id: `data:${p.id}`,
    label: p.label,
    color: PORT_TYPE_COLOR[p.type] ?? '#60a5fa',
    isData: true,
  }))
  const hiddenDataIns = isCollapsed
    ? allDataInPorts.filter((p) => !visibleDataIns.some((v) => `data:${v.id}` === p.id))
    : []

  const bodyH = Math.max(1, leftPorts.length, rightPorts.length) * ROW_H + PAD * 2
  const totalH = HEADER_H + (hint !== undefined ? INFO_H : 0) + bodyH
  const portTop = HEADER_H + (hint !== undefined ? INFO_H : 0) + PAD

  // Border/shadow: the 4 run-states are a closed set (RUN_STATE_CLASS); the
  // remaining default/selected case's color is a genuinely per-node dynamic
  // value (CATEGORY_COLOR), so it's the one part that must stay inline.
  let stateClass = ''
  let borderClass: string
  let borderStyle: { borderColor?: string } | undefined
  if (runState === 'running') {
    borderClass = RUN_STATE_CLASS.running
    stateClass = 'node-running'
  } else if (runState === 'success') {
    borderClass = RUN_STATE_CLASS.success
  } else if (runState === 'failed') {
    borderClass = RUN_STATE_CLASS.failed
  } else if (inCycle) {
    borderClass = RUN_STATE_CLASS.cycle
  } else if (selected) {
    borderClass = 'border-accent border-thick'
  } else {
    borderClass = 'border'
    borderStyle = { borderColor: color }
  }

  const hasExpandablePorts = dataIns.length > visibleDataIns.length || dataIns.length > 0

  return (
    <div
      className={`node-entrance bg-elevated relative min-w-[180px] overflow-hidden rounded ${stateClass} ${borderClass}`}
      // eslint-disable-next-line no-restricted-syntax -- height is computed from port count; --node-anim-delay is a per-node CSS custom property; default-state borderColor comes from the per-category CATEGORY_COLOR map, not a static value
      style={
        {
          '--node-anim-delay': `${data._animDelay ?? 0}ms`,
          height: totalH,
          ...borderStyle,
        } as React.CSSProperties
      }
    >
      {/* Header */}
      <div
        className="flex h-[30px] items-center gap-1.5 px-2.5"
        // eslint-disable-next-line no-restricted-syntax -- border color is derived from the per-category CATEGORY_COLOR map
        style={{ borderBottom: `0.5px solid ${color}20` }}
      >
        <span
          className="shrink-0 font-mono text-[10px] font-bold tracking-wider"
          // eslint-disable-next-line no-restricted-syntax -- color varies per block category (CATEGORY_COLOR)
          style={{ color }}
        >
          {icon}
        </span>
        <span className="text-text-primary flex-1 truncate font-mono text-[11px] font-semibold">
          {nd.label}
        </span>
        {hasExpandablePorts && (
          <span
            onClick={() => onToggleCollapse(nd.id as string)}
            className="nodrag text-text-faint shrink-0 cursor-pointer pl-1 font-mono text-[9px] select-none"
            title={isCollapsed ? 'Expand ports' : 'Collapse ports'}
          >
            {isCollapsed ? '▸' : '▾'}
          </span>
        )}
      </div>

      {/* Config hint */}
      {hint !== undefined && (
        <div className="text-text-faint border-border-subtle border-b-hairline flex h-5 items-center truncate px-2.5 font-mono text-[9px]">
          {String(hint)}
        </div>
      )}

      {/* Left port labels */}
      {leftPorts.map((p, i) => (
        <div
          key={p.id}
          className="absolute left-3.5 flex h-[22px] items-center font-mono text-[9px]"
          // eslint-disable-next-line no-restricted-syntax -- top is computed from port index/count; color is the port's data-type/control color
          style={{ top: portTop + i * ROW_H, color: p.color }}
        >
          {p.label}
        </div>
      ))}

      {/* Right port labels */}
      {rightPorts.map((p, i) => (
        <div
          key={p.id}
          className="absolute right-3.5 flex h-[22px] items-center text-right font-mono text-[9px]"
          // eslint-disable-next-line no-restricted-syntax -- top is computed from port index/count; color is the port's data-type/control color
          style={{ top: portTop + i * ROW_H, color: p.color }}
        >
          {p.label}
        </div>
      ))}

      {/* Left handles (visible) — the Handle box itself is the grab area,
          oversized vs. the small decorative dot rendered inside it. */}
      {leftPorts.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type="target"
          position={Position.Left}
          // The Handle's own box is xyflow's actual grab/drop hit area, not just
          // its visual dot — sized well past the visible dot (below) so
          // connections are easy to grab. Border comes from scheduler.css's
          // `.react-flow__handle` rule (needs `!important` to beat xyflow's own
          // inline-styled default).
          className="bg-hover flex h-[18px] w-[18px] items-center justify-center rounded-full"
          // eslint-disable-next-line no-restricted-syntax -- top is computed from port index/count
          style={{ top: portTop + i * ROW_H + ROW_H / 2 }}
        >
          <span
            className={`pointer-events-none block ${p.isData ? 'h-1.5 w-1.5 rounded-sm' : 'h-2 w-2 rounded-full'}`}
            // eslint-disable-next-line no-restricted-syntax -- port color varies by data-type/control-port kind
            style={{ background: p.color }}
          />
        </Handle>
      ))}

      {/* Hidden handles for collapsed data-in ports — keeps existing edges valid */}
      {hiddenDataIns.map((p) => (
        <Handle
          key={p.id}
          id={p.id}
          type="target"
          position={Position.Left}
          className="pointer-events-none h-0 w-0 opacity-0"
          // eslint-disable-next-line no-restricted-syntax -- top is computed from port index/count
          style={{ top: portTop + ROW_H / 2 }}
        />
      ))}

      {/* Right handles — same oversized-hit-area / small-dot split as the left side. */}
      {rightPorts.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type="source"
          position={Position.Right}
          // The Handle's own box is xyflow's actual grab/drop hit area, not just
          // its visual dot — sized well past the visible dot (below) so
          // connections are easy to grab. Border comes from scheduler.css's
          // `.react-flow__handle` rule (needs `!important` to beat xyflow's own
          // inline-styled default).
          className="bg-hover flex h-[18px] w-[18px] items-center justify-center rounded-full"
          // eslint-disable-next-line no-restricted-syntax -- top is computed from port index/count
          style={{ top: portTop + i * ROW_H + ROW_H / 2 }}
        >
          <span
            className={`pointer-events-none block ${p.isData ? 'h-1.5 w-1.5 rounded-sm' : 'h-2 w-2 rounded-full'}`}
            // eslint-disable-next-line no-restricted-syntax -- port color varies by data-type/control-port kind
            style={{ background: p.color }}
          />
        </Handle>
      ))}
    </div>
  )
})
