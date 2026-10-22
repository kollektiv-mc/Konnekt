import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { emitDesktopNotification, emitRequestNotification } from './notify'
import { emitNotification } from './appNotify'
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
    settings: { ...useSettingsStore.getState().settings, toastsOff: {}, desktopOn: {} },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const desktopOn = (on: Record<string, boolean>) =>
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, desktopOn: on },
  })

describe('emitNotification', () => {
  it('logs to the tile and fires the desktop when its category is on', () => {
    desktopOn({ crash: true })
    emitNotification('crash', 'boom')
    expect(logged()).toEqual(['boom'])
    expect(created).toEqual([{ title: 'Server Crashed', body: 'boom' }])
  })

  it('still logs to the tile with its desktop category off', () => {
    emitNotification('crash', 'boom')
    emitNotification('join', 'Steve joined the game')
    expect(logged()).toEqual(['boom', 'Steve joined the game'])
    expect(created).toEqual([])
  })

  it.each([
    ['error', 'errors'],
    ['warn', 'warnings'],
    ['info', 'warnings'],
    ['join', 'join'],
  ] as const)('files a %s under %s when the caller names none', (kind, category) => {
    desktopOn({ [category]: true })
    emitNotification(kind, 'x')
    expect(created).toHaveLength(1)
  })

  it('files under the category the caller names, over its kind', () => {
    desktopOn({ crash: true })
    emitNotification('crash', 'Backup failed', 'errors')
    expect(created).toEqual([])
    desktopOn({ errors: true })
    emitNotification('crash', 'Backup failed', 'errors')
    expect(created).toHaveLength(1)
  })
})

describe('emitRequestNotification', () => {
  it('logs and fires the desktop with every category off', () => {
    emitRequestNotification('warn', 'A device is waiting')
    expect(logged()).toEqual(['A device is waiting'])
    expect(created).toHaveLength(1)
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
