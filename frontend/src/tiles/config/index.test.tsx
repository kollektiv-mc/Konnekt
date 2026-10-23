import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as App from '../../../wailsjs/go/main/App'
import { useUiStore } from '../../stores/useUiStore'
import { ConfigTile } from './index'

vi.mock('../../../wailsjs/go/main/App')
// CodeMirror is the reason the real panel is lazy; a textarea stands in for it.
vi.mock('./EditorPanel', () => ({
  EditorPanel: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
    <textarea aria-label="editor" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openFile(): Promise<HTMLTextAreaElement> {
  fireEvent.click(await screen.findByRole('button', { name: /server\.properties/ }))
  const editor = (await screen.findByLabelText('editor')) as HTMLTextAreaElement
  await waitFor(() => expect(editor.value).toBe('motd=hi'))
  return editor
}

const file = (name: string) => ({
  relPath: name,
  name,
  category: 'server',
  source: '',
  format: 'properties',
  sizeBytes: 7,
  modified: 0,
})

// The maximized config editor used to register no close guard, so a close or a
// server switch discarded whatever was typed without asking (#450). It then
// asked through the browser's own confirm; it asks through Konnekt's dialog now.
describe('the maximized config editor close guard', () => {
  beforeEach(() => {
    vi.mocked(App.ListConfigFiles).mockResolvedValue([
      file('server.properties'),
      file('bukkit.yml'),
    ] as Awaited<ReturnType<typeof App.ListConfigFiles>>)
    vi.mocked(App.ReadConfigFile).mockImplementation((_id, relPath) =>
      Promise.resolve(relPath === 'bukkit.yml' ? 'settings: {}' : 'motd=hi'),
    )
    vi.mocked(App.WriteConfigFile).mockResolvedValue(undefined)
    useUiStore.setState({ closeGuard: null })
  })

  async function dirtyEditor(): Promise<HTMLTextAreaElement> {
    render(<ConfigTile serverId="a" maximized />)
    const editor = await openFile()
    fireEvent.change(editor, { target: { value: 'motd=changed' } })
    return editor
  }

  it('lets a clean editor go without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<ConfigTile serverId="a" maximized />)
    await openFile()

    const proceed = vi.fn()
    expect(useUiStore.getState().closeGuard?.(proceed)).toBe(false)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    // Returning false leaves the caller to act, so the guard runs nothing itself.
    expect(proceed).not.toHaveBeenCalled()
  })

  it('asks before a dirty editor goes, and drops the action on cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const editor = await dirtyEditor()

    const proceed = vi.fn()
    act(() => {
      expect(useUiStore.getState().closeGuard?.(proceed)).toBe(true)
    })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(proceed).not.toHaveBeenCalled()
    expect(editor.value).toBe('motd=changed')
  })

  it('reverts and continues on discard, without asking a second time', async () => {
    const editor = await dirtyEditor()

    // What Dashboard's close passes: the close re-enters the guard from here.
    const proceed = vi.fn(() => {
      expect(useUiStore.getState().closeGuard?.(() => {})).toBe(false)
    })
    act(() => {
      useUiStore.getState().closeGuard?.(proceed)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(proceed).toHaveBeenCalledOnce()
    await waitFor(() => expect(editor.value).toBe('motd=hi'))
    expect(App.WriteConfigFile).not.toHaveBeenCalled()
  })

  it('saves and continues, without asking a second time', async () => {
    await dirtyEditor()

    const proceed = vi.fn(() => {
      expect(useUiStore.getState().closeGuard?.(() => {})).toBe(false)
    })
    act(() => {
      useUiStore.getState().closeGuard?.(proceed)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }))

    await waitFor(() => expect(proceed).toHaveBeenCalledOnce())
    expect(App.WriteConfigFile).toHaveBeenCalledWith('a', 'server.properties', 'motd=changed')
  })

  it('stays put when the save before a close fails', async () => {
    vi.mocked(App.WriteConfigFile).mockRejectedValue(new Error('disk full'))
    const editor = await dirtyEditor()

    const proceed = vi.fn()
    act(() => {
      useUiStore.getState().closeGuard?.(proceed)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }))

    await waitFor(() => expect(App.WriteConfigFile).toHaveBeenCalledOnce())
    expect(proceed).not.toHaveBeenCalled()
    expect(editor.value).toBe('motd=changed')
  })

  it('asks before switching files, and switches on discard', async () => {
    const editor = await dirtyEditor()

    fireEvent.click(screen.getByRole('button', { name: /bukkit\.yml/ }))
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(App.ReadConfigFile).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(editor.value).toBe('settings: {}'))
    expect(App.WriteConfigFile).not.toHaveBeenCalled()
  })

  it('keeps the file and its edits when a switch is cancelled', async () => {
    const editor = await dirtyEditor()

    fireEvent.click(screen.getByRole('button', { name: /bukkit\.yml/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(App.ReadConfigFile).toHaveBeenCalledTimes(1)
    expect(editor.value).toBe('motd=changed')
  })

  it('registers nothing for the compact face, and clears on unmount', () => {
    const compact = render(<ConfigTile serverId="a" />)
    expect(useUiStore.getState().closeGuard).toBeNull()
    compact.unmount()

    const { unmount } = render(<ConfigTile serverId="a" maximized />)
    expect(useUiStore.getState().closeGuard).not.toBeNull()
    unmount()
    expect(useUiStore.getState().closeGuard).toBeNull()
  })
})
