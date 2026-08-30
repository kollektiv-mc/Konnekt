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

async function mount(items: unknown[], status?: Record<string, unknown>) {
  vi.mocked(App.GetCommandButtons).mockResolvedValue(
    models.CommandButtonSet.createFrom({ seeded: true, items }),
  )
  vi.mocked(App.RefreshKommands).mockResolvedValue(
    models.KommandsStatus.createFrom({ installed: false, ...status }),
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
  vi.mocked(App.GetKommandsCommands).mockResolvedValue([])
})

describe('CommandLibrary link states', () => {
  it('shows an applied Kommands update until it is acknowledged', async () => {
    await mount([button({ link: linkOf({ status: 'changed', prevValue: 'give @p dirt' }) })])
    expect(screen.getByText('Updated in Kommands')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(useCommandsStore.getState().items[0].link?.status).toBe('ok'))
    // The applied value survives acknowledgement; only the badge clears.
    expect(useCommandsStore.getState().items[0].value).toBe('give @p stone')
  })

  it('offers unlink and remove for a broken link, and removes nothing on its own', async () => {
    await mount([button({ link: linkOf({ status: 'broken' }) })])
    expect(screen.getByText('Original deleted')).toBeTruthy()
    // A working button is never removed because another application tidied up.
    expect(useCommandsStore.getState().items).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(useCommandsStore.getState().items[0].link).toBeUndefined())
    expect(useCommandsStore.getState().items).toHaveLength(1)
  })
})

describe('CommandLibrary editing a linked command', () => {
  it('asks before forking, and leaves the link alone on cancel', async () => {
    await mount([button({ link: linkOf() })])

    const value = screen.getByLabelText('Command for Kit')
    fireEvent.change(value, { target: { value: 'give @p diamond' } })
    fireEvent.blur(value)

    expect(await screen.findByText('Editing unlinks this command')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText('Editing unlinks this command')).toBeNull())
    expect(useCommandsStore.getState().items[0].link).toBeTruthy()
    expect(useCommandsStore.getState().items[0].value).toBe('give @p stone')
  })

  it('keeps the edit and drops the link on confirm', async () => {
    await mount([button({ link: linkOf() })])

    const value = screen.getByLabelText('Command for Kit')
    fireEvent.change(value, { target: { value: 'give @p diamond' } })
    fireEvent.blur(value)

    fireEvent.click(await screen.findByRole('button', { name: 'Keep my edit, unlink' }))
    await waitFor(() => expect(useCommandsStore.getState().items[0].link).toBeUndefined())
    expect(useCommandsStore.getState().items[0].value).toBe('give @p diamond')
  })

  it('edits an unlinked command with no confirmation at all', async () => {
    await mount([button()])
    const value = screen.getByLabelText('Command for Kit')
    fireEvent.change(value, { target: { value: 'give @p diamond' } })
    fireEvent.blur(value)

    await waitFor(() => expect(useCommandsStore.getState().items[0].value).toBe('give @p diamond'))
    expect(screen.queryByText('Editing unlinks this command')).toBeNull()
  })
})

describe('CommandLibrary Kommands panel', () => {
  // Kommands has no persistence yet, so this is the state essentially every
  // user is in. It must not read as something being broken.
  it('states plainly that nothing is saved yet, with no error styling', async () => {
    await mount([button()])
    expect(screen.getByText(/has not saved any commands/i)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names the version when the file is newer than this build understands', async () => {
    await mount([button()], { installed: true, unsupported: true, version: 2 })
    expect(screen.getByText(/newer format \(version 2\)/i)).toBeTruthy()
  })
})
