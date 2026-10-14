import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NumberInput } from './widgets'
import type { ConfigField } from './inferType'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const field: ConfigField = {
  path: ['server', 'serverId'],
  label: 'Server Id',
  type: 'number',
  value: -1534567890,
}

function setAndBlur(value: string) {
  const input = screen.getByRole('spinbutton')
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
  return input as HTMLInputElement
}

describe('NumberInput', () => {
  it('commits a typed number', () => {
    const onChange = vi.fn()
    render(<NumberInput field={field} onChange={onChange} />)
    setAndBlur('-7')
    expect(onChange).toHaveBeenCalledWith(-7)
  })

  // A type="number" input reports '' for an emptied field and for text it
  // cannot read, and Number('') is 0, so both used to save the value as 0.
  it('restores the value instead of committing 0 for an empty field', () => {
    const onChange = vi.fn()
    render(<NumberInput field={field} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })
    const input = setAndBlur('')
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('-1534567890')
  })
})
