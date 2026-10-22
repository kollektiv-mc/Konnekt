import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Position, ReactFlowProvider, useEdges, type Edge, type EdgeProps } from '@xyflow/react'
import { AnimatedEdge } from './AnimatedEdge'
import { SchedulerCtx, type SchedulerCtxValue } from './schedulerContext'
import { edgeWaypoints } from './edgeGeometry'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

// AnimatedEdge only reads a subset of EdgeProps; cast the minimal shape through
// `unknown` rather than filling in every optional field xyflow's type carries —
// same pattern as portTypes.test.ts's Wails-model stubs.
function edgeProps(overrides: Partial<EdgeProps> = {}): EdgeProps {
  return {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    ...overrides,
  } as unknown as EdgeProps
}

function renderEdge(overrides: Partial<EdgeProps> = {}, ctx: Partial<SchedulerCtxValue> = {}) {
  return render(
    <ReactFlowProvider>
      <SchedulerCtx.Provider value={ctxValue(ctx)}>
        <svg>
          <AnimatedEdge {...edgeProps(overrides)} />
        </svg>
      </SchedulerCtx.Provider>
    </ReactFlowProvider>,
  )
}

function ctxValue(overrides: Partial<SchedulerCtxValue> = {}): SchedulerCtxValue {
  return {
    blockDefs: new Map(),
    edges: [],
    collapsed: new Set(),
    onToggleCollapse: () => {},
    nodeRunState: new Map(),
    nodeDowntimeMs: new Map(),
    nodeWarning: new Map(),
    firedEdges: new Set(),
    cycleNodes: new Set(),
    cycleEdges: new Set(),
    recordPre: () => {},
    // Straight by default: most of these tests read the line's own geometry.
    curvedEdges: false,
    ...overrides,
  }
}

// An edge whose data lives in React Flow's store, the way the editor holds it,
// so the corner edits (which go through setEdges) can be read back.
function LiveEdge({ selected = true }: { selected?: boolean }) {
  const stored = useEdges().find((e) => e.id === 'e1')
  return (
    <svg>
      <AnimatedEdge {...edgeProps({ data: stored?.data, selected })} />
    </svg>
  )
}

function Probe({ onEdges }: { onEdges: (edges: Edge[]) => void }) {
  onEdges(useEdges())
  return null
}

function renderLive(
  waypoints: { x: number; y: number }[],
  selected = true,
  ctx: Partial<SchedulerCtxValue> = {},
) {
  const recordPre = vi.fn()
  let latest: Edge[] = []
  const utils = render(
    <ReactFlowProvider
      defaultEdges={[{ id: 'e1', source: 'a', target: 'b', data: { kind: 'control', waypoints } }]}
    >
      <SchedulerCtx.Provider value={ctxValue({ recordPre, ...ctx })}>
        <LiveEdge selected={selected} />
        <Probe onEdges={(e) => (latest = e)} />
      </SchedulerCtx.Provider>
    </ReactFlowProvider>,
  )
  settle(utils.container)
  return { ...utils, recordPre, corners: () => edgeWaypoints(latest[0]?.data) }
}

// The entrance animation branch renders first; settle it so tests exercise the
// steady-state path (the one visible for the vast majority of an edge's life).
function settle(container: HTMLElement) {
  const drawIn = container.querySelector('.edge-draw-in')
  if (drawIn) fireEvent.animationEnd(drawIn)
}

