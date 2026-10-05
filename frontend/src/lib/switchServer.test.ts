import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'
import { switchServer } from './switchServer'

vi.mock('../../wailsjs/go/main/App')

describe('switchServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.SetActiveServerID).mockResolvedValue(undefined)
    useServerConfigStore.setState({ activeId: 'alpha', error: null })
    useUiStore.setState({ closeGuard: null })
  })

  it('switches at once when nothing is guarding', () => {
    expect(switchServer('beta')).toBe(false)
    expect(App.SetActiveServerID).toHaveBeenCalledWith('beta')
  })

  it('switches at once when the guard lets it go', () => {
    const guard = vi.fn(() => false)
    useUiStore.setState({ closeGuard: guard })

    expect(switchServer('beta')).toBe(false)
    expect(guard).toHaveBeenCalledOnce()
    expect(App.SetActiveServerID).toHaveBeenCalledWith('beta')
  })

  it('leaves the switch to a guard that takes over, and reports it held', () => {
    let held: (() => void) | undefined
    useUiStore.setState({
      closeGuard: (proceed) => {
        held = proceed
        return true
      },
    })

    expect(switchServer('beta')).toBe(true)
    expect(App.SetActiveServerID).not.toHaveBeenCalled()

    // The user agreed, so the guard runs the switch it was handed.
    held?.()
    expect(App.SetActiveServerID).toHaveBeenCalledWith('beta')
  })

  it('never switches when the guard drops the continuation', () => {
    useUiStore.setState({ closeGuard: () => true })

    expect(switchServer('beta')).toBe(true)
    expect(App.SetActiveServerID).not.toHaveBeenCalled()
  })

  it('does nothing for the server that is already active, and asks no guard', () => {
    const guard = vi.fn(() => true)
    useUiStore.setState({ closeGuard: guard })

    expect(switchServer('alpha')).toBe(false)
    expect(guard).not.toHaveBeenCalled()
    expect(App.SetActiveServerID).not.toHaveBeenCalled()
  })
})
