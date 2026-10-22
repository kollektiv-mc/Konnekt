import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { placeFlyout } from '../../lib/flyoutPlacement'
import { Flyout } from './Flyout'

afterEach(cleanup)

const viewport = { w: 1000, h: 600 }
const size = { w: 180, h: 120 }

describe('placeFlyout', () => {
  it('sits just right of the anchor, level with its top', () => {
    const at = placeFlyout({ left: 100, right: 300, top: 200 }, size, viewport)
    expect(at).toEqual({ x: 304, y: 200, side: 'right' })
  })

  it('flips to the left of the anchor when the right has no room', () => {
    const at = placeFlyout({ left: 700, right: 900, top: 200 }, size, viewport)
    expect(at.side).toBe('left')
    expect(at.x).toBe(700 - 4 - size.w)
  })

  it('clamps into the window when neither side has room', () => {
    const narrow = { w: 300, h: 600 }
    const at = placeFlyout({ left: 40, right: 260, top: 200 }, size, narrow)
    expect(at.x).toBeGreaterThanOrEqual(8)
    expect(at.x + size.w).toBeLessThanOrEqual(narrow.w - 8)
  })

  it('slides a tall one up rather than off the bottom, and down from the top', () => {
    const low = placeFlyout({ left: 100, right: 300, top: 580 }, size, viewport)
    expect(low.y + size.h).toBeLessThanOrEqual(viewport.h - 8)
    const high = placeFlyout({ left: 100, right: 300, top: -30 }, size, viewport)
    expect(high.y).toBe(8)
  })
})

describe('Flyout', () => {
  it('portals a fixed menu to the body, marked as a menu layer', () => {
    const { container } = render(
      <Flyout anchor={{ left: 0, right: 10, top: 0 }} label="Sub" className="w-40">
        <button type="button">one</button>
      </Flyout>,
    )
    const menu = screen.getByRole('menu', { name: 'Sub' })
    expect(container.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
    expect(menu.className).toContain('fixed')
    expect(menu.hasAttribute('data-menu-layer')).toBe(true)
  })

  it('moves focus in when asked, and walks its rows with the arrows', () => {
    render(
      <Flyout anchor={{ left: 0, right: 10, top: 0 }} label="Sub" className="" focusOnOpen>
        <button type="button">one</button>
        <button type="button" disabled>
          skipped
        </button>
        <button type="button">two</button>
      </Flyout>,
    )
    const one = screen.getByRole('button', { name: 'one' })
    const two = screen.getByRole('button', { name: 'two' })
    expect(document.activeElement).toBe(one)
    fireEvent.keyDown(one, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(two)
    fireEvent.keyDown(two, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(one)
    fireEvent.keyDown(one, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(two)
  })

  it('is out of the accessibility tree while it leaves', () => {
    render(
      <Flyout anchor={{ left: 0, right: 10, top: 0 }} label="Sub" className="" leaving>
        <button type="button">one</button>
      </Flyout>,
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
