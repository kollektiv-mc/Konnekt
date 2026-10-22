import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { emitDesktopNotification, emitNotification } from './notify'
import { deliverScheduleNotify } from './scheduleNotify'
import { useNotificationsStore } from '../stores/useNotificationsStore'
import { useSettingsStore } from '../stores/useSettingsStore'

const created: { title: string; body?: string }[] = []

class FakeNotification {
  static permission = 'granted'
  constructor(title: string, opts?: { body?: string }) {
    created.push({ title, body: opts?.body })
  }
}

const logged = () => useNotificationsStore.getState().items.map((n) => n.text)
const bubbles = () => useNotificationsStore.getState().toasts.map((t) => t.text)

beforeEach(() => {
  created.length = 0
  vi.stubGlobal('Notification', FakeNotification)
  useNotificationsStore.setState({ items: [], toasts: [], dismissedToasts: {} })
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, toastsOff: {} },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('emitNotification', () => {
  it('still logs to the tile and fires the desktop notification', () => {
    emitNotification('crash', 'boom')
    expect(logged()).toEqual(['boom'])
    expect(created).toEqual([{ title: 'Server Crashed', body: 'boom' }])
  })
})

describe('emitDesktopNotification', () => {
  it('fires the notification without touching the tile', () => {
    emitDesktopNotification('info', 'hi')
    expect(created).toEqual([{ title: 'Konnekt', body: 'hi' }])
    expect(logged()).toEqual([])
  })
})

describe('deliverScheduleNotify', () => {
  it('sends in-app only to the bubble and the tile', () => {
    deliverScheduleNotify({ kind: 'warn', message: 'hi', deliver: 'inApp' })
    expect(logged()).toEqual(['hi'])
    expect(bubbles()).toEqual(['hi'])
    expect(created).toEqual([])
  })

  it('sends desktop only to the operating system', () => {
    deliverScheduleNotify({ kind: 'warn', message: 'hi', deliver: 'desktop' })
    expect(created).toEqual([{ title: 'Konnekt', body: 'hi' }])
    expect(logged()).toEqual([])
    expect(bubbles()).toEqual([])
  })

  it('sends both to all three', () => {
    deliverScheduleNotify({ kind: 'info', message: 'hi', deliver: 'both' })
    expect(logged()).toEqual(['hi'])
    expect(bubbles()).toEqual(['hi'])
    expect(created).toHaveLength(1)
  })

  it('treats a missing or unknown choice as both', () => {
    deliverScheduleNotify({ kind: 'info', message: 'old' })
    deliverScheduleNotify({ kind: 'info', message: 'odd', deliver: 'carrier-pigeon' })
    expect(logged()).toEqual(['old', 'odd'])
    expect(created).toHaveLength(2)
  })

  it('files an error as an error and an unknown kind as info', () => {
    deliverScheduleNotify({ kind: 'error', message: 'bad', deliver: 'inApp' })
    deliverScheduleNotify({ kind: 'nonsense', message: 'meh', deliver: 'inApp' })
    const toasts = useNotificationsStore.getState().toasts
    expect(toasts.map((t) => [t.category, t.tone])).toEqual([
      ['errors', 'error'],
      ['warnings', 'info'],
    ])
  })
})
