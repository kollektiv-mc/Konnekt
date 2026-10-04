import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { FontSettings } from './FontSettings'

vi.mock('../../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Only the timers are faked: the list arrives on a promise, which a fake clock
// would not need to advance and `waitFor` would then fight over.
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.mocked(App.ListFontFamilies).mockResolvedValue(['Alpha', 'Beta'])
})

const field = (label: string) => screen.getByRole('combobox', { name: label }) as HTMLInputElement
const settle = () => act(async () => {})
const typeInto = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } })
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('FontSettings', () => {
  it('shows one empty field per font token by default', async () => {
    render(<FontSettings fonts={{}} onChange={() => {}} />)
    await settle()
    for (const label of ['Body', 'Titles', 'Wordmark', 'Code']) {
      expect(field(label).value).toBe('')
      expect(field(label).placeholder).toBe('Default')
    }
  })

  it('shows the stored choice', async () => {
    render(<FontSettings fonts={{ mono: 'Fira Code' }} onChange={() => {}} />)
    await settle()
    expect(field('Code').value).toBe('Fira Code')
    expect(field('Body').value).toBe('')
  })

  it('suggests the installed families the desktop reports', async () => {
    render(<FontSettings fonts={{}} onChange={() => {}} />)
    await settle()
    const chevron = screen.getByRole('button', { name: 'Body: show presets' })
    fireEvent.pointerDown(chevron)
    fireEvent.click(chevron)
    const names = (label: string) =>
      within(screen.getByRole('listbox', { name: label }))
        .queryAllByRole('option')
        .map((o) => o.textContent)
    expect(names('Body')).toEqual(['Alpha', 'Beta'])
    // Only the field that was reached holds the list.
    expect(names('Code')).toEqual([])
  })

  it('takes a name that is not on the list', async () => {
    const onChange = vi.fn()
    render(<FontSettings fonts={{}} onChange={onChange} />)
    await settle()
    typeInto('Code', 'Some Face Nobody Has')
    await pass(500)
    expect(onChange).toHaveBeenCalledWith({ mono: 'Some Face Nobody Has' })
  })

  it('writes once after typing pauses, not once per keystroke', async () => {
    const onChange = vi.fn()
    render(<FontSettings fonts={{}} onChange={onChange} />)
    await settle()
    typeInto('Code', 'F')
    await pass(100)
    typeInto('Code', 'Fi')
    await pass(100)
    typeInto('Code', 'Fira Code ')
    expect(onChange).not.toHaveBeenCalled()
    await pass(500)
    expect(onChange).toHaveBeenCalledTimes(1)
    // The cleaned name is what is stored; the field keeps what was typed.
    expect(onChange).toHaveBeenCalledWith({ mono: 'Fira Code' })
    expect(field('Code').value).toBe('Fira Code ')
  })

  it('keeps the other roles when one changes, and drops one that is emptied', async () => {
    const onChange = vi.fn()
    render(<FontSettings fonts={{ sans: 'Inter', mono: 'Fira Code' }} onChange={onChange} />)
    await settle()
    typeInto('Titles', 'Cooper Black')
    await pass(500)
    expect(onChange).toHaveBeenLastCalledWith({
      sans: 'Inter',
      title: 'Cooper Black',
      mono: 'Fira Code',
    })
    typeInto('Body', '')
    await pass(500)
    expect(onChange).toHaveBeenLastCalledWith({ title: 'Cooper Black', mono: 'Fira Code' })
  })

  it('writes a pending choice when the section goes away before the delay', async () => {
    const onChange = vi.fn()
    const { unmount } = render(<FontSettings fonts={{}} onChange={onChange} />)
    await settle()
    typeInto('Body', 'Inter')
    unmount()
    expect(onChange).toHaveBeenCalledWith({ sans: 'Inter' })
    // And only once: the timer it cancelled must not fire as well.
    await pass(500)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('still takes a typed name when the list cannot be read', async () => {
    vi.mocked(App.ListFontFamilies).mockRejectedValue(new Error('no bridge'))
    const onChange = vi.fn()
    render(<FontSettings fonts={{}} onChange={onChange} />)
    await settle()
    expect(screen.getByText(/could be listed/)).toBeDefined()
    typeInto('Body', 'Inter')
    await pass(500)
    expect(onChange).toHaveBeenCalledWith({ sans: 'Inter' })
  })

  it('treats a list that is not an array as empty', async () => {
    vi.mocked(App.ListFontFamilies).mockResolvedValue(null as unknown as string[])
    render(<FontSettings fonts={{}} onChange={() => {}} />)
    await settle()
    expect(screen.getByText(/could be listed/)).toBeDefined()
  })
})
