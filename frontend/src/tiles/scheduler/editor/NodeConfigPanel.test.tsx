import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { models } from '../../../../wailsjs/go/models'
import { NodeConfigPanel } from './NodeConfigPanel'
import type { NodeData } from './graphMapping'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

// ─── The command field is one control (#161) ────────────────────────────────
//
// It used to be a preset `<select>` above a bare `<textarea>`, and the preset
// won at run time without the node saying so. There is one field now, so the
// panel has to offer the presets from inside it and store what it shows.

const commandDef = {
  id: 'action.command',
  label: 'Command',
  description: 'Sends a command to the server.',
  configSchema: [
    {
      key: 'command',
      label: 'Command',
      type: 'command',
      required: true,
      options: [
        { label: 'Start Server', value: '__start__' },
        { label: 'Save All', value: 'save-all' },
      ],
    },
  ],
} as unknown as models.BlockDef

const data = (config: Record<string, unknown>) => ({ config }) as unknown as NodeData

const renderPanel = (config: Record<string, unknown>, onChange = vi.fn()) => {
  render(
    <NodeConfigPanel
      nodeId="n1"
      data={data(config)}
      def={commandDef}
      edges={[]}
      onChange={onChange}
    />,
  )
  return onChange
}

describe('NodeConfigPanel, the command field', () => {
  it('renders one combobox and no separate preset control', () => {
    renderPanel({ command: 'say hello' })

    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(document.querySelector('textarea')).toBeNull()
    expect(screen.queryByText('Preset')).toBeNull()
  })

  it('offers the presets from inside the field', () => {
    renderPanel({ command: '' })

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })

    expect(screen.getByText('Start Server')).toBeTruthy()
    expect(screen.getByText('Save All')).toBeTruthy()
  })

  it('writes a picked preset to the command key, not a preset key', () => {
    const onChange = renderPanel({ command: '' })

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByText('Start Server'))

    expect(onChange).toHaveBeenCalledWith('command', '__start__')
    expect(onChange).not.toHaveBeenCalledWith('preset', expect.anything())
  })

  it('names a lifecycle sentinel rather than showing it', () => {
    renderPanel({ command: '__start__' })

    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Start Server')
  })

  it('still takes a typed command, which is the case the preset used to eat', () => {
    const onChange = renderPanel({ command: '' })

    const field = screen.getByRole('combobox')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'say anything' } })

    expect(onChange).toHaveBeenCalledWith('command', 'say anything')
  })

  it('shows the read-only row instead of the field when an edge supplies it', () => {
    render(
      <NodeConfigPanel
        nodeId="n1"
        data={data({ command: 'say hello' })}
        def={commandDef}
        edges={[
          {
            id: 'e1',
            source: 'n0',
            target: 'n1',
            targetHandle: 'data:command',
            data: { kind: 'data' },
          },
        ]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('wired')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
