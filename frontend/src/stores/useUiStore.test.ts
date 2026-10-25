import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUiStore } from './useUiStore'

describe('useUiStore maximizedTileId', () => {
  beforeEach(() => {
    useUiStore.setState({ maximizedTileId: null })
  })

  it('defaults to null', () => {
    expect(useUiStore.getState().maximizedTileId).toBeNull()
  })

  it('sets and clears the maximized tile id', () => {
    useUiStore.getState().setMaximizedTileId('console')
    expect(useUiStore.getState().maximizedTileId).toBe('console')

    useUiStore.getState().setMaximizedTileId(null)
    expect(useUiStore.getState().maximizedTileId).toBeNull()
  })
})

describe('useUiStore closeGuard', () => {
  beforeEach(() => {
    useUiStore.setState({ closeGuard: null })
  })

  it('defaults to null', () => {
    expect(useUiStore.getState().closeGuard).toBeNull()
  })

  it('sets and clears the guard function', () => {
    const guard = vi.fn(() => true)
    useUiStore.getState().setCloseGuard(guard)
    expect(useUiStore.getState().closeGuard?.(() => {})).toBe(true)
    expect(guard).toHaveBeenCalledOnce()

    useUiStore.getState().setCloseGuard(null)
    expect(useUiStore.getState().closeGuard).toBeNull()
  })

  it('stores a distinct guard set by a later mount without merging state', () => {
    const first = vi.fn(() => true)
    const second = () => false
    useUiStore.getState().setCloseGuard(first)
    useUiStore.getState().setCloseGuard(second)
    expect(useUiStore.getState().closeGuard?.(() => {})).toBe(false)
    expect(first).not.toHaveBeenCalled()
  })

  // A component subscribed to the whole store keeps the snapshot it last
  // rendered. Its guard must not still reach the tile that set it (#767).
  it('lets go of a cleared guard held in an older snapshot', () => {
    const guard = vi.fn(() => true)
    useUiStore.getState().setCloseGuard(guard)
    const stale = useUiStore.getState().closeGuard

    useUiStore.getState().setCloseGuard(null)
    expect(stale?.(() => {})).toBe(false)
    expect(guard).not.toHaveBeenCalled()
  })

  it('hands the guard the action it is vetoing, to run or to drop', () => {
    const proceed = vi.fn()
    // A guard that takes over, and runs the continuation once the user agrees.
    useUiStore.getState().setCloseGuard((next) => {
      next()
      return true
    })

    expect(useUiStore.getState().closeGuard?.(proceed)).toBe(true)
    expect(proceed).toHaveBeenCalledOnce()
  })
})
