import { describe, it, expect, beforeEach } from 'vitest'
import { showToast, TOAST_CATEGORIES, toastsEnabled } from './toast'
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
    for (const c of TOAST_CATEGORIES) {
      expect(toastsEnabled(c.id)).toBe(true)
      showToast({ ...CRASH, category: c.id })
    }
    expect(useNotificationsStore.getState().toasts).toHaveLength(TOAST_CATEGORIES.length)
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
