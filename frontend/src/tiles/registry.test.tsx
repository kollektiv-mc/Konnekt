import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TILE_REGISTRY } from './registry'
import { Icon } from '../components/ui/Icon'
import { ALL_TILE_IDS } from '../lib/constants'

// Renamed from registry.test.ts when `icon` became a component: asserting an
// icon renders means rendering JSX, which needs the .tsx extension.
describe('TILE_REGISTRY', () => {
  it('has no duplicate ids', () => {
    const ids = TILE_REGISTRY.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every tile its own icon', () => {
    const icons = TILE_REGISTRY.map((t) => t.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  // The crate and every tile header call `icon` as a component. A string
  // typechecks nowhere now, but a tile registered with a missing or non-icon
  // value past a loosened type would only fail at render — in the sidebar, on
  // every launch.
  it.each(TILE_REGISTRY.map((t) => [t.id, t] as const))('renders the %s icon', (_id, tile) => {
    const { container } = render(<Icon icon={tile.icon} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  // A summary is rendered by the Overview panel as a component. A tile that
  // registered something else (a string, a stale export) would typecheck
  // nowhere now, but past a loosened type it would only fail at render — and
  // only once someone maximized Overview.
  it('registers every summary as a component', () => {
    for (const tile of TILE_REGISTRY) {
      if (tile.summary === undefined) continue
      expect(typeof tile.summary).toBe('function')
    }
  })

  // The Overview tile's id is 'stats' on purpose (#211): it is persisted
  // verbatim in active_tiles.json, layout_presets.json and active_layout.json,
  // so renaming it drops the tile from every existing install's canvas and
  // leaves a dead entry in every saved layout preset. An innocent-looking
  // rename has no other symptom, which is why it gets a test rather than only
  // the comment in registry.ts.
  it('keeps the Overview tile on the persisted id', () => {
    const overview = TILE_REGISTRY.find((t) => t.label === 'Overview')
    expect(overview?.id).toBe('stats')
    expect(ALL_TILE_IDS).toContain('stats')
  })
})
