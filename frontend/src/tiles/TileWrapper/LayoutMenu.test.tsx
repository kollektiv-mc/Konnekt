import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TileWrapper } from './index'
import { LayoutDashboard } from '../../lib/icons'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

function mount(props: Partial<Parameters<typeof TileWrapper>[0]> = {}) {
  const onSetLayout = vi.fn()
  render(
    <TileWrapper
      id="stats"
      label="Overview"
      icon={LayoutDashboard}
      onRemove={() => {}}
      maximizable
      layout="default"
      onSetLayout={onSetLayout}
      {...props}
    >
      <div>face</div>
    </TileWrapper>,
  )
  return onSetLayout
}

const header = () => screen.getByText('Overview').closest('.drag-handle') as Element

describe('the tile header context menu', () => {
  it('opens at the pointer with a Layout entry whose fly-out waits for a hover', () => {
    mount()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(header(), { clientX: 120, clientY: 60 })
    const menu = screen.getByRole('menu', { name: 'Tile' })
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('60px')
    expect(screen.getByRole('menuitem', { name: /Layout/ })).toBeTruthy()
    expect(screen.queryByRole('menu', { name: 'Layout' })).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Layout/ }))
    expect(screen.getByRole('menu', { name: 'Layout' })).toBeTruthy()
  })

  it('reports the layout chosen from the fly-out and marks the current one', () => {
    const onSetLayout = mount({ layout: 'detailed' })
    fireEvent.contextMenu(header(), { clientX: 10, clientY: 10 })
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Layout/ }))
    const current = screen.getByRole('menuitemradio', { name: /Detailed/ })
    expect(current.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Expanded/ }))
    expect(onSetLayout).toHaveBeenCalledWith('stats', 'expanded')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // The menu is a portal and React bubbles its events to the header that
  // opened it, which used to reopen the menu at the new pointer position.
  it('closes on a right-click on its backdrop instead of moving', async () => {
    mount()
    fireEvent.contextMenu(header(), { clientX: 100, clientY: 50 })
    const menu = screen.getByRole('menu', { name: 'Tile' })
    fireEvent.contextMenu(menu.previousElementSibling as Element, { clientX: 400, clientY: 300 })
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers no menu to a tile without layouts, nor to the maximized copy', async () => {
    mount({ layout: undefined, onSetLayout: undefined })
    fireEvent.contextMenu(header(), { clientX: 10, clientY: 10 })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('menu')).toBeNull()
    cleanup()
    mount({ maximized: true })
    fireEvent.contextMenu(header(), { clientX: 10, clientY: 10 })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
