import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { AnimationEvent } from 'react'
import { usePresence, useRetained } from './usePresence'

const ended = (animationName: string) => ({ animationName }) as AnimationEvent

describe('usePresence', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders nothing while closed', () => {
    const { result } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: false },
    })
    expect(result.current.mounted).toBe(false)
  })

  it('stays mounted, leaving and inert, while the exit plays', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    })
    expect(result.current.leaving).toBe(false)
    expect(result.current.panelClass).toBe('modal-panel-in')

    rerender({ open: false })
    expect(result.current.mounted).toBe(true)
    expect(result.current.leaving).toBe(true)
    expect(result.current.inert).toBe(true)
    expect(result.current.overlayClass).toContain('modal-overlay-out')
    expect(result.current.overlayClass).toContain('pointer-events-none')
    expect(result.current.panelClass).toContain('modal-panel-out')
  })

  it('unmounts when the panel exit animation ends', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })

    // The overlay's shorter fade and an animation inside the panel are not it.
    act(() => result.current.onAnimationEnd(ended('modal-overlay-out')))
    act(() => result.current.onAnimationEnd(ended('spin')))
    expect(result.current.mounted).toBe(true)

    act(() => result.current.onAnimationEnd(ended('modal-panel-out')))
    expect(result.current.mounted).toBe(false)
  })

  it('unmounts on its own when animationend never fires', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })

    act(() => void vi.advanceTimersByTime(200))
    expect(result.current.mounted).toBe(true)

    act(() => void vi.advanceTimersByTime(200))
    expect(result.current.mounted).toBe(false)
  })

  it('cancels the exit when reopened mid-exit', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => void vi.advanceTimersByTime(100))
    rerender({ open: true })

    expect(result.current.leaving).toBe(false)
    expect(result.current.inert).toBe(false)
    expect(result.current.panelClass).toBe('modal-panel-in')

    // Neither the old timeout nor a late animationend takes it down.
    act(() => void vi.advanceTimersByTime(1000))
    act(() => result.current.onAnimationEnd(ended('modal-panel-out')))
    expect(result.current.mounted).toBe(true)
  })

  it('unmounts at once with reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })

    expect(result.current.mounted).toBe(false)
    expect(result.current.leaving).toBe(false)
  })

  it('mounts again after a full exit', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => void vi.advanceTimersByTime(1000))
    expect(result.current.mounted).toBe(false)

    rerender({ open: true })
    expect(result.current.mounted).toBe(true)
    expect(result.current.leaving).toBe(false)
  })
})

describe('usePresence as a menu', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('plays the menu keyframes, not the dialog ones', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 'menu'), {
      initialProps: { open: true },
    })
    expect(result.current.panelClass).toBe('menu-in')
    rerender({ open: false })
    expect(result.current.panelClass).toContain('menu-out')
    expect(result.current.panelClass).toContain('pointer-events-none')
  })

  it('ends on its own keyframes and ignores the dialog panel exit', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 'menu'), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => result.current.onAnimationEnd(ended('modal-panel-out')))
    expect(result.current.mounted).toBe(true)
    act(() => result.current.onAnimationEnd(ended('menu-out')))
    expect(result.current.mounted).toBe(false)
  })

  it('times out at the fast duration, well before a dialog would', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 'menu'), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => void vi.advanceTimersByTime(100))
    expect(result.current.mounted).toBe(true)
    act(() => void vi.advanceTimersByTime(150))
    expect(result.current.mounted).toBe(false)
  })
})

describe('usePresence reading the duration token', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.style.removeProperty('--duration-fast')
  })

  // A production build's CSS minifier writes 150ms as .15s.
  it.each(['.15s', '150ms'])('waits the full exit when the token reads %s', (value) => {
    document.documentElement.style.setProperty('--duration-fast', value)
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 'menu'), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => void vi.advanceTimersByTime(150))
    expect(result.current.mounted).toBe(true)
    act(() => void vi.advanceTimersByTime(100))
    expect(result.current.mounted).toBe(false)
  })
})

describe('useRetained', () => {
  it('keeps the last value once it is cleared', () => {
    const { result, rerender } = renderHook(({ v }: { v: string | null }) => useRetained(v), {
      initialProps: { v: null as string | null },
    })
    expect(result.current).toBeNull()

    rerender({ v: 'kick' })
    expect(result.current).toBe('kick')

    rerender({ v: null })
    expect(result.current).toBe('kick')

    rerender({ v: 'ban' })
    expect(result.current).toBe('ban')
  })
})
