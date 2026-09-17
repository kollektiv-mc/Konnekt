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

  describe('as a textarea', () => {
    const PRESETS = [
      { value: '__start__', label: 'Start Server' },
      { value: 'save-all', label: 'Save All' },
    ]

    it('renders a textarea so a long command still wraps', () => {
      render(<Combobox value="say hi" onChange={() => {}} options={PRESETS} freeText multiline />)

      expect(control().tagName).toBe('TEXTAREA')
    })

    // A closed textarea owns its keys: hijacking Enter would make a newline
    // impossible, and hijacking the arrows would strand the caret.
    it('leaves Enter and the arrows to the textarea while the list is closed', () => {
      const onChange = vi.fn()
      render(<Combobox value="say hi" onChange={onChange} options={PRESETS} freeText multiline />)

      fireEvent.keyDown(control(), { key: 'Enter' })
      fireEvent.keyDown(control(), { key: 'ArrowDown' })

      expect(control().getAttribute('aria-expanded')).toBe('false')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('opens on Alt+ArrowDown, the one chord it does claim', () => {
      render(<Combobox value="" onChange={() => {}} options={PRESETS} freeText multiline />)

      fireEvent.keyDown(control(), { key: 'ArrowDown', altKey: true })
      expect(control().getAttribute('aria-expanded')).toBe('true')
    })

    it('drives the list with the arrows and Enter once it is open', () => {
      const onChange = vi.fn()
      render(<Combobox value="" onChange={onChange} options={PRESETS} freeText multiline />)

      fireEvent.keyDown(control(), { key: 'ArrowDown', altKey: true })
      fireEvent.keyDown(control(), { key: 'ArrowDown' })
      fireEvent.keyDown(control(), { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith('save-all')
      expect(control().getAttribute('aria-expanded')).toBe('false')
    })

    // Typing must not pop the list open over the text being written; only the
    // chevron and the chord do that.
    it('does not open itself on a keystroke', () => {
      render(<Combobox value="" onChange={() => {}} options={PRESETS} freeText multiline />)

      fireEvent.change(control(), { target: { value: 'say' } })
      expect(control().getAttribute('aria-expanded')).toBe('false')
    })
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
