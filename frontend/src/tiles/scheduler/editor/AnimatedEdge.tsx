import { useContext, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useReactFlow, type EdgeProps } from '@xyflow/react'
import { SchedulerCtx } from './schedulerContext'
import { edgePath, edgeWaypoints, insertWaypoint, withWaypoints, type Point } from './edgeGeometry'

// Pointer travel, in screen px, before a press on a corner counts as a drag
// rather than the first half of a double-click, so a click leaves no undo entry.
const DRAG_THRESHOLD_PX = 3

export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const { firedEdges, cycleEdges, recordPre } = useContext(SchedulerCtx)
  const { setEdges, screenToFlowPosition } = useReactFlow()
  const [animDone, setAnimDone] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [draggingCorner, setDraggingCorner] = useState<number | null>(null)
  const drag = useRef<{ index: number; x: number; y: number; moved: boolean } | null>(null)

  const waypoints = edgeWaypoints(data)
  const source: Point = { x: sourceX, y: sourceY }
  const target: Point = { x: targetX, y: targetY }
  const d = edgePath([source, ...waypoints, target])

  // Corners live on `edge.data.waypoints`; every edit goes through setEdges and
  // so out through the editor's onEdgesChange, which is what marks the graph
  // dirty (graphSignature reads them) and lets undo restore them.
  const editWaypoints = (change: (current: Point[]) => Point[]) =>
    setEdges((es) =>
      es.map((e) =>
        e.id === id ? { ...e, data: withWaypoints(e.data, change(edgeWaypoints(e.data))) } : e,
      ),
    )

  const addCorner = (clientX: number, clientY: number) => {
    const at = screenToFlowPosition({ x: clientX, y: clientY })
    recordPre()
    editWaypoints((current) => insertWaypoint(source, current, target, at))
  }
  const removeCorner = (index: number) => {
    recordPre()
    editWaypoints((current) => current.filter((_, i) => i !== index))
  }

  const startDrag = (e: PointerEvent<SVGGElement>, index: number) => {
    if (e.button !== 0) return
    // Keep the press from reaching the pane (selection box) and the node layer.
    e.stopPropagation()
    // Capture keeps the moves coming when the pointer outruns the handle (and
    // leaves the canvas). Absent in jsdom, hence the guard.
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    drag.current = { index, x: e.clientX, y: e.clientY, moved: false }
    setDraggingCorner(index)
  }
  const moveDrag = (e: PointerEvent<SVGGElement>) => {
    const g = drag.current
    if (!g) return
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_THRESHOLD_PX) return
      g.moved = true
      // The first real movement is the one undo entry for the whole drag.
      recordPre()
    }
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    editWaypoints((current) => current.map((p, i) => (i === g.index ? at : p)))
  }
  const endDrag = () => {
    drag.current = null
    setDraggingCorner(null)
  }
  const delay = ((data as Record<string, unknown> | undefined)?._animDelay as number) ?? 0
  const isData = (data as Record<string, unknown> | undefined)?.kind === 'data'
  const baseDash = isData ? '4 2' : undefined

  const fired = firedEdges.has(id)
  const inCycle = cycleEdges.has(id)

  // Live/static highlight overrides the resting stroke. Fired (a control branch
  // that actually executed) wins over user selection, which wins over hover,
  // which wins over a static cycle warning. Applied after `...style` so it
  // wins even on data edges, whose inline `style.stroke` (the port's data-type
  // color) would otherwise beat a CSS-only `.selected`/`:hover` rule — this is
  // driven entirely from JS rather than CSS so both edge kinds behave the same.
  let highlight: CSSProperties = {}
  if (fired) {
    highlight = {
      stroke: 'var(--accent)',
      strokeWidth: 2.5,
      filter: 'drop-shadow(0 0 3px var(--accent))',
    }
  } else if (selected) {
    highlight = { stroke: 'var(--accent)', strokeWidth: 2.5 }
  } else if (hovered) {
    highlight = { stroke: 'color-mix(in srgb, var(--accent) 60%, black)', strokeWidth: 2 }
  } else if (inCycle) {
    highlight = { stroke: 'var(--warning)', strokeWidth: 2 }
  }

  // Wide, transparent hit target. xyflow's own `.react-flow__edge-path` rule
  // (@xyflow/react/dist/style.css) does NOT set `pointer-events: none` — only
  // the parent `.react-flow__edge` group gets `pointer-events: visibleStroke`,
  // which the visible path inherits. So the visible path below explicitly sets
  // `pointerEvents: 'none'` in its own style — without it, the visible path
  // (painted on top, in DOM order after this one) would intercept the pointer
  // wherever it's actually painted (a solid control edge's whole length, or a
  // data edge's dash marks), stealing hover from this path underneath and
  // firing a spurious mouseleave, since the visible path has no enter/leave
  // handler of its own. That produced exactly this flicker: hover dropping
  // mid-line or between dash gaps.
  const interaction = (
    <path
      // nopan: xyflow's zoom filter skips a double-click inside .nopan, which
      // would otherwise zoom the canvas instead of adding a corner.
      className="react-flow__edge-interaction nopan"
      d={d}
      fill="none"
      stroke="transparent"
      strokeWidth={20}
      // eslint-disable-next-line no-restricted-syntax -- xyflow SVG hit-test override, not expressible as a Tailwind utility on this element
      style={{ pointerEvents: 'stroke' }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        addCorner(e.clientX, e.clientY)
      }}
    >
      <title>Double-click to add a corner</title>
    </path>
  )

  // Corner handles show while the wire is hovered or selected, and stay up for
  // the length of a drag, when the pointer may have left the wire behind. Each
  // is a small dot inside a larger transparent hit circle, so it is easy to
  // grab. They sit inside the hover group below, so moving from the line onto a
  // handle does not read as leaving the wire.
  const showCorners = waypoints.length > 0 && (hovered || selected || draggingCorner !== null)
  const corners = showCorners
    ? waypoints.map((p, i) => (
        <g
          // Positional: a corner has no identity beyond its place in the list.
          key={i}
          className="nodrag nopan pointer-events-auto cursor-grab active:cursor-grabbing"
          data-corner={i}
          onPointerDown={(e) => startDrag(e, i)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onLostPointerCapture={endDrag}
          onDoubleClick={(e) => {
            e.stopPropagation()
            removeCorner(i)
          }}
        >
          <title>Drag to move, double-click to remove</title>
          <circle cx={p.x} cy={p.y} r={9} className="fill-transparent" />
          <circle cx={p.x} cy={p.y} r={4} className="fill-accent stroke-canvas" strokeWidth={1.5} />
        </g>
      ))
    : null

  // Entrance phase: normalize pathLength to 1 and animate stroke-dashoffset.
  const visible = !animDone ? (
    <path
      id={id}
      className="react-flow__edge-path edge-draw-in"
      d={d}
      pathLength={1}
      onAnimationEnd={() => setAnimDone(true)}
      // eslint-disable-next-line no-restricted-syntax -- xyflow-provided style spread + per-instance animation delay + computed run-state highlight
      style={{
        ...style,
        strokeDasharray: 1,
        animationDelay: `${delay}ms`,
        ...highlight,
        pointerEvents: 'none',
      }}
      markerEnd={markerEnd}
    />
  ) : (
    <path
      id={id}
      className="react-flow__edge-path"
      d={d}
      // eslint-disable-next-line no-restricted-syntax -- xyflow-provided style spread + computed run-state highlight
      style={{ ...style, strokeDasharray: baseDash, ...highlight, pointerEvents: 'none' }}
      markerEnd={markerEnd}
    />
  )

  // One group so hover covers the line and its corner handles together.
  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {interaction}
      {visible}
      {corners}
    </g>
  )
}
