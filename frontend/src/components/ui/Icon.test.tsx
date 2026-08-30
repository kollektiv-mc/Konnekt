import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon, ICON_STROKE_PX } from './Icon'
import { Database } from '../../lib/icons'

const svgOf = (container: HTMLElement) => {
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('Icon rendered no <svg>')
  return svg
}

describe('Icon', () => {
  it('sizes through the spacing scale, not an inline width', () => {
    const { container } = render(<Icon icon={Database} size="sm" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('class')).toContain('size-3.5')
    expect(svg.getAttribute('style')).toBeNull()
    // The class paints; the attribute only feeds lucide's absolute-stroke
    // maths. They come from one table entry, and a stroke computed against a
    // size the icon is not actually drawn at is the failure this catches.
    expect(svg.getAttribute('width')).toBe('14')
  })

  it('defaults to md when no size is given', () => {
    const { container } = render(<Icon icon={Database} />)
    expect(svgOf(container).getAttribute('class')).toContain('size-4')
  })

  // The point of the conversion: one screen weight, not one viewBox number.
  // A fixed strokeWidth would draw 1.33px at md and 1.17px at sm.
  it('draws ICON_STROKE_PX on screen at every size', () => {
    for (const [size, px] of [
      ['xs', 12],
      ['sm', 14],
      ['md', 16],
      ['lg', 20],
    ] as const) {
      const { container } = render(<Icon icon={Database} size={size} />)
      const units = Number(svgOf(container).getAttribute('stroke-width'))
      // units are on lucide's 24 grid; what lands on screen is units * px / 24
      expect((units * px) / 24).toBeCloseTo(ICON_STROKE_PX, 2)
    }
  })

  it('honours a per-call stroke override, still in screen px', () => {
    const { container } = render(<Icon icon={Database} size="md" strokePx={2} />)
    const units = Number(svgOf(container).getAttribute('stroke-width'))
    expect((units * 16) / 24).toBeCloseTo(2, 2)
  })

  it('inherits colour rather than setting one, so a text-* token themes it', () => {
    const { container } = render(<Icon icon={Database} className="text-danger" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('class')).toContain('text-danger')
  })

  it('is decorative unless given a label', () => {
    const { container } = render(<Icon icon={Database} />)
    const svg = svgOf(container)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('role')).toBeNull()
  })

  it('announces itself when it is the only carrier of its meaning', () => {
    const { container } = render(<Icon icon={Database} label="Completed" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('aria-hidden')).toBeNull()
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Completed')
  })
})
