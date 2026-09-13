import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { models } from '../../wailsjs/go/models'
import { useCommandsStore } from './useCommandsStore'

vi.mock('../../wailsjs/go/main/App')

const INITIAL = {
  items: [],
  kommands: null,
  saved: [],
  hydrated: false,
  loading: false,
  error: null,
}

const seededSet = (items: unknown[]) => models.CommandButtonSet.createFrom({ seeded: true, items })

function withBridge(present: boolean) {
  const w = window as unknown as { go?: unknown }
  if (present) w.go = {}
  else delete w.go
}

beforeEach(() => {
  vi.clearAllMocks()
  useCommandsStore.setState({ ...INITIAL })
  vi.mocked(App.RefreshKommands).mockResolvedValue(
    models.KommandsStatus.createFrom({ installed: false }),
  )
  vi.mocked(App.GetKommandsCommands).mockResolvedValue([])
  vi.mocked(App.SaveCommandButtons).mockResolvedValue(undefined)
  withBridge(true)
})

describe('useCommandsStore hydrate', () => {
  it('is idempotent, because the tile is mounted twice while maximized', async () => {
    vi.mocked(App.GetCommandButtons).mockResolvedValue(
      seededSet([{ id: '1', label: 'List', kind: 'cmd', value: 'list' }]),
    )
    // Both mounts race on the same tick, which is exactly the real case:
    // Dashboard renders the maximized copy in addition to the grid one.
    await Promise.all([
      useCommandsStore.getState().hydrate(),
      useCommandsStore.getState().hydrate(),
    ])
    expect(App.GetCommandButtons).toHaveBeenCalledTimes(1)
    expect(useCommandsStore.getState().items).toHaveLength(1)
  })

  it('seeds only when no file has ever been written', async () => {
    vi.mocked(App.GetCommandButtons).mockResolvedValue(
      models.CommandButtonSet.createFrom({ seeded: false, items: [] }),
    )
    vi.mocked(App.GetCustomCommands).mockResolvedValue(['weather thunder'])
    await useCommandsStore.getState().hydrate()

    const items = useCommandsStore.getState().items
    expect(items.length).toBeGreaterThan(1)
    // The one-time custom_commands.json migration folds in.
    expect(items.some((i) => i.value === 'weather thunder')).toBe(true)
    expect(App.SaveCommandButtons).toHaveBeenCalled()
  })

  it('has the seed on disk before it asks Kommands to sync', async () => {
    // Go syncs linked commands only into a seeded file. If the seed were still
    // in flight when the first sync ran, whatever is linked in Kommands would be
    // missing from a first launch until the next window focus.
    const order: string[] = []
    vi.mocked(App.GetCommandButtons).mockResolvedValue(
      models.CommandButtonSet.createFrom({ seeded: false, items: [] }),
    )
    vi.mocked(App.GetCustomCommands).mockResolvedValue([])
    vi.mocked(App.SaveCommandButtons).mockImplementation(async () => {
      order.push('seed')
    })
    vi.mocked(App.RefreshKommands).mockImplementation(async () => {
      order.push('sync')
      return models.KommandsStatus.createFrom({ installed: false })
    })
    await useCommandsStore.getState().hydrate()
    expect(order).toEqual(['seed', 'sync'])
  })

  it('does not resurrect defaults when the user deleted every button', async () => {
    // The old string binding returned "" for this and for a first launch alike,
    // so the two were indistinguishable.
    vi.mocked(App.GetCommandButtons).mockResolvedValue(seededSet([]))
    await useCommandsStore.getState().hydrate()
    expect(useCommandsStore.getState().items).toHaveLength(0)
    expect(App.SaveCommandButtons).not.toHaveBeenCalled()
  })
})

describe('useCommandsStore seed write', () => {
  beforeEach(() => {
    vi.mocked(App.GetCommandButtons).mockResolvedValue(
      models.CommandButtonSet.createFrom({ seeded: false, items: [] }),
    )
    vi.mocked(App.GetCustomCommands).mockResolvedValue([])
  })

  // The seed is shown either way, so a failed write has nothing to revert into;
  // what it must not do is vanish into the console (#315).
  it('keeps the seed on screen and records the error when the write rejects', async () => {
    vi.mocked(App.SaveCommandButtons).mockRejectedValue(new Error('disk full'))
    await useCommandsStore.getState().hydrate()

    const s = useCommandsStore.getState()
    expect(s.items.length).toBeGreaterThan(0)
    expect(s.hydrated).toBe(true)
    expect(s.loading).toBe(false)
    expect(s.error).toBe('disk full')
  })

  it('records nothing with no backend attached', async () => {
    withBridge(false)
    vi.mocked(App.SaveCommandButtons).mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'main')")
    })
    await useCommandsStore.getState().hydrate()

    const s = useCommandsStore.getState()
    expect(s.items.length).toBeGreaterThan(0)
    expect(s.error).toBeNull()
    expect(App.SaveCommandButtons).not.toHaveBeenCalled()
  })
})

