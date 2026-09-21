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

describe('the tile header layout menu', () => {
  it('opens on right-click and reports the chosen layout', async () => {
    const onSetLayout = mount()
    const header = screen.getByText('Overview').closest('.drag-handle')
    expect(header).not.toBeNull()
    // Nothing is mounted until the first right-click: the menu is a lazy chunk.
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(header as Element)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Large/ }))

    expect(onSetLayout).toHaveBeenCalledWith('stats', 'large')
  })

  it('marks the current layout as checked', async () => {
    mount({ layout: 'compact' })
    fireEvent.contextMenu(screen.getByText('Overview').closest('.drag-handle') as Element)
    expect(
      (await screen.findByRole('menuitemradio', { name: /Compact/ })).getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      screen.getByRole('menuitemradio', { name: /Default/ }).getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('offers no menu to a tile without layouts, nor to the maximized copy', async () => {
    mount({ layout: undefined, onSetLayout: undefined })
    fireEvent.contextMenu(screen.getByText('Overview').closest('.drag-handle') as Element)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('menu')).toBeNull()
    cleanup()
    mount({ maximized: true })
    fireEvent.contextMenu(screen.getByText('Overview').closest('.drag-handle') as Element)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
