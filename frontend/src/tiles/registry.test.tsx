import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TILE_REGISTRY } from './registry'
import { Icon } from '../components/ui/Icon'

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
})
