import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../../wailsjs/go/main/App'
import { models } from '../../../../wailsjs/go/models'
import { useCommandsStore } from '../../../stores/useCommandsStore'
import { CommandLibrary } from './CommandLibrary'

vi.mock('../../../../wailsjs/go/main/App')

afterEach(cleanup)

const button = (over: Record<string, unknown> = {}) => ({
  id: '1',
  label: 'Kit',
  kind: 'cmd',
  value: 'give @p stone',
  ...over,
})

const linkOf = (over: Record<string, unknown> = {}) => ({
  source: 'kommands',
  id: 'k1',
  revision: 3,
  status: 'ok',
  ...over,
})

async function mount(items: unknown[], status?: Record<string, unknown>, saved: unknown[] = []) {
  vi.mocked(App.GetCommandButtons).mockResolvedValue(
    models.CommandButtonSet.createFrom({ seeded: true, items }),
  )
  vi.mocked(App.RefreshKommands).mockResolvedValue(
    models.KommandsStatus.createFrom({ installed: false, ...status }),
  )
  vi.mocked(App.GetKommandsCommands).mockResolvedValue(
    saved.map((sc) => models.KommandsSavedCommand.createFrom(sc)),
  )
  render(<CommandLibrary serverId="srv1" />)
  await screen.findByText('Commands')
  await waitFor(() => expect(useCommandsStore.getState().hydrated).toBe(true))
}

beforeEach(() => {
  vi.clearAllMocks()
  useCommandsStore.setState({
    items: [],
    kommands: null,
    saved: [],
    hydrated: false,
    loading: false,
    error: null,
  })
  ;(window as unknown as { go?: unknown }).go = {}
  vi.mocked(App.SaveCommandButtons).mockResolvedValue(undefined)
})

describe('CommandLibrary link states', () => {
  it('shows an applied Kommands update until it is acknowledged', async () => {
    await mount([button({ link: linkOf({ status: 'changed' }) })])
    expect(screen.getByText('Updated in Kommands')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(useCommandsStore.getState().items[0].link?.status).toBe('ok'))
    // The applied value survives acknowledgement; only the badge clears.
    expect(useCommandsStore.getState().items[0].value).toBe('give @p stone')
  })

  it("keeps a row Kommands unlinked, and lets it become the server's own", async () => {
    await mount([button({ link: linkOf({ status: 'broken' }) })])
    expect(screen.getByText('Unlinked in Kommands')).toBeTruthy()
    // Nothing is removed because another application tidied up.
    expect(useCommandsStore.getState().items).toHaveLength(1)
    // Still not editable: it is Kommands' text until the user claims it.
    expect(screen.queryByLabelText('Command for Kit')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(useCommandsStore.getState().items[0].link).toBeUndefined())
    expect(useCommandsStore.getState().items).toHaveLength(1)
    // And now it is an ordinary row, editable in place.
    expect(screen.getByLabelText('Command for Kit')).toBeTruthy()
  })

  it('shows a linked command as text and offers a copy instead of an edit', async () => {
    await mount([button({ link: linkOf() })])

    // The label and command are Kommands'. There is no field to type into,
    // because an edit here would be undone by the next sync; the row can still
    // be deleted, since the user added it and nothing brings it back.
    expect(screen.getByTitle(/follows its original in Kommands/i)).toBeTruthy()
    expect(screen.queryByLabelText('Command for Kit')).toBeNull()
    expect(screen.queryByLabelText('Label for Kit')).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Kit' })).toBeTruthy()
    expect(screen.getByText('give @p stone')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Make a copy of Kit' }))
    await waitFor(() => expect(useCommandsStore.getState().items).toHaveLength(2))
    const [original, copy] = useCommandsStore.getState().items
    // The original still follows its source; the copy is this server's own.
    expect(original.link?.id).toBe('k1')
    expect(copy.link).toBeUndefined()
    expect(copy.value).toBe('give @p stone')
    expect(copy.id).not.toBe(original.id)
    expect(screen.getByLabelText('Command for Kit')).toBeTruthy()
  })

  it('edits an unlinked command with no confirmation at all', async () => {
    await mount([button()])
    const value = screen.getByLabelText('Command for Kit')
    fireEvent.change(value, { target: { value: 'give @p diamond' } })
    fireEvent.blur(value)

    await waitFor(() => expect(useCommandsStore.getState().items[0].value).toBe('give @p diamond'))
  })
})

describe('CommandLibrary reordering', () => {
  const two = [
    button({ id: 'a', label: 'Alpha', value: 'say a' }),
    button({ id: 'b', label: 'Beta', value: 'say b' }),
  ]

  it('moves a row with the arrow keys on its handle', async () => {
    await mount(two)
    // The handle is a button, so it is reachable without a pointer, and the
    // arrow keys move the row one step. Reordering used to need a drag and
    // nothing else, and the drag did not reliably land.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Alpha' }), {
      key: 'ArrowDown',
    })
    await waitFor(() =>
      expect(useCommandsStore.getState().items.map((it) => it.id)).toEqual(['b', 'a']),
    )
    const saved = vi.mocked(App.SaveCommandButtons).mock.lastCall?.[0]
    expect(saved?.map((it) => it.id)).toEqual(['b', 'a'])
  })

  it('does not move past either end', async () => {
    await mount(two)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Alpha' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Beta' }), { key: 'ArrowDown' })
    expect(App.SaveCommandButtons).not.toHaveBeenCalled()
  })

  it('is off while the list is filtered, and says why', async () => {
    await mount(two)
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'alp' } })
    const handle = screen.getByRole('button', { name: 'Reorder Alpha' }) as HTMLButtonElement
    expect(handle.disabled).toBe(true)
    expect(handle.title).toMatch(/clear the search/i)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(App.SaveCommandButtons).not.toHaveBeenCalled()
  })
})

describe('CommandLibrary Kommands panel', () => {
  const theirs = { id: 'k9', revision: 5, label: 'Theirs', command: 'say theirs', updatedAt: 0 }

  it('says nothing is linked yet, with no error styling', async () => {
    // Not having Kommands is the state essentially every user is in. It must
    // not read as something being broken, and it has to say where linking
    // happens, since nothing here can start one.
    await mount([button()])
    expect(screen.getByText(/Nothing linked yet/i)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names the version when the file is newer than this build understands', async () => {
    await mount([button()], { installed: true, unsupported: true, version: 2 })
    expect(screen.getByText(/newer format \(version 2\)/i)).toBeTruthy()
  })

  it('adds a linked command as a new row, once', async () => {
    await mount([button()], { installed: true, savedCount: 1 }, [theirs])
    expect(screen.getByText('1 linked')).toBeTruthy()

    // Linking in Kommands only made it visible. Adding is the act here, and it
    // creates a new row rather than replacing one.
    fireEvent.click(screen.getByRole('button', { name: 'Add Theirs' }))
    await waitFor(() => expect(useCommandsStore.getState().items).toHaveLength(2))
    const [kit, added] = useCommandsStore.getState().items
    expect(kit.value).toBe('give @p stone')
    expect(added.value).toBe('say theirs')
    expect(added.link).toEqual({ source: 'kommands', id: 'k9', revision: 5, status: 'ok' })

    // Now a button, so the list says so and does not offer it again.
    const done = screen.getByRole('button', { name: 'Theirs is added' }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    expect(screen.getByText('2 · 1 linked')).toBeTruthy()
  })
})
