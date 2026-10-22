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
  downtimeMs?: number,
  warning?: string,
): HTMLElement {
  const ctx: SchedulerCtxValue = {
    blockDefs: new Map([commandDef, declaringDef].map((d) => [d.id, d])),
    edges,
    collapsed: new Set(),
    onToggleCollapse: () => {},
    nodeRunState: new Map(),
    nodeDowntimeMs: downtimeMs === undefined ? new Map() : new Map([['n1', downtimeMs]]),
    nodeWarning: warning === undefined ? new Map() : new Map([['n1', warning]]),
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

describe('the downtime figure on a server-stopping node', () => {
  it('shows the measured downtime beside the badge', () => {
    renderNode('action.declares', {}, [], 130_000)
    expect(screen.getByText(BADGE)).toBeTruthy()
    expect(screen.getByText('downtime 2m 10s')).toBeTruthy()
  })

  it('is absent when the last run reported none', () => {
    renderNode('action.declares', {})
    expect(screen.queryByText(/downtime/)).toBeNull()
  })

  it('does not change the node height', () => {
    const without = renderNode('action.declares', {})
    const withoutH = without.style.height
    cleanup()
    const withFigure = renderNode('action.declares', {}, [], 45_000)
    expect(withFigure.style.height).toBe(withoutH)
    expect(screen.getByText('downtime 45s')).toBeTruthy()
  })

  it('needs the badge: a node that stops nothing shows no figure', () => {
    renderNode('action.command', { command: 'save-all' }, [], 130_000)
    expect(screen.queryByText(/downtime/)).toBeNull()
  })
})

describe('the warning a node reports after its work is done', () => {
  const WARNING = 'Prune skipped: s3 ListObjects dh/snapshots/: status 403 AccessDenied'

  it('shows muted, prefixed, on a node that stops nothing', () => {
    renderNode('action.command', { command: 'save-all' }, [], undefined, WARNING)
    const line = screen.getByText(`warning: ${WARNING}`)
    expect(line.className).toContain('text-text-muted')
    expect(screen.queryByText(BADGE)).toBeNull()
  })

  it('carries the whole text as a tooltip, since the line is truncated', () => {
    renderNode('action.command', { command: 'save-all' }, [], undefined, WARNING)
    expect(screen.getByText(`warning: ${WARNING}`).getAttribute('title')).toBe(WARNING)
  })

  it('is absent when the last run reported none', () => {
    renderNode('action.command', { command: 'save-all' })
    expect(screen.queryByText(/warning:/)).toBeNull()
  })

  it('makes the node taller by exactly the status line, once', () => {
    const plain = renderNode('action.command', { command: 'save-all' })
    const plainH = parseFloat(plain.style.height)
    cleanup()
    const warned = renderNode('action.command', { command: 'save-all' }, [], undefined, WARNING)
    expect(parseFloat(warned.style.height) - plainH).toBe(20)
    cleanup()
    // A node that already has the badge line shares it rather than adding a second.
    const stopping = renderNode('action.declares', {})
    const stoppingH = parseFloat(stopping.style.height)
    cleanup()
    const both = renderNode('action.declares', {}, [], 45_000, WARNING)
    expect(parseFloat(both.style.height)).toBe(stoppingH)
    expect(screen.getByText('downtime 45s')).toBeTruthy()
    expect(screen.getByText(`warning: ${WARNING}`)).toBeTruthy()
  })
})

describe('the cursor glow', () => {
  it('is on a plain node, in the category colour', () => {
    const root = renderNode('action.command', { command: 'save-all' })
    expect(root.className).toContain('node-glow')
    expect(root.style.getPropertyValue('--node-glow')).toMatch(/^#|^rgb/)
  })
})
