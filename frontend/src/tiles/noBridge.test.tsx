import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { TILE_REGISTRY } from './registry'
import { ServerRow } from '../components/ServerRow'
import { ServerDetail } from '../components/ServerManager/ServerDetail'
import { TitleBar } from '../components/TitleBar'
import { QuickCommandsPanel } from '../components/QuickCommandsPanel'
import { LayoutPresets } from '../components/LayoutPresets'
import { PlayerDetailPopup } from './players/PlayerDetailPopup'
import { useCommandsStore } from '../stores/useCommandsStore'
import { useLayoutStore } from '../stores/useLayoutStore'
import { GetStatsHistory } from '../../wailsjs/go/main/App'
import { WindowMinimise } from '../../wailsjs/runtime/runtime'
import type { CommandButton } from '../stores/useCommandsStore'
import type { Player, ServerConfig } from '../types'

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

  // The title bar is the one place that calls the *runtime* bindings rather
  // than the generated Go ones, and they fail the same way for the same reason:
  // `window.runtime` is as absent here as `window.go`. Worth its own case
  // because a title bar that threw would take the whole window's chrome with
  // it, and because pressing Close in the preview must be a no-op rather than
  // an error — there is no window to quit.
  it('renders the title bar, and its window controls no-op', () => {
    expect('runtime' in window).toBe(false)
    expect(() => WindowMinimise()).toThrow(TypeError)

    const { getByRole } = render(<TitleBar onOpenSettings={() => {}} />)
    expect(() => fireEvent.click(getByRole('button', { name: 'Minimize window' }))).not.toThrow()
    expect(() => fireEvent.click(getByRole('button', { name: 'Close window' }))).not.toThrow()
  })
})

// Everything above reaches a binding by mounting. These reach one by clicking,
// which is the rest of #185: a write called from an event handler with no
// bridge throws inside React's event dispatch. React reports that through
// window's `error` event rather than letting it escape `fireEvent`, so a plain
// `not.toThrow()` around the click passes vacuously; this collects what React
// reports instead. The `async` handler is the other shape: the throw rejects
// the handler's own promise, which nobody awaits, and the only visible sign is
// that the statements after the call never run. Those cases assert on what
// should have happened next.
function clickCollectingErrors(el: HTMLElement): unknown[] {
  const caught: unknown[] = []
  const onError = (e: ErrorEvent) => {
    caught.push(e.error ?? e.message)
    e.preventDefault()
  }
  window.addEventListener('error', onError)
  try {
    fireEvent.click(el)
  } finally {
    window.removeEventListener('error', onError)
  }
  return caught
}

const PLAYER = {
  name: 'Korbin',
  uuid: 'uuid-korbin',
  online: true,
  ip: '192.168.1.52',
  lastOnline: 0,
  opLevel: 0,
  whitelisted: true,
  banned: false,
  banReason: '',
  primaryGroup: 'member',
  groups: [],
} as unknown as Player

// The `vi.fn()` spies below stand in for a parent component's callbacks, not
// for a binding: the bindings stay real and bridgeless, as above.
describe('no Wails bridge, from a click', () => {
  it('sends a quick command without an error escaping the handler', () => {
    useCommandsStore.setState({
      items: [{ id: '1', label: 'Kit', kind: 'cmd', value: 'give @p stone' } as CommandButton],
      hydrated: true,
      loading: false,
      error: null,
    })
    render(<QuickCommandsPanel serverId="srv1" />)
    expect(clickCollectingErrors(screen.getByRole('button', { name: 'Kit' }))).toEqual([])
  })

  // handleReset writes every default preset, then reloads and selects
  // 'Default'. With the write throwing, the reload and the selection never
  // ran and the handler's promise rejected with nobody to catch it.
  it('resets the layout presets to the defaults', async () => {
    useLayoutStore.setState({
      presets: [{ name: 'Mine', layout: '[]' }],
      activePresetName: 'Mine',
      currentLayout: [],
      error: null,
    })
    render(<LayoutPresets />)
    fireEvent.click(screen.getByRole('button', { name: '↺ Reset to defaults' }))
    fireEvent.click(screen.getByRole('button', { name: '↺ Confirm reset' }))
    await waitFor(() => expect(useLayoutStore.getState().activePresetName).toBe('Default'))
  })

  it('pardons a banned player and reports the mutation', async () => {
    const onMutated = vi.fn()
    render(
      <PlayerDetailPopup
        player={{ ...PLAYER, online: false, banned: true }}
        serverId="srv1"
        onClose={() => {}}
        onMutated={onMutated}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'pardon' }))
    await waitFor(() => expect(onMutated).toHaveBeenCalled())
  })

  it('confirms a kick and closes', async () => {
    const onClose = vi.fn()
    render(
      <PlayerDetailPopup player={PLAYER} serverId="srv1" onClose={onClose} onMutated={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'kick' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm kick' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
