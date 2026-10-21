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

  it('draws the mark and unmounts when the fade ends', () => {
    const { container } = render(<SplashScreen />)
    expect(container.querySelector('.splash-overlay svg')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(SPLASH_MS.total - 1)
    })
    expect(container.querySelector('.splash-overlay')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.querySelector('.splash-overlay')).toBeNull()
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
