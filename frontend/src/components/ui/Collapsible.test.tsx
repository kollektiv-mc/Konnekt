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

// The collapse path defers through two nested animation frames, so the frames
// have to be fake for a test to land in between them — which is exactly where
// the reopen race below lives. Vitest does not fake rAF by default.
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

  it('re-clamps to the measured height and animates back to 0 when closed', () => {
    const { container, rerender } = render(
      <Collapsible open={true}>
        <div>content</div>
      </Collapsible>,
    )
    mockScrollHeight(container, 180)

    act(() => {
      rerender(
        <Collapsible open={false}>
          <div>content</div>
        </Collapsible>,
      )
    })
    // Clamped to the measured height first (forces a reflow frame at a real
    // height instead of jumping straight from `none`, so the collapse animates).
    expect(outerOf(container).style.maxHeight).toBe('180px')

    act(() => {
      vi.runAllTimers()
    })
    expect(outerOf(container).style.maxHeight).toBe('0px')
  })

  // The reported glitch, reproduced exactly: reopen in the one-frame gap
  // between the collapse's two animation frames. The outer frame has already
  // fired, so cancelling its handle does nothing, and the inner one it queued
  // used to land anyway and write `0px` over a panel that was opening. The
  // fallback timer then snapped it back up with no motion at all — which is the
  // "sometimes it just cuts away" this pins down.
  it('a reopen between the collapse frames leaves the panel open', () => {
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

  // The other half of that race: the rescued panel must still close normally,
  // rather than the cancelled collapse having eaten the next one.
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
