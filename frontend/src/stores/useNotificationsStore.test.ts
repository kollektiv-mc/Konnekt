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

  it('remembers a dismissal of the same text, and shows a new one', () => {
    showToast(RUN)
    dismissToast(toasts()[0].id)
    expect(toasts()).toEqual([])
    showToast(RUN)
    expect(toasts()).toEqual([])
    showToast({ ...RUN, text: 'news' })
    expect(toasts()).toHaveLength(1)
  })

  it('shows a dismissed bubble again when it resurfaces', () => {
    const failed = { ...RUN, resurface: true }
    showToast(failed)
    dismissToast(toasts()[0].id)
    showToast(failed)
    expect(toasts()).toHaveLength(1)
    expect(useNotificationsStore.getState().dismissedToasts).toEqual({})
  })

  it('shows a dismissed bubble again when forced, and forgets the dismissal', () => {
    showToast(RUN)
    dismissToast(toasts()[0].id)
    showToast(RUN, true)
    expect(toasts()).toHaveLength(1)
    expect(useNotificationsStore.getState().dismissedToasts).toEqual({})
  })

  it('does not count a forced reopen of a bubble that is already up', () => {
    showToast(RUN)
    showToast(RUN, true)
    expect(toasts()[0].count).toBe(1)
  })

  it('dismisses every bubble at once, remembering each', () => {
    showToast(RUN)
    showToast({ ...RUN, key: 'other' })
    dismissAllToasts()
    expect(toasts()).toEqual([])
    showToast(RUN)
    showToast({ ...RUN, key: 'other' })
    expect(toasts()).toEqual([])
  })

  // A withdrawal is the condition clearing, not the user saying no: the same
  // text shows again the next time it arises.
  it('withdraws by key without remembering a dismissal', () => {
    showToast(RUN)
    withdrawToast('scheduler:run')
    expect(toasts()).toEqual([])
    showToast(RUN)
    expect(toasts()).toHaveLength(1)
  })

  it('moves a resurfacing bubble down to the newest place', () => {
    showToast({ ...RUN, resurface: true })
    showToast({ ...RUN, key: 'other' })
    const id = toasts()[0].id
    showToast({ ...RUN, resurface: true })
    expect(toasts().map((t) => t.key)).toEqual(['other', 'scheduler:run'])
    expect(toasts()[1]).toMatchObject({ id, count: 2 })
  })

  it('updates a standing condition in place', () => {
    showToast(RUN)
    showToast({ ...RUN, key: 'other' })
    showToast(RUN)
    showToast({ ...RUN, text: 'a newer reason' })
    expect(toasts().map((t) => t.key)).toEqual(['scheduler:run', 'other'])
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
