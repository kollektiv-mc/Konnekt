/// <reference types="node" />
// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { models } from '../../../../wailsjs/go/models'
import {
  graphStopsServer,
  isCommandHandleWired,
  isCommandWired,
  nodeEffects,
  NODE_EFFECT_STOPS_SERVER,
  stoppingGraphIds,
} from './blockMeta'

// The same table backend/services/scheduler_effects_test.go reads, so the Go and
// TypeScript derivations of a node's effects are held to the same cases.
interface EffectCase {
  name: string
  type: string
  defEffects?: string[]
  config: Record<string, unknown>
  commandWired?: boolean
  want: string[]
}

const cases: EffectCase[] = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../backend/services/testdata/block_effects_cases.json', import.meta.url),
    ),
    'utf8',
  ),
)

describe('nodeEffects agrees with the Go derivation', () => {
  it('has cases to agree on', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it.each(cases)('$name', (c) => {
    const def = { effects: c.defEffects }
    expect(nodeEffects(def, c.type, c.config, c.commandWired ?? false)).toEqual(c.want)
  })

  it('gives none for a block this app does not know', () => {
    expect(nodeEffects(undefined, 'no.such.block', undefined, false)).toEqual([])
  })
})

const defs: models.BlockDef[] = [
  models.BlockDef.createFrom({ id: 'action.command', category: 'action' }),
  models.BlockDef.createFrom({
    id: 'action.example',
    category: 'action',
    effects: ['stopsServer'],
  }),
  models.BlockDef.createFrom({ id: 'trigger.interval', category: 'trigger' }),
]

function graph(
  id: string,
  enabled: boolean,
  nodes: Partial<models.Node>[],
  edges: models.Edge[] = [],
) {
  return models.Graph.createFrom({ id, name: id, enabled, nodes, edges })
}

const stopNode = { id: 'a', type: 'action.command', config: { command: '__stop__' } }

describe('graph-level helpers', () => {
  const byId = new Map(defs.map((d) => [d.id, d]))

  it('finds a stopping node in a graph', () => {
    expect(graphStopsServer(graph('g', true, [stopNode]), byId)).toBe(true)
    expect(
      graphStopsServer(graph('g', true, [{ id: 'x', type: 'action.example', config: {} }]), byId),
    ).toBe(true)
  })

  it('finds none in a graph without one', () => {
    expect(
      graphStopsServer(
        graph('g', true, [{ id: 'a', type: 'action.command', config: { command: 'save-all' } }]),
        byId,
      ),
    ).toBe(false)
    expect(graphStopsServer(graph('g', true, []), byId)).toBe(false)
  })

  it('reads a data edge into the command port as wired', () => {
    const wire = models.Edge.createFrom({
      id: 'e',
      kind: 'data',
      source: 's',
      sourcePort: 'value',
      target: 'a',
      targetPort: 'command',
    })
    expect(isCommandWired('a', [wire])).toBe(true)
    expect(isCommandWired('other', [wire])).toBe(false)
    expect(isCommandWired('a', [{ ...wire, kind: 'control' } as models.Edge])).toBe(false)
    expect(graphStopsServer(graph('g', true, [stopNode], [wire]), byId)).toBe(false)
  })

  it('reads the editor edge by its handle id', () => {
    expect(isCommandHandleWired('a', [{ target: 'a', targetHandle: 'data:command' }])).toBe(true)
    expect(isCommandHandleWired('a', [{ target: 'a', targetHandle: 'ctrl:trigger' }])).toBe(false)
    expect(isCommandHandleWired('a', [{ target: 'b', targetHandle: 'data:command' }])).toBe(false)
    expect(isCommandHandleWired('a', [{ target: 'a' }])).toBe(false)
  })

  it('lists only the enabled graphs that stop the server', () => {
    const ids = stoppingGraphIds(
      [
        graph('armed', true, [stopNode]),
        graph('off', false, [stopNode]),
        graph('plain', true, [
          { id: 'a', type: 'action.command', config: { command: 'save-all' } },
        ]),
      ],
      defs,
    )
    expect([...ids]).toEqual(['armed'])
  })

  it('names the one effect the way the Go side does', () => {
    expect(NODE_EFFECT_STOPS_SERVER).toBe('stopsServer')
  })
})
