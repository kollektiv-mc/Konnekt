import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import { useCanvasFirstWheel } from './useCanvasFirstWheel'
import { installSpringScroll } from '../lib/springScroll'

// The canvas hook and the app-wide spring listener together, as main.tsx and
// Dashboard.tsx install them. Scrollers clamp like real ones, since the
// spring relies on it.
function geometry(el: HTMLElement, scrollHeight: number, clientHeight: number, top = 0) {
  el.style.overflowY = 'auto'
  let t = top
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => t,
    set: (v: number) => {
      t = Math.min(scrollHeight - clientHeight, Math.max(0, v))
    },
  })
}

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  useCanvasFirstWheel(ref)
  return (
    <div data-testid="canvas" ref={ref}>
      <div data-testid="pane" />
    </div>
  )
}

function notch(target: Element, deltaY: number, timeStamp: number): WheelEvent {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY })
  Object.defineProperty(e, 'wheelDeltaY', { value: -Math.sign(deltaY) * 120 })
  Object.defineProperty(e, 'timeStamp', { value: timeStamp })
  target.dispatchEvent(e)
  return e
}

describe('canvas-first wheel with the spring installed', () => {
  let now = 0
  let frames: FrameRequestCallback[] = []
  let uninstall: () => void = () => {}
  let enabled = true

  const advance = (ms: number) => {
    now += ms
    const due = frames
    frames = []
    for (const cb of due) cb(now)
  }
  const settle = () => {
    for (let i = 0; i < 120; i++) advance(16)
  }

  beforeEach(() => {
    now = 0
    frames = []
    enabled = true
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.splice(id - 1, 1)
    })
    uninstall = installSpringScroll({ enabled: () => enabled })
  })

  afterEach(() => {
    uninstall()
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function setup(canvasTop: number, paneTop = 0) {
    const r = render(<Harness />)
    const canvas = r.getByTestId('canvas')
    const pane = r.getByTestId('pane')
    geometry(canvas, 2000, 500, canvasTop)
    geometry(pane, 600, 200, paneTop)
    return { canvas, pane }
  }

  it('glides the canvas on a notch over a pane rather than jumping', () => {
    const { canvas, pane } = setup(0)
    expect(notch(pane, 100, 0).defaultPrevented).toBe(true)
    expect(canvas.scrollTop).toBe(0)
    advance(16)
    expect(canvas.scrollTop).toBeGreaterThan(0)
    expect(canvas.scrollTop).toBeLessThan(100)
    settle()
    expect(canvas.scrollTop).toBe(100)
    expect(pane.scrollTop).toBe(0)
  })

  it('accumulates a fast run of notches on the canvas into one motion', () => {
    const { canvas } = setup(0)
    const pane = canvas.firstElementChild as HTMLElement
    notch(pane, 100, 0)
    advance(16)
    notch(pane, 100, 16)
    advance(16)
    notch(pane, 100, 32)
    settle()
    expect(canvas.scrollTop).toBe(300)
  })

  it('hands over to the pane once the canvas is bound for its end, losing no notch', () => {
    // 50px of canvas left: the first notch takes it, the second belongs to
    // the pane even though the canvas is still gliding.
    const { canvas, pane } = setup(1450)
    notch(pane, 100, 0)
    notch(pane, 100, 10)
    settle()
    expect(canvas.scrollTop).toBe(1500)
    expect(pane.scrollTop).toBe(100)
  })

  it('jumps the canvas when smooth scrolling is off', () => {
    const { canvas, pane } = setup(0)
    enabled = false
    expect(notch(pane, 100, 0).defaultPrevented).toBe(true)
    expect(canvas.scrollTop).toBe(100)
  })

  it('jumps the canvas for a precision touchpad', () => {
    const { canvas, pane } = setup(0)
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 7.5 })
    pane.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(canvas.scrollTop).toBe(7.5)
  })

  it('never chains a pane-owned run into the canvas', () => {
    // Canvas at its end, so the pane owns the gesture; two notches carry the
    // pane to its end and a third must not move anything.
    const { canvas, pane } = setup(1500, 300)
    notch(pane, 100, 0)
    notch(pane, 100, 10)
    notch(pane, 100, 20)
    settle()
    expect(pane.scrollTop).toBe(400)
    expect(canvas.scrollTop).toBe(1500)
  })
})
