import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ConfigFile } from '../../types'
import { EditorPanel, FORM_MAX_CHARS } from './EditorPanel'

// CodeMirror needs layout jsdom does not have; only the view choice is under test.
vi.mock('@uiw/react-codemirror', () => ({ default: () => <div data-testid="raw-editor" /> }))

afterEach(cleanup)

const jsonFile: ConfigFile = {
  relPath: 'config/hull.json',
  name: 'hull.json',
  category: 'mods',
  source: '',
  format: 'json',
  sizeBytes: 0,
  modified: 0,
}

function renderPanel(content: string) {
  render(
    <EditorPanel
      file={jsonFile}
      content={content}
      onChange={() => {}}
      isDirty={false}
      loading={false}
      saving={false}
      saveError={null}
      isRunning={false}
      onSave={() => {}}
      onRevert={() => {}}
      onRestart={() => {}}
    />,
  )
}

// A 10 MB file in the form view rendered about 100,000 elements and held the
// main thread for as long as it was open (#767).
describe('the config editor form view size cap', () => {
  it('offers the form view for a small JSON object', () => {
    renderPanel('{"a": 1}')
    expect(screen.getByRole('button', { name: 'form' })).toBeTruthy()
    expect(screen.queryByTestId('raw-editor')).toBeNull()
  })

  it('opens a file over the cap in the raw editor only', () => {
    const big = JSON.stringify({ blob: 'x'.repeat(FORM_MAX_CHARS) })
    renderPanel(big)
    expect(screen.getByText('Raw only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'form' })).toBeNull()
    expect(screen.getByTestId('raw-editor')).toBeTruthy()
  })
})

// Typing is simulated by rerendering with the new text, as the tile does.
describe('the config editor view choice while typing', () => {
  const other: ConfigFile = { ...jsonFile, relPath: 'config/other.json', name: 'other.json' }
  const panel = (content: string, file: ConfigFile = jsonFile) => (
    <EditorPanel
      file={file}
      content={content}
      onChange={() => {}}
      isDirty={false}
      loading={false}
      saving={false}
      saveError={null}
      isRunning={false}
      onSave={() => {}}
      onRevert={() => {}}
      onRestart={() => {}}
    />
  )
  const sized = (n: number) => JSON.stringify({ k: 'x'.repeat(n - 8) })

  it('stays in form view when typing pushes it past the cap', () => {
    const { rerender } = render(panel(sized(FORM_MAX_CHARS - 10)))
    expect(screen.queryByTestId('raw-editor')).toBeNull()
    rerender(panel(sized(FORM_MAX_CHARS + 20)))
    expect(screen.queryByTestId('raw-editor')).toBeNull()
    expect(screen.getByRole('button', { name: 'form' })).toBeTruthy()
  })

  it('keeps a raw choice when the text becomes parseable again', () => {
    const { rerender } = render(panel('{"a": 1}'))
    fireEvent.click(screen.getByRole('button', { name: 'raw' }))
    rerender(panel('{"a": 1,'))
    expect(screen.getByText('Raw only')).toBeTruthy()
    rerender(panel('{"a": 12}'))
    expect(screen.getByTestId('raw-editor')).toBeTruthy()
  })

  it('resets to form when another file is opened', () => {
    const { rerender } = render(panel('{"a": 1}'))
    fireEvent.click(screen.getByRole('button', { name: 'raw' }))
    expect(screen.getByTestId('raw-editor')).toBeTruthy()
    rerender(panel('{"b": 2}', other))
    expect(screen.queryByTestId('raw-editor')).toBeNull()
  })

  it('opens a file loaded over the cap in raw only', () => {
    const { rerender } = render(panel(''))
    rerender(panel(sized(FORM_MAX_CHARS + 20), other))
    expect(screen.getByText('Raw only')).toBeTruthy()
    expect(screen.getByTestId('raw-editor')).toBeTruthy()
  })
})
