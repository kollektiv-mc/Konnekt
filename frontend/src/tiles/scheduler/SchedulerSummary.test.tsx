import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { models } from '../../../wailsjs/go/models'
import { SchedulerSummary } from './SchedulerSummary'
import { ClassicSchedulerSummary } from './ClassicSchedulerSummary'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const blockDefs = [
  models.BlockDef.createFrom({ id: 'action.command', category: 'action', label: 'Command' }),
  models.BlockDef.createFrom({ id: 'trigger.interval', category: 'trigger', label: 'Interval' }),
]

function graph(id: string, name: string, command: string, enabled = true): models.Graph {
  return models.Graph.createFrom({
    id,
    name,
    enabled,
    nodes: [
      { id: 't', type: 'trigger.interval', config: {} },
      { id: 'a', type: 'action.command', config: { command } },
    ],
    edges: [],
  })
}

const HOUR = 60 * 60 * 1000
const soon = () => Date.now() + 2 * HOUR + 60_000
const later = () => Date.now() + 5 * HOUR + 60_000

describe('SchedulerSummary downtime', () => {
  it('says "next downtime" for an enabled graph that stops the server', () => {
    render(
      <SchedulerSummary
        graphs={[graph('g1', 'Nightly restart', '__restart__')]}
        blockDefs={blockDefs}
        nextRuns={{ g1: soon() }}
      />,
    )
    // The row and the headline both lead with the soonest run, which is this one.
    expect(screen.getAllByText(/^next downtime in 2h$/)).toHaveLength(2)
  })

  it('says "next" for a graph that does not', () => {
    render(
      <SchedulerSummary
        graphs={[graph('g1', 'Save', 'save-all')]}
        blockDefs={blockDefs}
        nextRuns={{ g1: soon() }}
      />,
    )
    expect(screen.getByText('next in 2h')).toBeTruthy()
    expect(screen.queryByText(/downtime/)).toBeNull()
  })

  it('marks only the stopping graph when the soonest run is another', () => {
    render(
      <SchedulerSummary
        graphs={[graph('g1', 'Save', 'save-all'), graph('g2', 'Restart', '__stop__')]}
        blockDefs={blockDefs}
        nextRuns={{ g1: soon(), g2: later() }}
      />,
    )
    // Headline: the soonest run is the save, so it is a plain "next".
    expect(screen.getByText('next in 2h')).toBeTruthy()
    // Row: the stopping graph is the one that reads "next downtime".
    expect(screen.getAllByText(/next downtime/)).toHaveLength(1)
    expect(screen.getByText('next downtime in 5h')).toBeTruthy()
  })

  it('leaves a disabled graph alone, whatever it contains', () => {
    render(
      <SchedulerSummary
        graphs={[graph('g1', 'Off', '__stop__', false)]}
        blockDefs={blockDefs}
        nextRuns={{ g1: soon() }}
      />,
    )
    expect(screen.queryByText(/downtime/)).toBeNull()
  })

  it('does not call a wired command a downtime', () => {
    const g = graph('g1', 'Wired', '__stop__')
    g.edges = [
      models.Edge.createFrom({
        id: 'e',
        kind: 'data',
        source: 't',
        sourcePort: 'value',
        target: 'a',
        targetPort: 'command',
      }),
    ]
    render(<SchedulerSummary graphs={[g]} blockDefs={blockDefs} nextRuns={{ g1: soon() }} />)
    expect(screen.queryByText(/downtime/)).toBeNull()
  })

  it('explains in the tooltip that the stop lands after the trigger', () => {
    render(
      <SchedulerSummary
        graphs={[graph('g1', 'Restart', '__restart__')]}
        blockDefs={blockDefs}
        nextRuns={{ g1: soon() }}
      />,
    )
    const row = screen.getAllByText(/^next downtime in 2h$/)[1]
    expect(row.getAttribute('title')).toMatch(/lands a little after/)
  })

  it('names an event-driven graph as before', () => {
    render(
      <SchedulerSummary
        graphs={[graph('g1', 'On join', '__stop__')]}
        blockDefs={blockDefs}
        nextRuns={{}}
      />,
    )
    expect(screen.getByText('on trigger')).toBeTruthy()
  })
})

describe('ClassicSchedulerSummary downtime', () => {
  it('reads "next downtime" in the footer and "downtime" on the row', () => {
    render(
      <ClassicSchedulerSummary
        graphs={[graph('g1', 'Nightly restart', '__restart__')]}
        blockDefs={blockDefs}
        nextRuns={{ g1: soon() }}
      />,
    )
    expect(screen.getByText('next downtime in 2h')).toBeTruthy()
    expect(screen.getByText(/^downtime\s*in 2h$/)).toBeTruthy()
  })

  it('reads "next run" when the graph does not stop the server', () => {
    render(
      <ClassicSchedulerSummary
        graphs={[graph('g1', 'Save', 'save-all')]}
        blockDefs={blockDefs}
        nextRuns={{ g1: soon() }}
      />,
    )
    expect(screen.getByText('next run in 2h')).toBeTruthy()
    expect(screen.queryByText(/downtime/)).toBeNull()
  })
})
