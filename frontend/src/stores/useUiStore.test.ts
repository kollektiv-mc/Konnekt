import { describe, it, expect, beforeEach } from 'vitest'
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
    const guard = () => true
    useUiStore.getState().setCloseGuard(guard)
    expect(useUiStore.getState().closeGuard).toBe(guard)

    useUiStore.getState().setCloseGuard(null)
    expect(useUiStore.getState().closeGuard).toBeNull()
  })

  it('stores a distinct guard set by a later mount without merging state', () => {
    const first = () => true
    const second = () => false
    useUiStore.getState().setCloseGuard(first)
    useUiStore.getState().setCloseGuard(second)
    expect(useUiStore.getState().closeGuard).toBe(second)
    expect(useUiStore.getState().closeGuard?.()).toBe(false)
  })
})
