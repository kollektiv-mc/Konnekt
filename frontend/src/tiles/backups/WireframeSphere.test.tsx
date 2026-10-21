import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { WireframeSphere } from './WireframeSphere'

afterEach(cleanup)

const linework = (c: HTMLElement) => c.querySelector('g[stroke]') as SVGGElement

describe('WireframeSphere', () => {
  it('draws its lines at the strokeWidth it is given', () => {
    const { container } = render(<WireframeSphere size={100} strokeWidth={4.8} />)
    expect(linework(container).getAttribute('stroke-width')).toBe('4.8')
  })

  it('keeps the 1.5 default for callers that do not scale it', () => {
    const { container } = render(<WireframeSphere size={100} />)
    expect(linework(container).getAttribute('stroke-width')).toBe('1.5')
  })

  it('insets the silhouette by half a stroke so it is not clipped', () => {
    const { container } = render(<WireframeSphere size={100} strokeWidth={4} />)
    const silhouette = linework(container).querySelector('circle') as SVGCircleElement
    expect(silhouette.getAttribute('r')).toBe('48')
  })
})
