import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDirtyGuard } from './useDirtyGuard'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const guardFor = (dirty: boolean) => renderHook(() => useDirtyGuard(() => dirty))

describe('useDirtyGuard', () => {
  it('runs the action straight through when the editor is clean', () => {
    const action = vi.fn()
    const { result } = guardFor(false)

    act(() => result.current.guard(action))

    expect(action).toHaveBeenCalledOnce()
    expect(result.current.pending).toBe(false)
  })

  it('holds the action behind the dialog when the editor is dirty', () => {
    const action = vi.fn()
    const { result } = guardFor(true)

    act(() => result.current.guard(action))

    expect(action).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(true)
  })

  it('runs the held action on proceed', () => {
    const action = vi.fn()
    const { result } = guardFor(true)

    act(() => result.current.guard(action))
    act(() => result.current.proceed())

    expect(action).toHaveBeenCalledOnce()
    expect(result.current.pending).toBe(false)
  })

  // Cancel is the one branch where the editor keeps what it has. Running the
  // action here would be the data loss the guard exists to prevent.
  it('drops the held action on cancel', () => {
    const action = vi.fn()
    const { result } = guardFor(true)

    act(() => result.current.guard(action))
    act(() => result.current.cancel())

    expect(action).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('does not re-run a cancelled action on the next proceed', () => {
    const first = vi.fn()
    const { result } = guardFor(true)

    act(() => result.current.guard(first))
    act(() => result.current.cancel())
    act(() => result.current.proceed())

    expect(first).not.toHaveBeenCalled()
  })

  // The close path already knows it is dirty before it asks, so it holds
  // directly rather than re-deciding.
  it('holds unconditionally through hold, even when clean', () => {
    const action = vi.fn()
    const { result } = guardFor(false)

    act(() => result.current.hold(action))

    expect(action).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(true)
  })

  it('keeps only the most recent action when guarded twice', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result } = guardFor(true)

    act(() => result.current.guard(first))
    act(() => result.current.guard(second))
    act(() => result.current.proceed())

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  // An action that throws must not stay armed for whatever opens the dialog
  // next, or cancelling a later prompt would run it anyway.
  it('disarms an action that throws', () => {
    const boom = vi.fn(() => {
      throw new Error('save failed')
    })
    const { result } = guardFor(true)

    act(() => result.current.guard(boom))
    expect(() => act(() => result.current.proceed())).toThrow('save failed')

    act(() => result.current.proceed())
    expect(boom).toHaveBeenCalledOnce()
  })

  // Callers write the getter inline, so it is a new function every render. The
  // hook has to absorb that: the close guard closes over `guard`, and a moving
  // identity would re-register it on every node drag.
  it('keeps its callbacks stable across renders so the close guard is not re-registered', () => {
    const { result, rerender } = guardFor(true)
    const first = { guard: result.current.guard, cancel: result.current.cancel }

    rerender()

    expect(result.current.guard).toBe(first.guard)
    expect(result.current.cancel).toBe(first.cancel)
  })

  it('still reads the latest dirty state through that stable callback', () => {
    let dirty = false
    const { result, rerender } = renderHook(() => useDirtyGuard(() => dirty))
    const guard = result.current.guard

    const whenClean = vi.fn()
    act(() => guard(whenClean))
    expect(whenClean).toHaveBeenCalledOnce()

    dirty = true
    rerender()

    const whenDirty = vi.fn()
    act(() => guard(whenDirty))
    expect(whenDirty).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(true)
  })
})
