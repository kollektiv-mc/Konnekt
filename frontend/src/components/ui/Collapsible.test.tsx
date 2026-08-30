import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { Collapsible } from './Collapsible'

// DURATION_MS.panel (280) + the component's 120ms grace. Spelled out rather
// than imported so a change to either number has to be looked at here too:
// the whole point of the grace is that a real `transitionend` beats this, and
// a fallback that quietly crept back to the transition's own length would be
// the bug this file exists to pin down.
const FALLBACK_MS = 400

function outerOf(container: HTMLElement) {
  return container.querySelector('.ui-collapsible') as HTMLElement
}

function innerOf(container: HTMLElement) {
  return outerOf(container).firstElementChild as HTMLElement
}

function mockScrollHeight(container: HTMLElement, height: number) {
  Object.defineProperty(innerOf(container), 'scrollHeight', { configurable: true, value: height })
}

// Vitest does not fake rAF by default, and these still fake it: the component
// no longer schedules frames itself, but advancing them is how the tests below
// step a toggle sequence without waiting on real time.
const TO_FAKE = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Date',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const

describe('Collapsible', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts fully collapsed when closed', () => {
    const { container } = render(
      <Collapsible open={false}>
        <div>content</div>
      </Collapsible>,
    )
    expect(outerOf(container).style.maxHeight).toBe('0px')
  })

  it('mounting already-open releases to uncapped after measuring', () => {
    const { container } = render(
      <Collapsible open={true}>
        <div>content</div>
      </Collapsible>,
    )
    // The mount effect re-measures immediately (clamped to the measured
    // height, 0 by default in jsdom) before releasing to `none`.
    expect(outerOf(container).style.maxHeight).toBe('0px')
    act(() => {
      vi.advanceTimersByTime(FALLBACK_MS)
    })
    expect(outerOf(container).style.maxHeight).toBe('none')
  })

  it('animates to the measured height then releases to none so growing children are not re-clipped', () => {
    const { container, rerender } = render(
      <Collapsible open={false}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 240)

    act(() => {
      rerender(
        <Collapsible open={true}>
          <div>content</div>
        </Collapsible>,
      )
    })
    // Immediately after opening: clamped to the measured height (animatable),
    // not jumped straight to `none` (which wouldn't animate).
    expect(outerOf(container).style.maxHeight).toBe('240px')

    act(() => {
      vi.advanceTimersByTime(FALLBACK_MS)
    })
    expect(outerOf(container).style.maxHeight).toBe('none')
  })

  // The cap used to come off on a timer that started one commit before the CSS
  // transition did, so it always fired a frame or two early and jumped the last
  // pixels of the open. The transition itself says when it is finished.
  it('releases the cap on the open transition ending, without waiting for the fallback', () => {
    const { container, rerender } = render(
      <Collapsible open={false}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 120)
    act(() => {
      rerender(
        <Collapsible open={true}>
          <div>content</div>
        </Collapsible>,
      )
    })

    act(() => {
      fireEvent.transitionEnd(outerOf(container), { propertyName: 'max-height' })
    })
    expect(outerOf(container).style.maxHeight).toBe('none')
  })

  // transitionend bubbles, and the panel's whole job is to hold other people's
  // content — much of which animates.
  it('ignores a transition ending on a child, or on another property', () => {
    const { container, rerender } = render(
      <Collapsible open={false}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 120)
    act(() => {
      rerender(
        <Collapsible open={true}>
          <div>content</div>
        </Collapsible>,
      )
    })

    act(() => {
      fireEvent.transitionEnd(innerOf(container), { propertyName: 'max-height' })
      fireEvent.transitionEnd(outerOf(container), { propertyName: 'opacity' })
    })
    expect(outerOf(container).style.maxHeight).toBe('120px')
  })

  // Watches the flush the collapse forces, and reports the inline max-height
  // standing at that moment — which is the whole mechanism: the browser has to
  // have computed a real starting height before the target lands.
  function watchCollapse(container: HTMLElement, renderedHeight: number) {
    const outer = outerOf(container)
    const seen: { pinned: string | null; flushes: number } = { pinned: null, flushes: 0 }
    outer.getBoundingClientRect = () => ({ height: renderedHeight }) as DOMRect
    Object.defineProperty(outer, 'offsetHeight', {
      configurable: true,
      get: () => {
        seen.flushes++
        seen.pinned = outer.style.maxHeight
        return renderedHeight
      },
    })
    return seen
  }

  // An open panel sits at `max-height: none`, which does not interpolate, so
  // going straight to `0px` is a cut rather than a collapse. This used to wait
  // two animation frames for a measured height to be painted, which holds while
  // frames are cheap: under a 6x CPU throttle it failed on 74 of 220 closes,
  // always closing, never opening. Pinning the height and reading a layout
  // property makes the browser compute it there and then instead.
  it('pins the height it is at and forces a flush before collapsing', () => {
    const { container, rerender } = render(
      <Collapsible open={true}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 180)
    const seen = watchCollapse(container, 180)

    act(() => {
      rerender(
        <Collapsible open={false}>
          <div>content</div>
        </Collapsible>,
      )
    })

    expect(seen.flushes).toBeGreaterThan(0)
    expect(seen.pinned).toBe('180px')
    expect(outerOf(container).style.maxHeight).toBe('0px')
  })

  // Caught mid-open, the start is where it has got to, not where it was going.
  // Pinning the full height would snap the panel open before collapsing it.
  it('collapses from the height it has reached, not the one it was heading for', () => {
    const { container, rerender } = render(
      <Collapsible open={true}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 180)
    const seen = watchCollapse(container, 60)

    act(() => {
      rerender(
        <Collapsible open={false}>
          <div>content</div>
        </Collapsible>,
      )
    })

    expect(seen.pinned).toBe('60px')
    expect(outerOf(container).style.maxHeight).toBe('0px')
  })

  // The collapse used to defer through two animation frames, and a reopen
  // landing between them wrote `0px` over a panel that was opening. There are
  // no frames left to land between — it is all synchronous now — but the
  // behaviour is worth holding: a toggle immediately after another one ends
  // where the last toggle asked for.
  it('a reopen right after a close leaves the panel open', () => {
    const { container, rerender } = render(
      <Collapsible open={true}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 200)
    act(() => {
      vi.advanceTimersByTime(FALLBACK_MS)
    })

    act(() => {
      rerender(
        <Collapsible open={false}>
          <div>content</div>
        </Collapsible>,
      )
    })
    // First frame only: the second one is now queued.
    act(() => {
      vi.advanceTimersToNextFrame()
    })

    act(() => {
      rerender(
        <Collapsible open={true}>
          <div>content</div>
        </Collapsible>,
      )
    })
    act(() => {
      vi.advanceTimersToNextFrame()
    })

    expect(outerOf(container).style.maxHeight).toBe('200px')
    act(() => {
      vi.advanceTimersByTime(FALLBACK_MS)
    })
    expect(outerOf(container).style.maxHeight).toBe('none')
  })

  // The other half: the rescued panel must still close normally, rather than
  // the abandoned collapse having eaten the next one.
  it('closing again after such a reopen still collapses', () => {
    const { container, rerender } = render(
      <Collapsible open={true}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 200)

    for (const open of [false, true, false]) {
      act(() => {
        rerender(
          <Collapsible open={open}>
            <div>content</div>
          </Collapsible>,
        )
      })
      act(() => {
        vi.advanceTimersToNextFrame()
      })
    }

    act(() => {
      vi.runAllTimers()
    })
    expect(outerOf(container).style.maxHeight).toBe('0px')
  })

  it('merges a caller-provided className alongside the base classes', () => {
    const { container } = render(
      <Collapsible open={false} className="pl-2">
        <div>content</div>
      </Collapsible>,
    )
    expect(outerOf(container).className).toContain('pl-2')
    expect(outerOf(container).className).toContain('overflow-hidden')
  })
})
