import { describe, it, expect, beforeEach } from 'vitest'
import type { Edge as FlowEdge } from '@xyflow/react'
import type { BlockFlowNode } from './graphMapping'
import {
  PASTE_OFFSET,
  captureSelection,
  clearClipboard,
  clipboardAction,
  hasClipboard,
  instantiateSlice,
  pasteDelta,
  pasteStep,
  readClipboard,
  sliceOrigin,
  writeClipboard,
} from './clipboard'

function node(id: string, x: number, y: number, selected = false): BlockFlowNode {
  return {
    id,
    type: 'block',
    position: { x, y },
    selected,
    data: { blockType: 'action.command', config: { command: id, list: [1] }, label: 'Command' },
  }
}

function edge(id: string, source: string, target: string): FlowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'ctrl:onComplete',
    targetHandle: 'ctrl:trigger',
    type: 'smoothstep',
    data: { kind: 'control', _animDelay: 300 },
  }
}

beforeEach(clearClipboard)

describe('captureSelection', () => {
  it('is null when nothing is selected', () => {
    expect(captureSelection([node('a', 0, 0)], [])).toBeNull()
  })

  it('keeps edges between two selected nodes', () => {
    const slice = captureSelection(
      [node('a', 0, 0, true), node('b', 100, 0, true)],
      [edge('e1', 'a', 'b')],
    )
    expect(slice?.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(slice?.edges.map((e) => e.id)).toEqual(['e1'])
  })

  it('drops an edge with one end outside the selection', () => {
    const slice = captureSelection(
      [node('a', 0, 0, true), node('b', 100, 0, true), node('c', 200, 0)],
      [edge('in', 'a', 'b'), edge('out', 'b', 'c'), edge('from', 'c', 'a')],
    )
    expect(slice?.edges.map((e) => e.id)).toEqual(['in'])
  })

  it('leaves out what React Flow and the load animation keep on a node', () => {
    const n = node('a', 0, 0, true)
    n.data = { ...n.data, _animDelay: 120 }
    const slice = captureSelection([{ ...n, measured: { width: 200, height: 80 } }], [])
    expect(slice?.nodes[0]).not.toHaveProperty('selected')
    expect(slice?.nodes[0]).not.toHaveProperty('measured')
    expect(slice?.nodes[0].data).not.toHaveProperty('_animDelay')
  })

  it('copies config deeply, so editing the original cannot reach the clipboard', () => {
    const n = node('a', 0, 0, true)
    const slice = captureSelection([n], [])
    ;(n.data.config.list as number[]).push(2)
    n.data.config.command = 'changed'
    expect(slice?.nodes[0].data.config).toEqual({ command: 'a', list: [1] })
  })
})

describe('instantiateSlice', () => {
  const slice = () =>
    captureSelection(
      [node('a', 10, 20, true), node('b', 110, 70, true)],
      [edge('e1', 'a', 'b')],
    ) as NonNullable<ReturnType<typeof captureSelection>>

  it('gives every node and edge a fresh id', () => {
    const s = slice()
    const { nodes, edges } = instantiateSlice(s, { x: 0, y: 0 })
    const ids = [...nodes.map((n) => n.id), ...edges.map((e) => e.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const old of ['a', 'b', 'e1']) expect(ids).not.toContain(old)
  })

  it('remaps the edge ends onto the new nodes', () => {
    const { nodes, edges } = instantiateSlice(slice(), { x: 0, y: 0 })
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(nodes[0].id)
    expect(edges[0].target).toBe(nodes[1].id)
    expect(edges[0].sourceHandle).toBe('ctrl:onComplete')
    expect(edges[0].targetHandle).toBe('ctrl:trigger')
  })

  it('moves every node by the delta and returns them selected', () => {
    const { nodes, edges } = instantiateSlice(slice(), { x: 5, y: -4 })
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 15, y: 16 },
      { x: 115, y: 66 },
    ])
    expect(nodes.every((n) => n.selected)).toBe(true)
    expect(edges[0].selected).toBe(false)
  })

  it('leaves the slice reusable and its config unshared', () => {
    const s = slice()
    const first = instantiateSlice(s, { x: 0, y: 0 })
    const second = instantiateSlice(s, { x: 0, y: 0 })
    expect(first.nodes[0].id).not.toBe(second.nodes[0].id)
    first.nodes[0].data.config.command = 'edited'
    expect(second.nodes[0].data.config.command).toBe('a')
    expect(s.nodes[0].data.config.command).toBe('a')
  })

  it('carries the edge kind and style, minus the animation stagger', () => {
    const { edges } = instantiateSlice(slice(), { x: 0, y: 0 })
    expect(edges[0].data).toEqual({ kind: 'control' })
    expect(edges[0].type).toBe('smoothstep')
  })
})

