import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { encodeQr, QUIET_ZONE } from '../../lib/qr'
import { QrCode } from './QrCode'

afterEach(cleanup)

const ADDRESS = 'https://quiet-fox-lamp-river.trycloudflare.com'

/** The matrix a path draws, read back from its `M x y h w v1 h-w z` rectangles. */
function matrixOf(path: string, modules: number): boolean[][] {
  const grid = Array.from({ length: modules }, () => Array.from({ length: modules }, () => false))
  for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(w); i++)
      grid[Number(y) - QUIET_ZONE][Number(x) - QUIET_ZONE + i] = true
  }
  return grid
}

describe('QrCode', () => {
  it('is an image named for the address it encodes', () => {
    render(<QrCode text={ADDRESS} />)
    expect(screen.getByRole('img', { name: `QR code for ${ADDRESS}` })).toBeTruthy()
  })

  it('draws exactly the encoder matrix, inside a quiet zone of four modules', () => {
    const { container } = render(<QrCode text={ADDRESS} />)
    const matrix = encodeQr(ADDRESS)
    const svg = container.querySelector('svg')
    const total = matrix.length + QUIET_ZONE * 2
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${total} ${total}`)
    const path = container.querySelector('path')?.getAttribute('d') ?? ''
    expect(matrixOf(path, matrix.length)).toEqual(matrix)
  })

  it('is dark modules on a light backing, whatever the theme, with no inline style', () => {
    const { container } = render(<QrCode text={ADDRESS} />)
    expect(container.querySelector('rect')?.getAttribute('class')).toBe('fill-white')
    expect(container.querySelector('path')?.getAttribute('class')).toBe('fill-black')
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('draws nothing for text too long to encode', () => {
    const { container } = render(<QrCode text={'x'.repeat(214)} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('takes a size from its caller', () => {
    const { container } = render(<QrCode text={ADDRESS} className="size-24" />)
    const classes = container.querySelector('svg')?.getAttribute('class') ?? ''
    expect(classes).toContain('size-24')
    expect(classes).not.toContain('size-44')
  })
})
