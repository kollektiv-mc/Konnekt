import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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

// The maximized config editor used to register no close guard, so a close or a
// server switch discarded whatever was typed without asking (#450).
describe('the maximized config editor close guard', () => {
  beforeEach(() => {
    vi.mocked(App.ListConfigFiles).mockResolvedValue([
      {
        relPath: 'server.properties',
        name: 'server.properties',
        category: 'server',
        source: '',
        format: 'properties',
        sizeBytes: 7,
        modified: 0,
      },
    ] as Awaited<ReturnType<typeof App.ListConfigFiles>>)
    vi.mocked(App.ReadConfigFile).mockResolvedValue('motd=hi')
    useUiStore.setState({ closeGuard: null })
  })

  it('lets a clean editor go without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<ConfigTile serverId="a" maximized />)
    await openFile()

    const proceed = vi.fn()
    expect(useUiStore.getState().closeGuard?.(proceed)).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    // Returning false leaves the caller to act, so the guard runs nothing itself.
    expect(proceed).not.toHaveBeenCalled()
  })

  it('asks before a dirty editor goes, and drops the action on cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ConfigTile serverId="a" maximized />)
    const editor = await openFile()
    fireEvent.change(editor, { target: { value: 'motd=changed' } })

    const proceed = vi.fn()
    expect(useUiStore.getState().closeGuard?.(proceed)).toBe(true)
    expect(confirm).toHaveBeenCalledOnce()
    expect(proceed).not.toHaveBeenCalled()
    expect(editor.value).toBe('motd=changed')
  })

  it('reverts and continues on discard, without asking a second time', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ConfigTile serverId="a" maximized />)
    const editor = await openFile()
    fireEvent.change(editor, { target: { value: 'motd=changed' } })

    // What Dashboard's close passes: the close re-enters the guard from here.
    const proceed = vi.fn(() => {
      expect(useUiStore.getState().closeGuard?.(() => {})).toBe(false)
    })
    expect(useUiStore.getState().closeGuard?.(proceed)).toBe(true)

    expect(proceed).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(editor.value).toBe('motd=hi'))
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
