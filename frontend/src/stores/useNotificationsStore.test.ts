import { describe, it, expect, beforeEach } from 'vitest'
import { MAX_TOASTS, useNotificationsStore } from './useNotificationsStore'
import type { ToastInput } from './useNotificationsStore'

describe('useNotificationsStore', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ items: [] })
  })

  it('push appends an item with the given kind and text', () => {
    useNotificationsStore.getState().push('info', 'hello')
    const items = useNotificationsStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'info', text: 'hello' })
  })

  it('caps the buffer at 200 items, keeping the newest', () => {
    for (let i = 0; i < 205; i++) {
      useNotificationsStore.getState().push('info', `msg ${i}`)
    }
    const items = useNotificationsStore.getState().items
    expect(items.length).toBe(200)
    expect(items[0].text).toBe('msg 5')
    expect(items[items.length - 1].text).toBe('msg 204')
  })

  it('clear empties the buffer', () => {
    useNotificationsStore.getState().push('warn', 'careful')
    useNotificationsStore.getState().clear()
    expect(useNotificationsStore.getState().items).toEqual([])
  })
})

describe('useNotificationsStore toasts', () => {
  const RUN: ToastInput = {
    key: 'scheduler:run',
    category: 'errors',
    tone: 'error',
    title: 'Run failed',
    text: 'status 403 RequestTimeTooSkewed',
  }
  const toasts = () => useNotificationsStore.getState().toasts
  const { showToast, dismissToast, dismissAllToasts, withdrawToast } =
    useNotificationsStore.getState()

  beforeEach(() => {
    useNotificationsStore.setState({ toasts: [], dismissedToasts: {} })
  })

  it('keeps the whole text', () => {
    const text = 'x'.repeat(2000)
    showToast({ ...RUN, text })
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({ text, count: 1, category: 'errors' })
  })

  // One bubble per thing, so a graph's advice that changes while it is edited
  // does not pile up a bubble per change.
  it('replaces the bubble with the same key, and counts an exact repeat', () => {
    showToast(RUN)
    showToast(RUN)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].count).toBe(2)
    showToast({ ...RUN, text: 'a different reason' })
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toMatchObject({ text: 'a different reason', count: 1 })
  })

  it('keys a bubble by its category and text when it names no key', () => {
    const tps = { category: 'warnings', tone: 'warn', title: 'Low TPS', text: 'TPS 12' } as const
    showToast(tps)
    showToast(tps)
    showToast({ ...tps, text: 'TPS 9' })
    expect(toasts().map((t) => [t.text, t.count])).toEqual([
      ['TPS 12', 2],
      ['TPS 9', 1],
    ])
  })

  const WARN: ToastInput = {
    key: 'scheduler:warning',
    category: 'warnings',
    tone: 'warn',
    title: 'Scheduler warning',
    text: 'Command: stops the server',
    standing: true,
  }

  // A failed run, a crash: each arrival is news, so dismissing one never
  // silences the next, even with the same reason.
  it('shows news again after a dismissal, and remembers nothing', () => {
    showToast(RUN)
    dismissToast(toasts()[0].id)
    expect(toasts()).toEqual([])
    showToast(RUN)
    expect(toasts()).toHaveLength(1)
    expect(useNotificationsStore.getState().dismissedToasts).toEqual({})
  })

  // A graph's warnings: shown until dismissed once, then never again this
  // session, whichever graph's text it would carry next.
  it('keeps a standing bubble dismissed whatever its text becomes', () => {
    showToast(WARN)
    dismissToast(toasts()[0].id)
    showToast(WARN)
    showToast({ ...WARN, text: 'another graph' })
    expect(toasts()).toEqual([])
  })

  it('shows a dismissed standing bubble when forced, and forgets the dismissal', () => {
    showToast(WARN)
    dismissToast(toasts()[0].id)
    showToast(WARN, true)
    expect(toasts()).toHaveLength(1)
    expect(useNotificationsStore.getState().dismissedToasts).toEqual({})
  })

  it('does not count a standing bubble raised again as it was', () => {
    showToast(WARN)
    showToast(WARN)
    expect(toasts()[0].count).toBe(1)
  })

  it('does not count a forced reopen of a bubble that is already up', () => {
    showToast(RUN)
    showToast(RUN, true)
    expect(toasts()[0].count).toBe(1)
  })

  it('dismisses every bubble at once, remembering the standing ones', () => {
    showToast(RUN)
    showToast(WARN)
    dismissAllToasts()
    expect(toasts()).toEqual([])
    showToast(RUN)
    showToast(WARN)
    expect(toasts().map((t) => t.key)).toEqual(['scheduler:run'])
  })

  // A withdrawal is the condition clearing, not the user saying no: the
  // bubble shows again the next time it arises.
  it('withdraws by key without remembering a dismissal', () => {
    showToast(WARN)
    withdrawToast('scheduler:warning')
    expect(toasts()).toEqual([])
    showToast(WARN)
    expect(toasts()).toHaveLength(1)
  })

  it('moves a repeated piece of news down to the newest place', () => {
    showToast(RUN)
    showToast({ ...RUN, key: 'other' })
    const id = toasts()[0].id
    showToast(RUN)
    expect(toasts().map((t) => t.key)).toEqual(['other', 'scheduler:run'])
    expect(toasts()[1]).toMatchObject({ id, count: 2 })
  })

  it('updates a standing condition in place', () => {
    showToast(WARN)
    showToast({ ...RUN, key: 'other' })
    showToast({ ...WARN, text: 'a newer warning' })
    expect(toasts().map((t) => t.key)).toEqual(['scheduler:warning', 'other'])
  })

  it('stacks three bubbles at most', () => {
    expect(MAX_TOASTS).toBe(3)
  })

  it('caps the stack, dropping the oldest', () => {
    for (let i = 0; i < MAX_TOASTS + 3; i++) showToast({ ...RUN, key: `k${i}` })
    expect(toasts()).toHaveLength(MAX_TOASTS)
    expect(toasts()[0].key).toBe('k3')
  })
})
