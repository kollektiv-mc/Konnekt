import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReactFlowProvider, type Edge, type NodeProps } from '@xyflow/react'
import { models } from '../../../../wailsjs/go/models'
import { BlockNode } from './BlockNode'
import { SchedulerCtx, type SchedulerCtxValue } from './schedulerContext'
import type { BlockFlowNode } from './graphMapping'

vi.mock('../../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const commandDef = models.BlockDef.createFrom({
  id: 'action.command',
  category: 'action',
  label: 'Command',
  controlInputs: ['trigger'],
  controlOutputs: ['onComplete', 'onFailed'],
  dataInputs: [{ id: 'command', label: 'Command', type: 'string' }],
  dataOutputs: [{ id: 'command', label: 'Command sent', type: 'string' }],
  configSchema: [{ key: 'command', label: 'Command', type: 'command' }],
})

// A block that declares the effect itself, the way the Distant Horizons
// snapshot block will.
const declaringDef = models.BlockDef.createFrom({
  id: 'action.declares',
  category: 'action',
  label: 'Declares',
  controlInputs: ['trigger'],
  controlOutputs: ['onComplete'],
  effects: ['stopsServer'],
})

function renderNode(
  blockType: string,
  config: Record<string, unknown>,
  edges: Edge[] = [],
): HTMLElement {
  const ctx: SchedulerCtxValue = {
    blockDefs: new Map([commandDef, declaringDef].map((d) => [d.id, d])),
    edges,
    collapsed: new Set(),
    onToggleCollapse: () => {},
    nodeRunState: new Map(),
    firedEdges: new Set(),
    cycleNodes: new Set(),
    cycleEdges: new Set(),
  }
  const props = {
    id: 'n1',
    data: { id: 'n1', blockType, config, label: blockType },
    selected: false,
  } as unknown as NodeProps<BlockFlowNode>
  const { container } = render(
    <ReactFlowProvider>
      <SchedulerCtx.Provider value={ctx}>
        <BlockNode {...props} />
      </SchedulerCtx.Provider>
    </ReactFlowProvider>,
  )
  return container.firstElementChild as HTMLElement
}

const BADGE = 'Stops the server'

describe('the Stops the server badge', () => {
  it('shows on the Stop preset', () => {
    renderNode('action.command', { command: '__stop__' })
    expect(screen.getByText(BADGE)).toBeTruthy()
  })

  it('shows on the Restart preset', () => {
    renderNode('action.command', { command: '__restart__' })
    expect(screen.getByText(BADGE)).toBeTruthy()
  })

  it('shows on a block that declares the effect', () => {
    renderNode('action.declares', {})
    expect(screen.getByText(BADGE)).toBeTruthy()
  })

  it('is absent from a command node with another command', () => {
    renderNode('action.command', { command: 'save-all' })
    expect(screen.queryByText(BADGE)).toBeNull()
  })

  it('is absent from a command node with the Start preset', () => {
    renderNode('action.command', { command: '__start__' })
    expect(screen.queryByText(BADGE)).toBeNull()
  })

  it('is absent from a command node whose command is wired in', () => {
    const wired = { id: 'e', source: 's', target: 'n1', targetHandle: 'data:command' } as Edge
    renderNode('action.command', { command: '__stop__' }, [wired])
    expect(screen.queryByText(BADGE)).toBeNull()
  })

  it('is not mistaken for a wire into some other port or node', () => {
    const elsewhere = [
      { id: 'e1', source: 's', target: 'n1', targetHandle: 'ctrl:trigger' },
      { id: 'e2', source: 's', target: 'other', targetHandle: 'data:command' },
    ] as Edge[]
    renderNode('action.command', { command: '__stop__' }, elsewhere)
    expect(screen.getByText(BADGE)).toBeTruthy()
  })

  it('makes the node taller by exactly the badge line', () => {
    const plain = renderNode('action.command', { command: 'save-all' })
    const plainH = plain.style.height
    cleanup()
    const stopping = renderNode('action.command', { command: '__stop__' })
    // The ports and the hint line are the same in both, so the only difference
    // is the 20px badge line.
    expect(plainH).not.toBe('')
    expect(parseFloat(stopping.style.height) - parseFloat(plainH)).toBe(20)
  })
})
