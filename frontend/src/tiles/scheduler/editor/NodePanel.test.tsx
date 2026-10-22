import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { models } from '../../../../wailsjs/go/models'
import { NodePanel, type PanelTab } from './NodePanel'
import type { BlockFlowNode } from './graphMapping'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const def = (label: string) =>
  models.BlockDef.createFrom({
    id: `action.${label}`,
    category: 'action',
    label,
    description: `${label} description`,
    controlInputs: ['trigger'],
    controlOutputs: [],
    configSchema: [],
  })

const node = (id: string, blockType: string): BlockFlowNode =>
  ({
    id,
    type: 'block',
    position: { x: 0, y: 0 },
    data: { blockType, config: {} },
  }) as unknown as BlockFlowNode

const emptyGraph = () => models.Graph.createFrom({ id: 'g', name: 'g', nodes: [], edges: [] })

function setup(over: Partial<Parameters<typeof NodePanel>[0]> = {}) {
  const props = {
    node: node('n1', 'action.alpha') as BlockFlowNode | undefined,
    def: def('alpha') as models.BlockDef | undefined,
    edges: [],
    tab: 'config' as PanelTab,
    onTab: vi.fn(),
    onChange: vi.fn(),
    getGraph: emptyGraph,
    onPreview: vi.fn().mockResolvedValue(models.NodePreview.createFrom({ attributes: [] })),
    ...over,
  }
  const view = render(<NodePanel {...props} />)
  const again = (next: Partial<typeof props>) => view.rerender(<NodePanel {...props} {...next} />)
  return { props, again, ...view }
}

const panel = () => document.querySelector('.nokey') as HTMLElement

describe('NodePanel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the config tab by default', () => {
    setup()
    expect(screen.getByText('alpha description')).toBeTruthy()
    expect(screen.queryByText('Data preview')).toBeNull()
  })

  it('shows the data tab when it is the chosen one', async () => {
    setup({ tab: 'data' })
    await act(async () => {})
    expect(screen.getByText('Data preview')).toBeTruthy()
  })

  it('reports a tab click through onTab', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'data' }))
    expect(props.onTab).toHaveBeenCalledWith('data')
  })

  it('slides the tab highlight under the chosen tab', () => {
    const { again } = setup()
    const indicator = screen.getByTestId('node-panel-tab-indicator')
    expect(indicator.className).toContain('translate-x-0')
    expect(screen.getByRole('tab', { name: 'config' }).getAttribute('aria-selected')).toBe('true')
    again({ tab: 'data' })
    expect(indicator.className).toContain('translate-x-full')
    expect(screen.getByRole('tab', { name: 'data' }).getAttribute('aria-selected')).toBe('true')
  })

  it('brings the data pane in from the right', async () => {
    setup({ tab: 'data' })
    await act(async () => {})
    expect(screen.getByText('Data preview').closest('.node-panel-tab-in-data')).toBeTruthy()
  })

  it('opts out of the graph key handler', () => {
    setup()
    expect(panel()).toBeTruthy()
  })

  it('keeps the previous node on screen while it slides out', () => {
    const { again } = setup()
    again({ node: undefined, def: undefined })
    expect(screen.getByText('alpha description')).toBeTruthy()
    expect(panel().hasAttribute('inert')).toBe(true)
  })

  it('drops the contents once the exit is over', () => {
    const { again } = setup()
    again({ node: undefined, def: undefined })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByText('alpha description')).toBeNull()
  })

  it('crossfades only when one node replaces another', () => {
    const { again, container } = setup()
    expect(container.querySelector('.node-panel-swap')).toBeNull()
    again({ node: node('n2', 'action.beta'), def: def('beta') })
    expect(screen.getByText('beta description')).toBeTruthy()
    expect(container.querySelector('.node-panel-swap')).not.toBeNull()
  })

  it('does not crossfade a node picked after the panel has left', () => {
    const { again, container } = setup()
    again({ node: undefined, def: undefined })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    again({ node: node('n2', 'action.beta'), def: def('beta') })
    expect(container.querySelector('.node-panel-swap')).toBeNull()
  })
})
