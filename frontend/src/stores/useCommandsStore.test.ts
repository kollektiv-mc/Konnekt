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

  it('does not resurrect defaults when the user deleted every button', async () => {
    // The old string binding returned "" for this and for a first launch alike,
    // so the two were indistinguishable.
    vi.mocked(App.GetCommandButtons).mockResolvedValue(seededSet([]))
    await useCommandsStore.getState().hydrate()
    expect(useCommandsStore.getState().items).toHaveLength(0)
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
})

describe('useCommandsStore link actions', () => {
  const linkedItem = {
    id: '1',
    label: 'New',
    kind: 'cmd',
    value: 'say new',
    link: {
      source: 'kommands',
      id: 'k1',
      revision: 3,
      status: 'changed',
      prevLabel: 'Old',
      prevValue: 'say old',
    },
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
    // Revert stays available afterwards.
    expect(it.link?.prevValue).toBe('say old')
  })

  it('revert restores the previous text and unlinks', async () => {
    await useCommandsStore.getState().revert('1')
    const it = useCommandsStore.getState().items[0]
    expect(it.value).toBe('say old')
    expect(it.label).toBe('Old')
    // Still linked, the next poll would re-apply the very update just undone.
    expect(it.link).toBeUndefined()
  })

  it('unlink keeps the button', async () => {
    await useCommandsStore.getState().unlink('1')
    const items = useCommandsStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].link).toBeUndefined()
  })

  it('linkTo adopts the original text so a new link never starts out stale', async () => {
    useCommandsStore.setState({
      items: [
        models.CommandButton.createFrom({ id: '2', label: 'Mine', kind: 'cmd', value: 'old' }),
      ],
    })
    await useCommandsStore.getState().linkTo(
      '2',
      models.KommandsSavedCommand.createFrom({
        id: 'k9',
        revision: 5,
        label: 'Theirs',
        command: 'say theirs',
      }),
    )
    const it = useCommandsStore.getState().items[0]
    expect(it.value).toBe('say theirs')
    expect(it.link?.id).toBe('k9')
    expect(it.link?.revision).toBe(5)
    expect(it.link?.status).toBe('ok')
  })
})
