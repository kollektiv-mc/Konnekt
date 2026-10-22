import { describe, it, expect, beforeEach } from 'vitest'
import { failedRunToast, showToast, TOAST_CATEGORIES, toastsEnabled } from './toast'
import { useNotificationsStore } from '../stores/useNotificationsStore'
import type { ToastInput } from '../stores/useNotificationsStore'
import { useSettingsStore } from '../stores/useSettingsStore'

const CRASH: ToastInput = {
  category: 'crash',
  tone: 'error',
  title: 'Server crashed',
  text: 'exit code 1',
}

const turnOff = (toastsOff: Record<string, boolean>) =>
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, toastsOff } })

describe('showToast', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ toasts: [], dismissedToasts: {} })
    turnOff({})
  })

  it('shows every category while nothing is turned off', () => {
    // One at a time: there are more categories than the stack holds.
    for (const c of TOAST_CATEGORIES) {
      expect(toastsEnabled(c.id)).toBe(true)
      showToast({ ...CRASH, category: c.id, key: c.id })
      expect(useNotificationsStore.getState().toasts.at(-1)?.category).toBe(c.id)
    }
  })

  it('holds back a category that is turned off, and only that one', () => {
    turnOff({ crash: true })
    showToast(CRASH)
    showToast({ ...CRASH, category: 'errors' })
    expect(useNotificationsStore.getState().toasts.map((t) => t.category)).toEqual(['errors'])
  })

  // The toolbar's indicator is the user asking to read it, which the toggle
  // was never meant to refuse.
  it('shows a turned-off category when forced', () => {
    turnOff({ crash: true })
    showToast(CRASH, true)
    expect(useNotificationsStore.getState().toasts).toHaveLength(1)
  })
})

describe('failedRunToast', () => {
  // A re-run that fails again is news, even with the same reason.
  it('raises a failed run, keyed by its graph, every time', () => {
    expect(
      failedRunToast({ graphId: 'g1', graphName: 'Nightly', status: 'failed', error: 'no RCON' }),
    ).toEqual({
      key: 'scheduler:run:g1',
      category: 'errors',
      tone: 'error',
      title: 'Run failed: Nightly',
      text: 'no RCON',
    })
  })

  it('stays quiet for a run that worked', () => {
    expect(failedRunToast({ graphId: 'g1', status: 'success' })).toBeNull()
    expect(failedRunToast(undefined)).toBeNull()
  })

  it('names an unnamed graph and an empty reason', () => {
    const t = failedRunToast({ graphId: 'g1', status: 'failed' })
    expect([t?.title, t?.text]).toEqual(['Run failed: Untitled', 'unknown error'])
  })
})