describe('useCommandsStore writes', () => {
  const one = [{ id: '1', label: 'List', kind: 'cmd', value: 'list' }]

  beforeEach(async () => {
    vi.mocked(App.GetCommandButtons).mockResolvedValue(seededSet(one))
    await useCommandsStore.getState().hydrate()
    vi.mocked(App.SaveCommandButtons).mockClear()
  })

  it('reverts, records and rethrows when a real save fails', async () => {
    vi.mocked(App.SaveCommandButtons).mockRejectedValue('disk full')
    await expect(useCommandsStore.getState().remove('1')).rejects.toBeTruthy()
    expect(useCommandsStore.getState().items).toHaveLength(1)
    expect(useCommandsStore.getState().error).toContain('disk full')
  })

  it('keeps the optimistic value with no backend attached', async () => {
    // The browser-only frontend-dev preset: every binding throws because there
    // is no Go process, and reverting would make the preview read-only.
    withBridge(false)
    vi.mocked(App.SaveCommandButtons).mockRejectedValue(new TypeError('no bridge'))
    await useCommandsStore.getState().remove('1')
    expect(useCommandsStore.getState().items).toHaveLength(0)
    expect(useCommandsStore.getState().error).toBeNull()
  })

  it('reorders by moving one row to a new index', async () => {
    useCommandsStore.setState({
      items: [
        models.CommandButton.createFrom({ id: 'a', label: 'A', kind: 'cmd', value: 'a' }),
        models.CommandButton.createFrom({ id: 'b', label: 'B', kind: 'cmd', value: 'b' }),
        models.CommandButton.createFrom({ id: 'c', label: 'C', kind: 'cmd', value: 'c' }),
      ],
    })
    await useCommandsStore.getState().reorder(0, 2)
    expect(useCommandsStore.getState().items.map((it) => it.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('useCommandsStore link actions', () => {
  const linkedItem = {
    id: '1',
    label: 'New',
    kind: 'cmd',
    value: 'say new',
    link: { source: 'kommands', id: 'k1', revision: 3, status: 'changed' },
  }

  beforeEach(async () => {
    vi.mocked(App.GetCommandButtons).mockResolvedValue(seededSet([linkedItem]))
    await useCommandsStore.getState().hydrate()
  })

  it('acknowledge clears the badge and keeps the applied value', async () => {
    await useCommandsStore.getState().acknowledge('1')
    const it = useCommandsStore.getState().items[0]
    expect(it.link?.status).toBe('ok')
    expect(it.value).toBe('say new')
  })

  it('unlink keeps the button', async () => {
    await useCommandsStore.getState().unlink('1')
    const items = useCommandsStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].link).toBeUndefined()
  })

  it('addLinked appends a button that already agrees with its original', async () => {
    await useCommandsStore.getState().addLinked(
      models.KommandsSavedCommand.createFrom({
        id: 'k9',
        revision: 5,
        label: 'Theirs',
        command: 'say theirs',
      }),
    )
    const items = useCommandsStore.getState().items
    expect(items).toHaveLength(2)
    const added = items[1]
    expect(added.label).toBe('Theirs')
    expect(added.value).toBe('say theirs')
    expect(added.kind).toBe('cmd')
    expect(added.link).toEqual({ source: 'kommands', id: 'k9', revision: 5, status: 'ok' })
    // Its own identity, not Kommands': the link id is what binds them.
    expect(added.id).not.toBe('k9')
  })

  it('duplicate puts an unlinked copy right after the original', async () => {
    await useCommandsStore.getState().duplicate('1')
    const items = useCommandsStore.getState().items
    expect(items).toHaveLength(2)
    // The original still follows Kommands; the copy is this server's own.
    expect(items[0].link?.id).toBe('k1')
    expect(items[1].link).toBeUndefined()
    expect(items[1].value).toBe('say new')
    expect(items[1].label).toBe('New')
    expect(items[1].id).not.toBe(items[0].id)
  })
})
