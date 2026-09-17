import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Combobox } from './Combobox'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const OPTIONS = [
  { value: 'tps', label: 'tps' },
  { value: 'players.count', label: 'players.count' },
  { value: 'players.max', label: 'players.max' },
  { value: 'server.motd', label: 'server.motd' },
]

const control = () => screen.getByRole('combobox')
const options = () => screen.getAllByRole('option')

describe('Combobox, constrained to its options', () => {
  it('renders a button rather than a native select, so the list is ours to style', () => {
    render(<Combobox value="tps" onChange={() => {}} options={OPTIONS} ariaLabel="Attribute" />)

    expect(control().tagName).toBe('BUTTON')
    expect(screen.queryByRole('listbox')).not.toBeNull()
    expect(document.querySelector('select')).toBeNull()
  })

  it('shows the label of the selected value, not the raw value', () => {
    const opts = [{ value: '__start__', label: 'Start Server' }]
    render(<Combobox value="__start__" onChange={() => {}} options={opts} />)

    expect(control().textContent).toContain('Start Server')
  })

  it('opens on ArrowDown and highlights the current value', () => {
    render(<Combobox value="players.max" onChange={() => {}} options={OPTIONS} />)

    expect(control().getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(control(), { key: 'ArrowDown' })

    expect(control().getAttribute('aria-expanded')).toBe('true')
    expect(options()[2].dataset.active).toBe('true')
  })

  it('moves the highlight with the arrows and commits on Enter', () => {
    const onChange = vi.fn()
    render(<Combobox value="tps" onChange={onChange} options={OPTIONS} />)

    fireEvent.keyDown(control(), { key: 'ArrowDown' })
    fireEvent.keyDown(control(), { key: 'ArrowDown' })
    fireEvent.keyDown(control(), { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('players.count')
    expect(control().getAttribute('aria-expanded')).toBe('false')
  })

  it('wraps the highlight at both ends', () => {
    render(<Combobox value="tps" onChange={() => {}} options={OPTIONS} />)

    fireEvent.keyDown(control(), { key: 'ArrowDown' })
    fireEvent.keyDown(control(), { key: 'ArrowUp' })
    expect(options()[3].dataset.active).toBe('true')
  })

  it('jumps the highlight by typeahead while open', () => {
    render(<Combobox value="tps" onChange={() => {}} options={OPTIONS} />)

    fireEvent.keyDown(control(), { key: 'ArrowDown' })
    fireEvent.keyDown(control(), { key: 's' })

    expect(options()[3].dataset.active).toBe('true')
  })

  // A native <select> changes value on typeahead without opening. Keeping that
  // means a closed control is still usable from the keyboard alone.
  it('changes the value by typeahead while closed', () => {
    const onChange = vi.fn()
    render(<Combobox value="tps" onChange={onChange} options={OPTIONS} />)

    fireEvent.keyDown(control(), { key: 's' })

    expect(onChange).toHaveBeenCalledWith('server.motd')
    expect(control().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape without committing the highlight', () => {
    const onChange = vi.fn()
    render(<Combobox value="tps" onChange={onChange} options={OPTIONS} />)

    fireEvent.keyDown(control(), { key: 'ArrowDown' })
    fireEvent.keyDown(control(), { key: 'ArrowDown' })
    fireEvent.keyDown(control(), { key: 'Escape' })

    expect(control().getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits on click', () => {
    const onChange = vi.fn()
    render(<Combobox value="tps" onChange={onChange} options={OPTIONS} />)

    fireEvent.click(control())
    fireEvent.click(screen.getByRole('option', { name: /server\.motd/ }))

    expect(onChange).toHaveBeenCalledWith('server.motd')
  })

  it('marks only the selected option aria-selected', () => {
    render(<Combobox value="players.max" onChange={() => {}} options={OPTIONS} />)

    fireEvent.click(control())
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ])
  })
})

describe('Combobox, accepting free text', () => {
  it('renders a text input so a value outside the presets can be typed', () => {
    render(<Combobox value="myValue" onChange={() => {}} options={OPTIONS} freeText />)

    expect(control().tagName).toBe('INPUT')
    expect((control() as HTMLInputElement).value).toBe('myValue')
  })

  it('reports every keystroke, including one that matches no preset', () => {
    const onChange = vi.fn()
    render(<Combobox value="" onChange={onChange} options={OPTIONS} freeText />)

    fireEvent.change(control(), { target: { value: 'custom.thing' } })

    expect(onChange).toHaveBeenCalledWith('custom.thing')
  })

  it('narrows the list as you type and says so when nothing matches', () => {
    const { rerender } = render(
      <Combobox value="" onChange={() => {}} options={OPTIONS} freeText />,
    )

    fireEvent.change(control(), { target: { value: 'players' } })
    rerender(<Combobox value="players" onChange={() => {}} options={OPTIONS} freeText />)
    expect(options()).toHaveLength(2)

    fireEvent.change(control(), { target: { value: 'zzz' } })
    rerender(<Combobox value="zzz" onChange={() => {}} options={OPTIONS} freeText />)
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matches')).not.toBeNull()
  })

  // Filtering is cleared on close, so picking a preset and reopening does not
  // leave the list narrowed to the single thing already chosen.
  it('shows the whole list again when reopened from the chevron', () => {
    const { rerender } = render(
      <Combobox value="" onChange={() => {}} options={OPTIONS} freeText ariaLabel="Attribute" />,
    )

    fireEvent.change(control(), { target: { value: 'tps' } })
    rerender(
      <Combobox value="tps" onChange={() => {}} options={OPTIONS} freeText ariaLabel="Attribute" />,
    )
    expect(options()).toHaveLength(1)

    const chevron = screen.getByRole('button', { name: /show presets/ })
    fireEvent.click(chevron) // closes
    fireEvent.click(chevron) // reopens, unfiltered
    expect(options()).toHaveLength(4)
  })

  it('commits a preset over the typed text when one is clicked', () => {
    const onChange = vi.fn()
    render(<Combobox value="ser" onChange={onChange} options={OPTIONS} freeText />)

    fireEvent.click(screen.getByRole('button', { name: /show presets/ }))
    fireEvent.click(screen.getByRole('option', { name: /server\.motd/ }))

    expect(onChange).toHaveBeenLastCalledWith('server.motd')
  })

  // The typed text is the value already; Enter on no highlight must not
  // silently replace it with whatever happened to be first in the list.
  it('keeps the typed text when Enter lands on no highlight', () => {
    const onChange = vi.fn()
    render(<Combobox value="custom" onChange={onChange} options={OPTIONS} freeText />)

    fireEvent.change(control(), { target: { value: 'custom' } })
    onChange.mockClear()
    fireEvent.keyDown(control(), { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
    expect(control().getAttribute('aria-expanded')).toBe('false')
  })
})

// ─── showOptionLabel: free text alongside values nobody should have to read ──
//
// The command field's lifecycle presets are sentinels (`__start__`) that
// execCommand switches on rather than sends, so the field has to name them
// while still storing them (#161). Free text is unaffected, and the raw value
// has to come back the instant the field is editable, or typing would append to
// a label and write that.

const CMD_OPTIONS = [
  { value: '__start__', label: 'Start Server' },
  { value: '__restart__', label: 'Restart Server' },
  { value: 'save-all', label: 'Save All' },
]

describe('Combobox, free text with labelled values', () => {
  it('shows a matched value by its label while the field is not being edited', () => {
    render(
      <Combobox
        value="__start__"
        onChange={() => {}}
        options={CMD_OPTIONS}
        ariaLabel="Command"
        freeText
        showOptionLabel
      />,
    )

    expect((control() as HTMLInputElement).value).toBe('Start Server')
  })

  it('reveals the value the label stands for as soon as the field is focused', () => {
    render(
      <Combobox
        value="__start__"
        onChange={() => {}}
        options={CMD_OPTIONS}
        ariaLabel="Command"
        freeText
        showOptionLabel
      />,
    )

    fireEvent.focus(control())
    expect((control() as HTMLInputElement).value).toBe('__start__')

    fireEvent.blur(control())
    expect((control() as HTMLInputElement).value).toBe('Start Server')
  })

  it('leaves text that matches no option exactly as typed', () => {
    render(
      <Combobox
        value="say hello"
        onChange={() => {}}
        options={CMD_OPTIONS}
        ariaLabel="Command"
        freeText
        showOptionLabel
      />,
    )

    expect((control() as HTMLInputElement).value).toBe('say hello')
  })

  it('types through to the raw value rather than appending to a label', () => {
    const onChange = vi.fn()
    render(
      <Combobox
        value="__start__"
        onChange={onChange}
        options={CMD_OPTIONS}
        ariaLabel="Command"
        freeText
        showOptionLabel
      />,
    )

    // Focus first, the way a user reaching for the field does: the input is
    // showing the raw value by then, so what they edit is what is stored.
    fireEvent.focus(control())
    fireEvent.change(control(), { target: { value: 'say hi' } })

    expect(onChange).toHaveBeenCalledWith('say hi')
  })

  it('stores the sentinel, not its label, when a preset is picked', () => {
    const onChange = vi.fn()
    render(
      <Combobox
        value=""
        onChange={onChange}
        options={CMD_OPTIONS}
        ariaLabel="Command"
        freeText
        showOptionLabel
      />,
    )

    fireEvent.keyDown(control(), { key: 'ArrowDown' })
    fireEvent.click(screen.getByText('Restart Server'))

    expect(onChange).toHaveBeenCalledWith('__restart__')
  })

  it('does not swap label for value without the opt-in, so @tps stays as stored', () => {
    // The attribute field's labels are a decorated spelling of its values, and
    // showing one for the other is the mismatch #162 is about.
    render(
      <Combobox
        value="tps"
        onChange={() => {}}
        options={[{ value: 'tps', label: '@tps' }]}
        ariaLabel="Attribute"
        freeText
      />,
    )

    expect((control() as HTMLInputElement).value).toBe('tps')
  })
})
