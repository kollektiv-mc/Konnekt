import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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
  onToggleCollapse: (id: string) => void = () => {},
  flags: { advice?: string[]; failure?: string } = {},
): HTMLElement {
  const ctx: SchedulerCtxValue = {
    blockDefs: new Map([commandDef, declaringDef].map((d) => [d.id, d])),
    edges,
    collapsed: new Set(),
    onToggleCollapse,
    nodeRunState: new Map(),
    nodeDowntimeMs: downtimeMs === undefined ? new Map() : new Map([['n1', downtimeMs]]),
    nodeWarning: warning === undefined ? new Map() : new Map([['n1', warning]]),
    nodeAdvice: flags.advice === undefined ? new Map() : new Map([['n1', flags.advice]]),
    nodeFailure: flags.failure === undefined ? new Map() : new Map([['n1', flags.failure]]),
    firedEdges: new Set(),
    cycleNodes: new Set(),
    cycleEdges: new Set(),
    recordPre: () => {},
    curvedEdges: true,
    snapToGrid: false,
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
// The icon is the node's only carrier of the effect; its name and tooltip are the text.
const stopIcon = () => screen.queryByRole('img', { name: /^Stops the server/ })

describe('the server-stopping icon', () => {
  it('shows on the Stop preset', () => {
    renderNode('action.command', { command: '__stop__' })
    expect(stopIcon()).toBeTruthy()
  })

  it('shows on the Restart preset', () => {
    renderNode('action.command', { command: '__restart__' })
    expect(stopIcon()).toBeTruthy()
  })

  it('shows on a block that declares the effect', () => {
    renderNode('action.declares', {})
    expect(stopIcon()).toBeTruthy()
  })

  it('is absent from a command node with another command', () => {
    renderNode('action.command', { command: 'save-all' })
    expect(stopIcon()).toBeNull()
  })

  it('is absent from a command node with the Start preset', () => {
    renderNode('action.command', { command: '__start__' })
    expect(stopIcon()).toBeNull()
  })

  it('is absent from a command node whose command is wired in', () => {
    const wired = { id: 'e', source: 's', target: 'n1', targetHandle: 'data:command' } as Edge
    renderNode('action.command', { command: '__stop__' }, [wired])
    expect(stopIcon()).toBeNull()
  })

  it('is not mistaken for a wire into some other port or node', () => {
    const elsewhere = [
      { id: 'e1', source: 's', target: 'n1', targetHandle: 'ctrl:trigger' },
      { id: 'e2', source: 's', target: 'other', targetHandle: 'data:command' },
    ] as Edge[]
    renderNode('action.command', { command: '__stop__' }, elsewhere)
    expect(stopIcon()).toBeTruthy()
  })

  it('replaces the status line: no "Stops the server" text, no extra height', () => {
    const plain = renderNode('action.command', { command: 'save-all' })
    const plainH = plain.style.height
    cleanup()
    const stopping = renderNode('action.command', { command: '__stop__' })
    expect(screen.queryByText(BADGE)).toBeNull()
    expect(plainH).not.toBe('')
    expect(stopping.style.height).toBe(plainH)
  })

  it('sits in the header, after the collapse chevron', () => {
    renderNode('action.command', { command: '__stop__' })
    const chevron = screen.getByLabelText('Collapse ports')
    expect(chevron.compareDocumentPosition(stopIcon() as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})

// The header's triangle means "look at this block" and nothing else: the
// server-stopping effect has the power icon beside it.
describe('the warning triangle in the header', () => {
  const ADVICE = 'RCON is not confirmed, so players get no warning first.'
  const flag = () => screen.queryByTestId('node-flag')

  it('is absent from a block with no advice and no failure', () => {
    renderNode('action.command', { command: 'save-all' })
    expect(flag()).toBeNull()
  })

  it('shows grey, naming the warning, when the block has advice', () => {
    renderNode('action.command', { command: '__stop__' }, [], undefined, undefined, undefined, {
      advice: [ADVICE],
    })
    expect(flag()?.className).toContain('text-text-faint')
    expect(flag()?.className).not.toContain('text-danger')
    expect(flag()?.getAttribute('aria-label')).toBe(ADVICE)
    expect(flag()?.getAttribute('aria-label')).toBe(ADVICE)
  })

  it('turns red, naming the failure, when the block failed in the last run', () => {
    renderNode('action.command', { command: 'save-all' }, [], undefined, undefined, undefined, {
      failure: 'bucket unreachable',
    })
    expect(flag()?.className).toContain('text-danger')
    expect(flag()?.className).not.toContain('text-text-faint')
    expect(flag()?.getAttribute('aria-label')).toBe('Failed in the last run: bucket unreachable')
  })

  it('names a failure that came with no text', () => {
    renderNode('action.command', { command: 'save-all' }, [], undefined, undefined, undefined, {
      failure: '',
    })
    expect(flag()?.getAttribute('aria-label')).toBe('Failed in the last run')
  })

  it('stays red and lists both when a failed block also has advice', () => {
    renderNode('action.command', { command: '__stop__' }, [], undefined, undefined, undefined, {
      advice: [ADVICE],
      failure: 'boom',
    })
    expect(flag()?.className).toContain('text-danger')
    expect(flag()?.getAttribute('aria-label')).toBe(`Failed in the last run: boom\n${ADVICE}`)
  })

  it('is a different symbol from the one that marks a stop', () => {
    renderNode('action.command', { command: '__stop__' }, [], undefined, undefined, undefined, {
      advice: [ADVICE],
    })
    const stop = stopIcon() as HTMLElement
    expect(stop).not.toBe(flag())
    expect(stop.innerHTML).not.toBe((flag() as HTMLElement).innerHTML)
    expect(stop.className).not.toContain('text-danger')
  })

  it('adds no height to the node', () => {
    const plain = renderNode('action.command', { command: 'save-all' }).style.height
    cleanup()
    const flagged = renderNode(
      'action.command',
      { command: 'save-all' },
      [],
      undefined,
      undefined,
      undefined,
      {
        failure: 'x',
      },
    )
    expect(flagged.style.height).toBe(plain)
  })
})

describe('the tooltip on the server-stopping icon', () => {
  it('explains the effect when no downtime is known', () => {
    renderNode('action.declares', {})
    expect(stopIcon()?.getAttribute('aria-label')).toBe(BADGE)
  })

  it('adds the measured downtime when the last run reported one', () => {
    renderNode('action.declares', {}, [], 130_000)
    const icon = stopIcon()
    expect(icon?.getAttribute('aria-label')).toBe('Stops the server; last downtime 2m 10s')
    expect(icon?.getAttribute('aria-label')).toBe('Stops the server; last downtime 2m 10s')
  })

  it('does not change the node height', () => {
    const without = renderNode('action.declares', {})
    const withoutH = without.style.height
    cleanup()
    const withFigure = renderNode('action.declares', {}, [], 45_000)
    expect(withFigure.style.height).toBe(withoutH)
  })

  it('needs the effect: a node that stops nothing shows no figure', () => {
    renderNode('action.command', { command: 'save-all' }, [], 130_000)
    expect(screen.queryByLabelText(/downtime/)).toBeNull()
  })
})

describe('the collapse chevron', () => {
  it('is revealed by hovering the node, which carries the group', () => {
    const root = renderNode('action.command', { command: 'save-all' })
    expect(root.className).toMatch(/\bgroup\b/)
    const chevron = screen.getByLabelText('Collapse ports')
    expect(chevron.className).toContain('opacity-0')
    expect(chevron.className).toContain('group-hover:opacity-100')
    expect(chevron.className).toContain('nodrag')
  })

  it('still toggles the ports when clicked', () => {
    const onToggle = vi.fn()
    renderNode('action.command', { command: 'save-all' }, [], undefined, undefined, onToggle)
    fireEvent.click(screen.getByLabelText('Collapse ports'))
    expect(onToggle).toHaveBeenCalledWith('n1')
  })
})

describe('the warning a node reports after its work is done', () => {
  const WARNING = 'Prune skipped: s3 ListObjects dh/snapshots/: status 403 AccessDenied'

  it('shows muted, prefixed, on a node that stops nothing', () => {
    renderNode('action.command', { command: 'save-all' }, [], undefined, WARNING)
    const line = screen.getByText(`warning: ${WARNING}`)
    expect(line.className).toContain('text-text-muted')
    expect(stopIcon()).toBeNull()
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
    // The server-stopping icon is in the header, so it does not add a line of its own.
    const stopping = renderNode('action.declares', {})
    const stoppingH = parseFloat(stopping.style.height)
    cleanup()
    const both = renderNode('action.declares', {}, [], 45_000, WARNING)
    expect(parseFloat(both.style.height) - stoppingH).toBe(20)
    expect(stopIcon()).toBeTruthy()
    expect(screen.getByText(`warning: ${WARNING}`)).toBeTruthy()
  })
})

describe('the cursor glow', () => {
  it('is on a plain node, in the category colour', () => {
    const root = renderNode('action.command', { command: 'save-all' })
    expect(root.className).toContain('node-glow')
    expect(root.style.getPropertyValue('--node-glow')).toMatch(/^#|^rgb/)
  })

  it('draws its ring beside the node, not inside it', () => {
    const root = renderNode('action.command', { command: 'save-all' })
    const ring = root.nextElementSibling as HTMLElement
    expect(ring.className).toContain('node-glow-ring')
    expect(ring.style.getPropertyValue('--node-glow')).toBe(
      root.style.getPropertyValue('--node-glow'),
    )
    expect(root.querySelector('.node-glow-ring')).toBeNull()
  })
})
