import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TILE_REGISTRY } from '../registry'
import { useUiStore } from '../../stores/useUiStore'
import { OverviewTile } from './index'

// globals: false in vite.config.ts, so cleanup is explicit.
afterEach(cleanup)

// The panel mounts every other tile's summary, several of which reach for the
// Wails bindings on mount. There is no bridge here, and that is fine — the
// point of these cases is the panel's own composition, not each summary's
// behaviour. `tiles/noBridge.test.tsx` is what proves the summaries survive a
// missing bridge, and it covers this panel for free: it renders every registry
// tile maximized, which is exactly this.
describe('OverviewPanel', () => {
  beforeEach(() => {
    useUiStore.setState({ maximizeRequest: null })
  })

  it('renders one card per tile that registers a summary', () => {
    const withSummary = TILE_REGISTRY.filter((t) => t.summary)
    // Guards the premise: if `summary` were dropped from every entry, every
    // assertion below would pass against an empty panel.
    expect(withSummary.length).toBeGreaterThan(5)

    render(<OverviewTile serverId="srv1" maximized />)

    for (const tile of withSummary) {
      expect(screen.getAllByText(tile.label).length).toBeGreaterThan(0)
    }
  })

  it('leaves out the tiles that register no summary', () => {
    render(<OverviewTile serverId="srv1" maximized />)

    // A live log stream and a grid of command buttons summarise nothing, so
    // neither gets a card — see their entries in registry.ts.
    expect(screen.queryByText('Console')).toBeNull()
    expect(screen.queryByText('Commands')).toBeNull()
  })

  it('does not render itself, which would recurse', () => {
    const overview = TILE_REGISTRY.find((t) => t.id === 'stats')
    expect(overview?.summary).toBeUndefined()
  })

  it('asks Dashboard to open the owning tile when a card header is clicked', () => {
    render(<OverviewTile serverId="srv1" maximized />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Backups' }))

    expect(useUiStore.getState().maximizeRequest).toEqual({ id: 'backups', rect: null })
  })

  it('renders the vitals rather than the roll-up when the tile is not maximized', () => {
    render(<OverviewTile serverId="srv1" />)

    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.queryByText('Backups')).toBeNull()
  })

  // The panel is the one place that mounts ten independent tile subtrees side
  // by side, so a single one throwing must not take the rest with it — before
  // the per-card boundary, `main.tsx`'s app-level one would have replaced the
  // whole window with "render error".
  it('contains a summary that throws to its own card', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = TILE_REGISTRY.find((t) => t.id === 'backups')!
    const original = broken.summary
    broken.summary = () => {
      throw new Error('summary blew up')
    }

    try {
      render(<OverviewTile serverId="srv1" maximized />)
      expect(screen.getByText('summary unavailable')).toBeTruthy()
      // The neighbours are still there.
      expect(screen.getByText('Worlds')).toBeTruthy()
    } finally {
      broken.summary = original
      boom.mockRestore()
    }
  })
})
