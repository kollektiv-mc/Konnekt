import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { useInstallStore } from '../stores/useInstallStore'
import { useLoaderStore } from '../stores/useLoaderStore'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'
import { LAYER, declaredLayer } from '../lib/layers'
import { DisconnectConfirm } from './DisconnectConfirm'
import { ServerManager } from './ServerManager'
import type { ServerConfig } from '../types'

vi.mock('../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

const cfg: ServerConfig = {
  id: 'alpha',
  name: 'alpha',
  jarPath: '',
  jvmArgs: [],
  workingDir: '/srv/alpha',
  mcVersion: '1.21.1',
  loader: 'neoforge',
  loaderVersion: '',
}

// The layer a node declares, resolved through lib/layers.ts; a bare number
// fails here on purpose, because it means the surface has left the scale.
function declaredZ(el: Element | null): number {
  const layer = declaredLayer(el?.className ?? '')
  if (!layer) throw new Error(`no z-<layer> class on ${el?.className || 'a missing element'}`)
  return LAYER[layer]
}

describe('DisconnectConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetServerSummary).mockResolvedValue({
      mcVersion: '1.21.1',
      loader: 'neoforge',
      workingDir: '/srv/alpha',
      launchFile: 'run.sh',
      running: false,
      loaderVersion: '21.1.72',
      loaderSource: 'script',
    } as Awaited<ReturnType<typeof App.GetServerSummary>>)
    useServerConfigStore.setState({ configs: [cfg], activeId: 'alpha', error: null })
    useInstallStore.setState({ open: false, result: null })
    useLoaderStore.setState({ dialogOpen: false, status: null, versions: [] })
    useUiStore.setState({
      serverManagerOpen: true,
      serverManagerSelection: 'alpha',
      pendingDisconnect: 'alpha',
    })
  })

  // The pair that caused the original bug: the confirm is raised from the
  // manager and rendered beside it at app level, so nothing but the value puts
  // it on top. It used to be z-[60] over z-50; now it is a dialog over a modal,
  // and this fails if either side drops back to a literal.
  it('opens above the server manager that raised it', () => {
    render(
      <>
        <ServerManager />
        <DisconnectConfirm />
      </>,
    )

    const manager = screen.getByText('Servers').closest('.fixed')
    const confirm = screen.getByText('Disconnect server?').closest('.fixed')
    expect(declaredZ(confirm)).toBeGreaterThan(declaredZ(manager))
  })

  it('renders nothing with no disconnect pending', () => {
    useUiStore.setState({ pendingDisconnect: null })
    render(<DisconnectConfirm />)
    expect(screen.queryByText('Disconnect server?')).toBeNull()
  })
})
