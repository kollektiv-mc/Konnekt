import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TILE_REGISTRY } from '../tiles/registry'
import type { TileDefinition } from '../types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useTileStore } from '../stores/useTileStore'
import { Blocks } from '../lib/icons'
import { TileCrate } from './TileCrate'

// globals: false in vite.config.ts, so cleanup is explicit.
afterEach(cleanup)

// The navbar splits the crate in two: "Widgets" is the tiles that never go
// fullscreen, "Tiles" the ones that do. That split went one-sided when the
// Overview tile became maximizable (#211) — `stats` was the only widget — and an
// empty card with a chevron opening onto nothing is worse than no card.
describe('TileCrate sections', () => {
  beforeEach(() => {
    useTileStore.setState({ activeTileIds: [] })
    // Both open, so a missing section is a missing section rather than a
    // collapsed one.
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, navClosedSections: {}, crateOrder: [] },
    }))
  })

  it('hides Widgets while no registered tile is one', () => {
    // Guards the premise: this case means nothing if something is registered
    // without `maximizable` and the section should have rendered after all.
    expect(TILE_REGISTRY.every((t) => t.maximizable)).toBe(true)

    render(<TileCrate />)

    expect(screen.queryByText('Widgets')).toBeNull()
    expect(screen.getByText('Tiles')).toBeTruthy()
  })

  // Registering one is the whole contract — no list to add it to, no flag to
  // set. Written against the registry rather than a hardcoded roster so it
  // keeps meaning something once a widget exists for real.
  it('brings Widgets back as soon as a non-maximizable tile is registered', () => {
    const widget: TileDefinition = {
      id: 'test-widget',
      label: 'Test Widget',
      icon: Blocks,
      component: () => null,
    }
    TILE_REGISTRY.push(widget)

    try {
      render(<TileCrate />)

      expect(screen.getByText('Widgets')).toBeTruthy()
      expect(screen.getByText('Test Widget')).toBeTruthy()
      expect(screen.getByText('Tiles')).toBeTruthy()
    } finally {
      TILE_REGISTRY.pop()
    }
  })
})
