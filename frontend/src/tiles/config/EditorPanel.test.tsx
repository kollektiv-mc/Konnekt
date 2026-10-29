import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
