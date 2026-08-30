import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { TILE_REGISTRY } from './registry'
import { ServerRow } from '../components/ServerRow'
import { ServerDetail } from '../components/ServerManager/ServerDetail'
import { GetStatsHistory } from '../../wailsjs/go/main/App'
import type { ServerConfig } from '../types'

// The browser-only `frontend-dev` preset, reproduced.
//
// There is deliberately no `vi.mock` of the Wails bindings in this file. The
// generated bindings dereference `window['go']['main']['App']` synchronously
// (frontend/wailsjs/go/main/App.js), so with no bridge they throw `TypeError`
// *before a promise exists* — a trailing `.catch()` is attached to a call that
// never returned, and in a `useEffect` body the throw escapes to the app-level
// ErrorBoundary and replaces the whole dashboard with "render error".
//
// jsdom has no `window.go`, so the real bindings fail here exactly as they do
// in the preset. An automock would return `undefined` instead of throwing,
// which is the one thing that would make every case below pass vacuously —
// that is why this file mocks nothing. See lib/ipc.ts, and #184.
//
// globals: false in vite.config.ts, so cleanup is explicit.
afterEach(cleanup)

const CONFIG: ServerConfig = {
  id: 'srv1',
  name: 'Test',
  jarPath: '',
  jvmArgs: [],
  workingDir: '',
  mcVersion: '',
  loader: '',
  loaderVersion: '',
}

describe('no Wails bridge', () => {
  // Guards the premise. If something ever puts a `go` object on window — a
  // setup file, a stray global mock — every assertion below would still pass
  // while testing nothing at all.
  it('has no window.go, so the bindings really do throw', () => {
    expect('go' in window).toBe(false)
    // The real generated binding, not a hand-written window path: this is the
    // module every call site below reaches, and it must throw rather than
    // reject for the rest of this file to be testing anything.
    expect(() => GetStatsHistory('srv1')).toThrow(TypeError)
  })

  it.each(TILE_REGISTRY.map((t) => [t.id, t] as const))('renders the %s tile', (_id, tile) => {
    const Tile = tile.component
    expect(() => render(<Tile serverId="srv1" />)).not.toThrow()
  })

  it.each(TILE_REGISTRY.map((t) => [t.id, t] as const))(
    'renders the %s tile maximized',
    (_id, tile) => {
      const Tile = tile.component
      expect(() => render(<Tile serverId="srv1" maximized />)).not.toThrow()
    },
  )

  // Not tiles, but the same shape: a binding read from an effect (ServerDetail)
  // and from a hover handler (ServerRow).
  it('renders a sidebar server row and survives the hover that primes its summary', () => {
    const { container } = render(
      <ServerRow cfg={CONFIG} active={false} onSelect={() => {}} onEdit={() => {}} />,
    )
    const row = container.firstElementChild as HTMLElement
    expect(row).toBeTruthy()
    expect(() => fireEvent.mouseEnter(row)).not.toThrow()
  })

  it('renders the server manager detail panel', () => {
    expect(() => render(<ServerDetail config={CONFIG} />)).not.toThrow()
  })
})
