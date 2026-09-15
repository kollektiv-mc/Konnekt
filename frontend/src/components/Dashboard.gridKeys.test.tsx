import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Children, isValidElement, useState, type ReactNode } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import type { LayoutItem } from 'react-grid-layout'
import * as App from '../../wailsjs/go/main/App'
import { useTileStore } from '../stores/useTileStore'
import { useLayoutStore } from '../stores/useLayoutStore'
import { useServerConfigStore } from '../stores/useServerConfigStore'

// react-grid-layout matches a child to its layout entry **by the child's React
// key**, not by any prop. From the installed v2.2.4 source,
// `synchronizeLayoutWithChildren`:
//
//     const key = String(child.key);
//     const existingItem = initialLayout.find((l) => l.i === key);
//
// Dashboard's `mergedLayout` builds `i: tile.id`, so a grid child keyed
// anything else matches nothing, every tile falls to default placement, and
// `persistLayout` then writes the unmatched ids straight into the saved layout
// and the user's presets through `updateLayout`.
//
// That is a live hazard rather than a hypothetical one: #234 proposes keying the
// tile tree `${tile.id}:${serverId}` so a switch remounts tile state, and names
// this exact line as where to do it. The server scope belongs on TileComponent
// instead, one level in, which remounts the state without touching the identity
// the grid reads. This file is what stops the grid half being "fixed" back.
//
// globals: false in vite.config.ts, so cleanup is explicit.
afterEach(cleanup)

let captured: { keys: string[]; layout: readonly LayoutItem[] } | null = null

// Partially mocked: only the renderer is replaced, so the real compactor and
// the real `bottom` still run. `lib/gridSizing.ts` builds GRID_COMPACTOR from
// `verticalCompactor` at import time, and a wholesale mock breaks that before
// any test runs.
vi.mock('react-grid-layout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-grid-layout')>()),
  GridLayout: ({ children, layout }: { children: ReactNode; layout: readonly LayoutItem[] }) => {
    // Children.forEach, not Children.toArray: toArray clones each child with a
    // prefixed, escaped key ('.0:$console'), which is not what the grid sees.
    // synchronizeLayoutWithChildren uses forEach and reads child.key raw, so
    // reading it any other way would test the wrapper rather than the contract.
    const keys: string[] = []
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.key !== null) keys.push(String(child.key))
    })
    captured = { keys, layout }
    return <div data-testid="grid">{children}</div>
  },
  // jsdom reports every element as zero-width, and the real hook would hand
  // Dashboard a 0 it then divides by.
  useContainerWidth: () => [{ current: null }, 1200],
}))

vi.mock('react-grid-layout/css/styles.css', () => ({}))

// Two trivial tiles, so this file tests Dashboard's keying rather than eleven
// real tiles' data fetching.
//
// Each renders two things. `serverId` is the live prop, which updates on a
// switch whether or not anything remounts, so it proves nothing on its own.
// `firstSeen` is seeded once by useState and therefore only changes when the
// component is actually remounted, which is what the server-scoped key on
// TileComponent is for: it stands in for the state #234 lists as leaking, an
// open player popup, a restore confirm holding the previous server's backup,
// the mods browse panel.
function stubTile(name: string) {
  return function StubTile({ serverId }: { serverId: string }) {
    const [firstSeen] = useState(serverId)
    return (
      <span>
        {name}:{serverId}:{firstSeen}
      </span>
    )
  }
}

vi.mock('../tiles/registry', () => ({
  TILE_REGISTRY: [
    { id: 'console', label: 'Console', icon: () => null, component: stubTile('console') },
    { id: 'players', label: 'Players', icon: () => null, component: stubTile('players') },
  ],
}))

vi.mock('../tiles/TileWrapper', () => ({
  TileWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../wailsjs/go/main/App')
vi.mock('../../wailsjs/runtime/runtime')

// Imported after the mocks above, or Dashboard binds the real modules.
const { Dashboard } = await import('./Dashboard')

describe('Dashboard grid keys', () => {
  beforeEach(() => {
    captured = null
    // Dashboard hydrates both stores on mount. The automock resolves undefined,
    // which loadTiles then reads `.length` off inside its own try, so the throw
    // is caught and harmless but noisy. Resolving them properly keeps real
    // errors visible in this file's output.
    vi.mocked(App.GetActiveTiles).mockResolvedValue(['console', 'players'])
    vi.mocked(App.GetActiveLayout).mockResolvedValue('')
    vi.mocked(App.GetLayoutPresets).mockResolvedValue([])
    useTileStore.setState({ activeTileIds: ['console', 'players'] })
    useLayoutStore.setState({
      currentLayout: [
        { i: 'console', x: 0, y: 0, w: 4, h: 4 },
        { i: 'players', x: 4, y: 0, w: 4, h: 4 },
      ] as LayoutItem[],
    })
    useServerConfigStore.setState({ activeId: 'srv1' })
  })

  // Guards the premise. If the mock ever stops receiving children, every
  // assertion below passes over an empty list and this file tests nothing.
  it('renders a child per active tile', () => {
    render(<Dashboard />)
    expect(captured?.keys).toHaveLength(2)
  })

  it('keys every grid child by the bare tile id', () => {
    render(<Dashboard />)
    expect(captured!.keys.sort()).toEqual(['console', 'players'])
  })

  // The contract itself, stated the way react-grid-layout applies it.
  it('gives every grid child a key that matches a layout item id', () => {
    render(<Dashboard />)
    const ids = new Set(captured!.layout.map((l) => l.i))
    for (const key of captured!.keys) {
      expect(ids.has(key)).toBe(true)
    }
  })

  // The regression this file exists for: a server switch must not change the
  // identity the grid reads, or the saved layout is discarded and overwritten.
  it('keeps the same grid keys across a server switch', () => {
    render(<Dashboard />)
    const before = captured!.keys.sort()

    act(() => {
      useServerConfigStore.setState({ activeId: 'srv2' })
    })

    expect(captured!.keys.sort()).toEqual(before)
    const ids = new Set(captured!.layout.map((l) => l.i))
    for (const key of captured!.keys) {
      expect(ids.has(key)).toBe(true)
    }
  })

  // The other half: the tile's own subtree carries the state that must not
  // survive a switch, so that subtree does get the server-scoped key.
  //
  // Asserted through firstSeen, not through the serverId prop. The prop updates
  // on a switch with or without a key, so a test reading it would pass against
  // the very bug this is here to catch.
  it('remounts a tile on a server switch, discarding its state', () => {
    const { getByText } = render(<Dashboard />)
    expect(getByText('console:srv1:srv1')).toBeTruthy()

    act(() => {
      useServerConfigStore.setState({ activeId: 'srv2' })
    })

    // firstSeen is srv2, so this is a fresh component, not the old one with a
    // new prop. Were the key missing it would read 'console:srv2:srv1'.
    expect(getByText('console:srv2:srv2')).toBeTruthy()
  })
})
