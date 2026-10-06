import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useCanvasFirstWheel } from './useCanvasFirstWheel'

// jsdom does no layout, so scroll metrics are stubbed on the elements.
function stub(el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop = 0) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
  el.scrollTop = scrollTop
}

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  useCanvasFirstWheel(ref)
  return (
    <div>
      <div data-testid="canvas" ref={ref}>
        <div data-testid="outer">
          <div data-testid="inner" />
        </div>
      </div>
      <div data-testid="outside" />
    </div>
  )
}

afterEach(cleanup)

function setup(canvasTop: number) {
  const r = render(<Harness />)
  const canvas = r.getByTestId('canvas')
  const outer = r.getByTestId('outer')
  const inner = r.getByTestId('inner')
  for (const el of [canvas, outer, inner]) el.style.overflowY = 'auto'
  stub(canvas, 2000, 500, canvasTop)
  stub(outer, 1000, 300)
  stub(inner, 600, 200)
  return { ...r, canvas, outer, inner }
}

describe('useCanvasFirstWheel', () => {
  it('scrolls the canvas and cancels the event while the canvas can move', () => {
    const { canvas, inner } = setup(0)
    const notCancelled = fireEvent.wheel(inner, { deltaY: 50 })
    expect(notCancelled).toBe(false)
    expect(canvas.scrollTop).toBe(50)
    expect(inner.scrollTop).toBe(0)
  })

  it('leaves the event to the pane once the canvas is at its limit', () => {
    const { canvas, inner } = setup(1500)
    const notCancelled = fireEvent.wheel(inner, { deltaY: 50 })
    expect(notCancelled).toBe(true)
    expect(canvas.scrollTop).toBe(1500)
  })

  it('hands over mid-gesture at the limit', () => {
    const { canvas, inner } = setup(1490)
    expect(fireEvent.wheel(inner, { deltaY: 15 })).toBe(false)
    expect(fireEvent.wheel(inner, { deltaY: 15 })).toBe(true)
    // jsdom does not clamp, so the first event overshoots; the second never moves it.
    expect(canvas.scrollTop).toBe(1505)
  })

  it('lets the browser have shift-wheel, ctrl-wheel and horizontal wheels', () => {
    const { inner, canvas } = setup(0)
    expect(fireEvent.wheel(inner, { deltaY: 50, shiftKey: true })).toBe(true)
    expect(fireEvent.wheel(inner, { deltaY: 50, ctrlKey: true })).toBe(true)
    expect(fireEvent.wheel(inner, { deltaX: 80, deltaY: 5 })).toBe(true)
    expect(canvas.scrollTop).toBe(0)
  })

  it('does not touch an event already claimed inside', () => {
    const { inner, canvas } = setup(0)
    inner.addEventListener('wheel', (e) => e.preventDefault())
    fireEvent.wheel(inner, { deltaY: 50 })
    expect(canvas.scrollTop).toBe(0)
  })

  it('never sees wheels outside the canvas', () => {
    const { getByTestId, canvas } = setup(0)
    fireEvent.wheel(getByTestId('outside'), { deltaY: 50 })
    expect(canvas.scrollTop).toBe(0)
  })

  it('holds a pane-owned fling whose pane has reached its end', () => {
    const { inner } = setup(1500)
    stub(inner, 600, 200, 400)
    stub(getOuter(inner), 300, 300)
    expect(fireEvent.wheel(inner, { deltaY: 30 })).toBe(true)
    // Reaches its end; the next event of the same fling must not chain out.
    expect(fireEvent.wheel(inner, { deltaY: 30 })).toBe(false)
  })
})

function getOuter(inner: HTMLElement): HTMLElement {
  return inner.parentElement as HTMLElement
}
