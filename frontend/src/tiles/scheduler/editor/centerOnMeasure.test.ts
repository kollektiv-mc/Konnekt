import { describe, expect, it } from 'vitest'
import type { Node, NodeChange } from '@xyflow/react'
import { centerNodes, takeMeasured } from './centerOnMeasure'

const node = (id: string, x: number, y: number): Node => ({ id, position: { x, y }, data: {} })
const measured = (id: string, width: number, height: number): NodeChange<Node> => ({
  type: 'dimensions',
  id,
  dimensions: { width, height },
})

describe('takeMeasured', () => {
  it('takes a pending node first measurement once', () => {
    const pending = new Set(['a'])
    expect(takeMeasured([measured('a', 160, 80)], pending).get('a')).toEqual({
      width: 160,
      height: 80,
    })
    expect(pending.has('a')).toBe(false)
    expect(takeMeasured([measured('a', 160, 40)], pending).size).toBe(0)
  })

  it('skips nodes that are not pending', () => {
    expect(takeMeasured([measured('b', 40, 40)], new Set(['a'])).size).toBe(0)
  })

  it('ignores changes other than a measurement', () => {
    const pending = new Set(['a'])
    const select: NodeChange<Node> = { type: 'select', id: 'a', selected: true }
    expect(takeMeasured([select], pending).size).toBe(0)
    expect(pending.has('a')).toBe(true)
  })
})

describe('centerNodes', () => {
  it('centres a measured node on the point it was placed at', () => {
    const sizes = new Map([['a', { width: 160, height: 81 }]])
    const [a, b] = centerNodes([node('a', 100, 200), node('b', 5, 5)], sizes)
    expect(a.position).toEqual({ x: 20, y: 160 })
    expect(b.position).toEqual({ x: 5, y: 5 })
  })
})