describe('pasteDelta', () => {
  const slice = () =>
    captureSelection([node('a', 10, 20, true), node('b', 110, 5, true)], []) as NonNullable<
      ReturnType<typeof captureSelection>
    >

  it('finds the top-left of the box the nodes occupy', () => {
    expect(sliceOrigin(slice())).toEqual({ x: 10, y: 5 })
  })

  it('puts that corner on the anchor', () => {
    expect(pasteDelta(slice(), { x: 300, y: 300 }, 0)).toEqual({ x: 290, y: 295 })
  })

  it('steps down and right for each repeat', () => {
    expect(pasteDelta(slice(), { x: 300, y: 300 }, 2)).toEqual({
      x: 290 + 2 * PASTE_OFFSET,
      y: 295 + 2 * PASTE_OFFSET,
    })
  })

  it('lands one step from the original with no anchor', () => {
    expect(pasteDelta(slice(), null, 0)).toEqual({ x: PASTE_OFFSET, y: PASTE_OFFSET })
    expect(pasteDelta(slice(), null, 1)).toEqual({ x: 2 * PASTE_OFFSET, y: 2 * PASTE_OFFSET })
  })
})

describe('pasteStep', () => {
  it('is 0 for the first paste and counts repeats at the same spot', () => {
    expect(pasteStep({ x: 10, y: 10 })).toBe(0)
    expect(pasteStep({ x: 10, y: 10 })).toBe(1)
    expect(pasteStep({ x: 10, y: 10 })).toBe(2)
  })

  it('ignores sub-pixel noise in the anchor', () => {
    pasteStep({ x: 10.1, y: 10.2 })
    expect(pasteStep({ x: 9.9, y: 9.8 })).toBe(1)
  })

  it('starts over when the anchor moves', () => {
    pasteStep({ x: 10, y: 10 })
    pasteStep({ x: 10, y: 10 })
    expect(pasteStep({ x: 200, y: 10 })).toBe(0)
  })

  it('starts over after a new copy', () => {
    pasteStep({ x: 10, y: 10 })
    pasteStep({ x: 10, y: 10 })
    writeClipboard({ nodes: [], edges: [] })
    expect(pasteStep({ x: 10, y: 10 })).toBe(0)
  })

  it('counts repeats with no anchor too', () => {
    expect(pasteStep(null)).toBe(0)
    expect(pasteStep(null)).toBe(1)
  })
})

describe('the clipboard', () => {
  it('starts empty and holds what was written', () => {
    expect(hasClipboard()).toBe(false)
    expect(readClipboard()).toBeNull()
    const slice = { nodes: [node('a', 0, 0)], edges: [] }
    writeClipboard(slice)
    expect(hasClipboard()).toBe(true)
    expect(readClipboard()).toBe(slice)
  })
})

describe('clipboardAction', () => {
  const press = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
    key,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  })

  it.each([
    ['c', 'copy'],
    ['X', 'cut'],
    ['v', 'paste'],
    ['d', 'duplicate'],
  ])('maps Ctrl+%s to %s', (key, action) => {
    expect(clipboardAction(press(key), null)).toBe(action)
  })

  it('accepts Cmd in place of Ctrl', () => {
    expect(clipboardAction(press('c', { ctrlKey: false, metaKey: true }), null)).toBe('copy')
  })

  it('ignores a bare key, another chord, and other letters', () => {
    expect(clipboardAction(press('c', { ctrlKey: false }), null)).toBeNull()
    expect(clipboardAction(press('c', { shiftKey: true }), null)).toBeNull()
    expect(clipboardAction(press('c', { altKey: true }), null)).toBeNull()
    expect(clipboardAction(press('z'), null)).toBeNull()
  })

  it.each(['input', 'textarea', 'select'])('leaves the key to a focused %s', (tag) => {
    expect(clipboardAction(press('v'), document.createElement(tag))).toBeNull()
  })

  it('acts when a button has the focus', () => {
    expect(clipboardAction(press('v'), document.createElement('button'))).toBe('paste')
  })
})
