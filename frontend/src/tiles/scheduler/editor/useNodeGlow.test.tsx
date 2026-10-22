import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { GLOW_REACH_PX, toNodeLocal, useNodeGlow, withinGlowReach } from './useNodeGlow'

afterEach(cleanup)

describe('toNodeLocal', () => {
  it('is the offset from the rect at zoom 1', () => {
    const rect = { left: 100, top: 50, width: 180 }
    expect(toNodeLocal(130, 80, rect, 180)).toEqual({ x: 30, y: 30 })
  })

  it('divides the offset by the zoom, read off the node width', () => {
    // A 180px node at zoom 2 measures 360 on screen; 60px in is 30px of the node.
    const rect = { left: 100, top: 50, width: 360 }
    expect(toNodeLocal(160, 110, rect, 180)).toEqual({ x: 30, y: 30 })
  })

  it('scales down when zoomed out', () => {
    const rect = { left: 0, top: 0, width: 90 }
    expect(toNodeLocal(45, 20, rect, 180)).toEqual({ x: 90, y: 40 })
  })

  it('goes negative left of and above the node', () => {
    const rect = { left: 100, top: 100, width: 180 }
    expect(toNodeLocal(80, 90, rect, 180)).toEqual({ x: -20, y: -10 })
  })

  it('falls back to zoom 1 where the node has no layout', () => {
    expect(toNodeLocal(15, 25, { left: 5, top: 5, width: 0 }, 0)).toEqual({ x: 10, y: 20 })
  })
})

describe('withinGlowReach', () => {
  it('holds for a point inside the node', () => {
    expect(withinGlowReach({ x: 10, y: 10 }, 180, 100)).toBe(true)
  })

  it('holds just outside an edge, within the reach', () => {
    expect(withinGlowReach({ x: -(GLOW_REACH_PX - 1), y: 50 }, 180, 100)).toBe(true)
    expect(withinGlowReach({ x: 50, y: 100 + GLOW_REACH_PX - 1 }, 180, 100)).toBe(true)
  })

  it('fails past the reach on any side', () => {
    expect(withinGlowReach({ x: -GLOW_REACH_PX, y: 50 }, 180, 100)).toBe(false)
    expect(withinGlowReach({ x: 180 + GLOW_REACH_PX, y: 50 }, 180, 100)).toBe(false)
    expect(withinGlowReach({ x: 50, y: -GLOW_REACH_PX }, 180, 100)).toBe(false)
    expect(withinGlowReach({ x: 50, y: 100 + GLOW_REACH_PX }, 180, 100)).toBe(false)
  })
})

// A node 180 x 100 at the given screen position, at zoom 1.
function Canvas() {
  const ref = useRef<HTMLDivElement>(null)
  useNodeGlow(ref)
  return (
    <div ref={ref} data-testid="canvas">
      <div className="react-flow__viewport">
        <div className="react-flow__node" data-testid="near" />
        <div className="react-flow__node" data-testid="far" />
      </div>
    </div>
  )
}

function place(el: HTMLElement, left: number, top: number) {
  el.getBoundingClientRect = () => ({ left, top, width: 180, height: 100 }) as DOMRect
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 180 })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 100 })
}

describe('useNodeGlow', () => {
  let frames: FrameRequestCallback[]
  const flush = () => frames.splice(0).forEach((cb) => cb(0))

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => vi.unstubAllGlobals())

  function setup() {
    const view = render(<Canvas />)
    const near = view.getByTestId('near')
    const far = view.getByTestId('far')
    place(near, 100, 100)
    place(far, 2000, 2000)
    return { canvas: view.getByTestId('canvas'), near, far }
  }

  function move(canvas: HTMLElement, x: number, y: number, pointerType = 'mouse') {
    // jsdom has no PointerEvent constructor, so the type is set on a plain event.
    const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true })
    Object.defineProperty(e, 'pointerType', { value: pointerType })
    canvas.dispatchEvent(e)
  }

  it('writes node-local coordinates on a node near the cursor, once per frame', () => {
    const { canvas, near } = setup()
    move(canvas, 130, 120)
    move(canvas, 140, 130)
    expect(frames).toHaveLength(1)
    flush()
    expect(near.style.getPropertyValue('--mx')).toBe('40px')
    expect(near.style.getPropertyValue('--my')).toBe('30px')
  })

  it('leaves a node far from the cursor alone', () => {
    const { canvas, far } = setup()
    move(canvas, 130, 120)
    flush()
    expect(far.style.getPropertyValue('--mx')).toBe('')
  })

  it('clears a node once the cursor moves out of its reach', () => {
    const { canvas, near } = setup()
    move(canvas, 130, 120)
    flush()
    move(canvas, 1000, 1000)
    flush()
    expect(near.style.getPropertyValue('--mx')).toBe('')
  })

  it('ignores touch', () => {
    const { canvas, near } = setup()
    move(canvas, 130, 120, 'touch')
    expect(frames).toHaveLength(0)
    expect(near.style.getPropertyValue('--mx')).toBe('')
  })

  it('marks the canvas idle on leave and active again on the next move', () => {
    const { canvas } = setup()
    move(canvas, 130, 120)
    fireEvent.pointerLeave(canvas)
    expect(canvas.hasAttribute('data-glow-idle')).toBe(true)
    move(canvas, 131, 121)
    expect(canvas.hasAttribute('data-glow-idle')).toBe(false)
  })

  it('repaints when the viewport moves under a still cursor', async () => {
    const { canvas, near } = setup()
    move(canvas, 130, 120)
    flush()
    place(near, 120, 100)
    canvas.querySelector<HTMLElement>('.react-flow__viewport')?.setAttribute('style', 'x')
    // MutationObserver callbacks run as a microtask.
    await Promise.resolve()
    flush()
    expect(near.style.getPropertyValue('--mx')).toBe('10px')
  })
})
