import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Position, type EdgeProps } from '@xyflow/react'
import { AnimatedEdge } from './AnimatedEdge'
import { SchedulerCtx } from './schedulerContext'

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

function renderEdge(overrides: Partial<EdgeProps> = {}) {
  return render(
    <svg>
      <AnimatedEdge {...edgeProps(overrides)} />
    </svg>,
  )
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
      <SchedulerCtx.Provider
        value={{
          blockDefs: new Map(),
          edges: [],
          collapsed: new Set(),
          onToggleCollapse: () => {},
          nodeRunState: new Map(),
          firedEdges: new Set(['e1']),
          cycleNodes: new Set(),
          cycleEdges: new Set(),
        }}
      >
        <svg>
          <AnimatedEdge {...edgeProps({ selected: true })} />
        </svg>
      </SchedulerCtx.Provider>,
    )
    settle(container)
    const path = container.querySelector('.react-flow__edge-path')
    expect(path?.getAttribute('style')).toContain('drop-shadow')
  })
})
