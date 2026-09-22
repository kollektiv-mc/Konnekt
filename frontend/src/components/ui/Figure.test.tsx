import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Figure, Headline } from './Figure'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

describe('Figure', () => {
  it('sets the value large by default and small on request', () => {
    render(<Figure label="TPS" value="19.8" />)
    expect(screen.getByText('19.8').className).toContain('text-xl')
    cleanup()
    render(<Figure label="TPS" value="19.8" size="sm" />)
    expect(screen.getByText('19.8').className).toContain('text-sm')
  })

  it('keeps the value on the mono stack whatever tone it is given', () => {
    render(<Figure label="TPS" value="12.1" valueClass="text-warning" />)
    const value = screen.getByText('12.1')
    expect(value.className).toContain('font-mono')
    expect(value.className).toContain('text-warning')
  })
})

describe('Headline', () => {
  it('puts the unit after the value and the aside at the far end', () => {
    render(<Headline value="3 / 4" unit="armed" aside="next in 46m" />)
    expect(screen.getByText('3 / 4').className).toContain('font-mono')
    expect(screen.getByText('armed')).toBeTruthy()
    expect(screen.getByText('next in 46m').className).toContain('ml-auto')
  })

  it('renders no aside slot when none is given', () => {
    const { container } = render(<Headline value="3" unit="worlds" />)
    expect(container.querySelectorAll('.ml-auto')).toHaveLength(0)
  })
})
