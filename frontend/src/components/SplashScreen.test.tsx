import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPLASH_MS } from '../lib/splashMark'
import { SplashScreen } from './SplashScreen'

describe('SplashScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('plays the mark, fades, then unmounts and reports it', () => {
    // Frames at 60Hz on the fake clock.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16),
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    const onDone = vi.fn()
    const { container } = render(<SplashScreen onDone={onDone} />)
    expect(container.querySelector('.splash-overlay svg')).not.toBeNull()
    // The clock holds for seven frames before the timeline starts, so the
    // fade has not begun at fadeStart, and has by the hold after it.
    act(() => {
      vi.advanceTimersByTime(SPLASH_MS.fadeStart)
    })
    expect(container.querySelector('.splash-fading')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(7 * 16)
    })
    expect(container.querySelector('.splash-fading')).not.toBeNull()
    expect(onDone).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(SPLASH_MS.fade)
    })
    expect(container.querySelector('.splash-overlay')).toBeNull()
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('shows the finished mark at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    const { container } = render(<SplashScreen />)
    const overlay = container.querySelector('.splash-overlay')
    expect(overlay?.classList.contains('splash-still')).toBe(true)
    // Three faces at rest: two sides and the top.
    expect(container.querySelectorAll('svg g polygon')).toHaveLength(5)
    act(() => {
      vi.advanceTimersByTime(SPLASH_MS.still)
    })
    expect(container.querySelector('.splash-overlay')).toBeNull()
  })
})
