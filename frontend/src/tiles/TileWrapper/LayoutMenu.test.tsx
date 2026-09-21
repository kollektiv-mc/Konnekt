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
  it('opens at the pointer with a Layout entry', async () => {
    mount()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(header(), { clientX: 120, clientY: 60 })
    const menu = await screen.findByRole('menu', { name: 'Tile' })
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('60px')
    expect(screen.getByRole('menuitem', { name: /Layout/ })).toBeTruthy()
  })

  it('reports the layout chosen from the fly-out and marks the current one', async () => {
    const onSetLayout = mount({ layout: 'detailed' })
    fireEvent.contextMenu(header(), { clientX: 10, clientY: 10 })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Layout/ }))
    const current = await screen.findByRole('menuitemradio', { name: /Detailed/ })
    expect(current.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Expanded/ }))
    expect(onSetLayout).toHaveBeenCalledWith('stats', 'expanded')
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