describe('AnimatedEdge', () => {
  it('renders a wide transparent interaction path so clicks land off the thin visible stroke', () => {
    const { container } = renderEdge()
    const interaction = container.querySelector('.react-flow__edge-interaction')
    expect(interaction).not.toBeNull()
    expect(interaction?.getAttribute('stroke')).toBe('transparent')
    expect(Number(interaction?.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(20)
  })

  it('keeps the interaction path present after the entrance animation settles', () => {
    const { container } = renderEdge()
    settle(container)
    expect(container.querySelector('.react-flow__edge-interaction')).not.toBeNull()
  })

  // Regression guard: xyflow's `.react-flow__edge` group sets `pointer-events:
  // visibleStroke` (not `.react-flow__edge-path` itself, which has no
  // pointer-events rule at all), so without an explicit override the visible
  // path — painted on top, in DOM order — intercepts hover wherever it's
  // actually painted (a solid line's whole length, or a dashed line's dash
  // marks) and steals it from the interaction path underneath, which has no
  // handler of its own there, causing hover to flicker off.
  it('keeps the visible path out of hit-testing so it cannot steal hover from the interaction path', () => {
    const { container } = renderEdge()
    settle(container)
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style')).toContain('pointer-events: none')
  })

  it('keeps the visible path non-interactive during the entrance animation too', () => {
    const { container } = renderEdge()
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style')).toContain('pointer-events: none')
  })

  it('highlights the visible path with the accent color when selected', () => {
    const { container } = renderEdge({ selected: true })
    settle(container)
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style')).toContain('stroke: var(--accent)')
    expect(path?.getAttribute('style')).toContain('stroke-width: 2.5')
  })

  it('does not highlight the path when not selected', () => {
    const { container } = renderEdge({ selected: false })
    settle(container)
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style') ?? '').not.toContain('var(--accent)')
  })

  it('wins the selected highlight over an inline data-edge stroke override', () => {
    const { container } = renderEdge({
      selected: true,
      style: { stroke: '#60a5fa' },
      data: { kind: 'data' },
    })
    settle(container)
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style')).toContain('stroke: var(--accent)')
  })

  it('highlights the visible path with a darker accent on hover', () => {
    const { container } = renderEdge()
    settle(container)
    const interaction = container.querySelector('.react-flow__edge-interaction')!
    fireEvent.mouseEnter(interaction)
    const path = container.querySelector('.react-flow__edge-path')
    const hoverStyle = path?.getAttribute('style') ?? ''
    expect(hoverStyle).toContain('color-mix(in srgb, var(--accent) 60%, black)')
    expect(hoverStyle).not.toContain('stroke: var(--accent);')

    fireEvent.mouseLeave(interaction)
    expect(
      container.querySelector('.react-flow__edge-path')?.getAttribute('style') ?? '',
    ).not.toContain('color-mix')
  })

  it('lets selection win over hover so they read as visually distinct states', () => {
    const { container } = renderEdge({ selected: true })
    settle(container)
    const interaction = container.querySelector('.react-flow__edge-interaction')!
    fireEvent.mouseEnter(interaction)
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style')).toContain('stroke: var(--accent);')
    expect(path?.getAttribute('style')).not.toContain('color-mix')
  })

  it('lets a fired edge win over selection', () => {
    const { container } = render(
      <ReactFlowProvider>
        <SchedulerCtx.Provider value={ctxValue({ firedEdges: new Set(['e1']) })}>
          <svg>
            <AnimatedEdge {...edgeProps({ selected: true })} />
          </svg>
        </SchedulerCtx.Provider>
      </ReactFlowProvider>,
    )
    settle(container)
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style')).toContain('drop-shadow')
  })

  it('draws a straight line between the endpoints when there are no corners', () => {
    const { container } = renderEdge()
    expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toBe('M0,0 L100,0')
  })

  it('routes the visible path and the hit target through the corners', () => {
    const { container } = renderEdge({ data: { waypoints: [{ x: 50, y: 40 }] } })
    const d = container.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? ''
    expect(d).toContain('Q50,40')
    expect(container.querySelector('.react-flow__edge-interaction')?.getAttribute('d')).toBe(d)
  })

  it('draws a curve leaving and entering horizontally when curved connectors are on', () => {
    const { container } = renderEdge({ sourceY: 0, targetY: 100 }, { curvedEdges: true })
    expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toBe(
      'M0,0 C50,0 50,100 100,100',
    )
  })

  it('curves through the corners and gives the hit target the same path', () => {
    const { container } = renderEdge(
      { data: { waypoints: [{ x: 50, y: 40 }] } },
      { curvedEdges: true },
    )
    const d = container.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? ''
    expect(d).toContain('C')
    expect(d).not.toContain('L')
    expect(d).toContain(' 50,40 ')
    expect(container.querySelector('.react-flow__edge-interaction')?.getAttribute('d')).toBe(d)
  })

  it('keeps the draw-in normalisation on a routed edge', () => {
    const { container } = renderEdge({ data: { waypoints: [{ x: 50, y: 40 }] } })
    expect(container.querySelector('.edge-draw-in')?.getAttribute('pathLength')).toBe('1')
  })
})

describe('AnimatedEdge corners', () => {
  const corner = [{ x: 50, y: 40 }]

  it('hides the handles until the wire is hovered or selected', () => {
    const { container } = renderLive(corner, false)
    expect(container.querySelector('[data-corner]')).toBeNull()
    fireEvent.mouseEnter(container.querySelector('.react-flow__edge-interaction')!)
    expect(container.querySelector('[data-corner]')).not.toBeNull()
  })

  it('shows a handle per corner on a selected wire', () => {
    const { container } = renderLive([...corner, { x: 80, y: 40 }])
    expect(container.querySelectorAll('[data-corner]')).toHaveLength(2)
  })

  it('shows no handles on a straight wire, even selected', () => {
    const { container } = renderLive([])
    expect(container.querySelector('[data-corner]')).toBeNull()
  })

  it('adds a corner at the cursor on double-click and records one undo entry', async () => {
    const { container, recordPre, corners } = renderLive([])
    fireEvent.doubleClick(container.querySelector('.react-flow__edge-interaction')!, {
      clientX: 40,
      clientY: 12,
    })
    await waitFor(() => expect(corners()).toEqual([{ x: 40, y: 12 }]))
    expect(recordPre).toHaveBeenCalledTimes(1)
  })

  it('removes a corner on double-click and records one undo entry', async () => {
    const { container, recordPre, corners } = renderLive(corner)
    fireEvent.doubleClick(container.querySelector('[data-corner="0"]')!)
    await waitFor(() => expect(corners()).toEqual([]))
    expect(recordPre).toHaveBeenCalledTimes(1)
  })

  it('does not add a corner when a corner is double-clicked', async () => {
    const { container, corners } = renderLive(corner)
    fireEvent.doubleClick(container.querySelector('[data-corner="0"]')!)
    await waitFor(() => expect(corners()).toEqual([]))
  })

  it('moves a corner with the pointer and records the drag once', async () => {
    const { container, recordPre, corners } = renderLive(corner)
    const handle = container.querySelector('[data-corner="0"]')!
    fireEvent.pointerDown(handle, { clientX: 50, clientY: 40, button: 0 })
    fireEvent.pointerMove(handle, { clientX: 60, clientY: 55 })
    fireEvent.pointerMove(handle, { clientX: 70, clientY: 70 })
    fireEvent.pointerUp(handle, { clientX: 70, clientY: 70 })
    await waitFor(() => expect(corners()).toEqual([{ x: 70, y: 70 }]))
    expect(recordPre).toHaveBeenCalledTimes(1)
  })

  it('leaves no undo entry for a press that never moves', () => {
    const { container, recordPre, corners } = renderLive(corner)
    const handle = container.querySelector('[data-corner="0"]')!
    fireEvent.pointerDown(handle, { clientX: 50, clientY: 40, button: 0 })
    fireEvent.pointerMove(handle, { clientX: 51, clientY: 40 })
    fireEvent.pointerUp(handle, { clientX: 51, clientY: 40 })
    expect(recordPre).not.toHaveBeenCalled()
    expect(corners()).toEqual(corner)
  })

  it('edits corners the same way with curved connectors on', async () => {
    const { container, recordPre, corners } = renderLive(
      [
        { x: 30, y: 0 },
        { x: 70, y: 0 },
      ],
      true,
      { curvedEdges: true },
    )
    // Near the last stretch (second corner to target), so it lands at the end.
    fireEvent.doubleClick(container.querySelector('.react-flow__edge-interaction')!, {
      clientX: 85,
      clientY: 2,
    })
    await waitFor(() => expect(corners()).toHaveLength(3))
    expect(corners()[2]).toEqual({ x: 85, y: 2 })

    const handle = container.querySelector('[data-corner="0"]')!
    fireEvent.pointerDown(handle, { clientX: 30, clientY: 0, button: 0 })
    fireEvent.pointerMove(handle, { clientX: 40, clientY: 20 })
    fireEvent.pointerUp(handle, { clientX: 40, clientY: 20 })
    await waitFor(() => expect(corners()[0]).toEqual({ x: 40, y: 20 }))

    fireEvent.doubleClick(container.querySelector('[data-corner="1"]')!)
    await waitFor(() => expect(corners()).toHaveLength(2))
    expect(recordPre).toHaveBeenCalledTimes(3)
  })

  it('keeps the handles up for the whole drag, even off the wire', () => {
    const { container } = renderLive(corner, false)
    fireEvent.mouseEnter(container.querySelector('.react-flow__edge-interaction')!)
    const handle = container.querySelector('[data-corner="0"]')!
    fireEvent.pointerDown(handle, { clientX: 50, clientY: 40, button: 0 })
    fireEvent.mouseLeave(container.querySelector('g')!)
    expect(container.querySelector('[data-corner]')).not.toBeNull()
  })
})
