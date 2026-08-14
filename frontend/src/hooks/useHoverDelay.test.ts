import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHoverDelay } from './useHoverDelay'

describe('useHoverDelay', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reveals only after the full delay', () => {
    const { result } = renderHook(() => useHoverDelay(1000))

    act(() => result.current.onMouseEnter())
    expect(result.current.hovered).toBe(false)

    act(() => void vi.advanceTimersByTime(999))
    expect(result.current.hovered).toBe(false)

    act(() => void vi.advanceTimersByTime(1))
    expect(result.current.hovered).toBe(true)
  })

  it('does not reveal when the pointer leaves before the delay', () => {
    const { result } = renderHook(() => useHoverDelay(1000))

    act(() => result.current.onMouseEnter())
    act(() => void vi.advanceTimersByTime(999))
    act(() => result.current.onMouseLeave())
    act(() => void vi.advanceTimersByTime(5000))

    expect(result.current.hovered).toBe(false)
  })

  it('hides again on leave', () => {
    const { result } = renderHook(() => useHoverDelay(1000))

    act(() => result.current.onMouseEnter())
    act(() => void vi.advanceTimersByTime(1000))
    expect(result.current.hovered).toBe(true)

    act(() => result.current.onMouseLeave())
    expect(result.current.hovered).toBe(false)
  })

  // The fetch is kicked off on enter, not on reveal, so the card is already
  // populated by the time it appears.
  it('calls onEnter immediately, once per enter', () => {
    const onEnter = vi.fn()
    const { result } = renderHook(() => useHoverDelay(1000, onEnter))

    act(() => result.current.onMouseEnter())
    expect(onEnter).toHaveBeenCalledTimes(1)

    act(() => void vi.advanceTimersByTime(1000))
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('does not fire after unmount', () => {
    const { result, unmount } = renderHook(() => useHoverDelay(1000))

    act(() => result.current.onMouseEnter())
    unmount()
    // Would throw a React act/update warning if the timer still fired.
    act(() => void vi.advanceTimersByTime(5000))
    expect(result.current.hovered).toBe(false)
  })
})
