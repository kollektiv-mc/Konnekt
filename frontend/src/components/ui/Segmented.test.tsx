import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Segmented } from './Segmented'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup.
afterEach(cleanup)

const OPTIONS = [
  { value: 'a' as const, label: 'Alpha' },
  { value: 'b' as const, label: 'Beta' },
  { value: 'c' as const, label: 'Gamma', disabled: true },
]

const seg = (name: string) => screen.getByRole('button', { name })

describe('Segmented', () => {
  it('offers hover to the segments that are neither active nor disabled', () => {
    render(<Segmented options={OPTIONS} value="a" onChange={() => {}} />)

    expect(seg('Alpha').className).toContain('bg-accent')
    expect(seg('Alpha').className).not.toContain('hover:')
    expect(seg('Beta').className).toContain('hover:bg-hover')
    expect(seg('Beta').className).toContain('hover:text-text-primary')
  })

  it('renders a disabled option unclickable, with no hover to imply otherwise', () => {
    const onChange = vi.fn()
    render(<Segmented options={OPTIONS} value="a" onChange={onChange} />)

    const disabled = seg('Gamma')
    expect(disabled.hasAttribute('disabled')).toBe(true)
    expect(disabled.className).not.toContain('hover:')

    fireEvent.click(disabled)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still selects an enabled option', () => {
    const onChange = vi.fn()
    render(<Segmented options={OPTIONS} value="a" onChange={onChange} />)

    fireEvent.click(seg('Beta'))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  // The slide variant's accent pill is absolutely positioned *under* the
  // buttons, so a background on a hovered segment would occlude it as the pill
  // travels past. It takes the text half of the hover only.
  it('keeps the slide variant transparent so its pill stays visible', () => {
    render(<Segmented options={OPTIONS} value="a" onChange={() => {}} slide />)

    expect(seg('Beta').className).toContain('hover:text-text-primary')
    expect(seg('Beta').className).not.toContain('hover:bg-hover')
    expect(seg('Beta').className).toContain('bg-transparent')
  })

  it('disables an option in the slide variant too', () => {
    const onChange = vi.fn()
    render(<Segmented options={OPTIONS} value="a" onChange={onChange} slide />)

    expect(seg('Gamma').hasAttribute('disabled')).toBe(true)
    fireEvent.click(seg('Gamma'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
