import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import * as App from '../../wailsjs/go/main/App'
import { ServerSelector } from './ServerSelector'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'
import type { ServerConfig } from '../types'

vi.mock('../../wailsjs/go/main/App')

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

function cfg(id: string): ServerConfig {
  return {
    id,
    name: id,
    jarPath: '',
    jvmArgs: [],
    workingDir: `/srv/${id}`,
    mcVersion: '1.21.1',
    loader: 'neoforge',
    loaderVersion: '',
  }
}

describe('ServerSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetServerConfigs).mockResolvedValue([])
    vi.mocked(App.GetActiveServerID).mockResolvedValue('')
    useServerConfigStore.setState({
      configs: [cfg('alpha'), cfg('beta')],
      activeId: 'alpha',
      error: null,
    })
    useUiStore.setState({
      serverManagerOpen: false,
      serverManagerSelection: '',
      pendingDisconnect: null,
    })
  })

  it('lists the configured servers', () => {
    render(<ServerSelector />)
    expect(screen.getByRole('button', { name: /alpha/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /beta/ })).toBeTruthy()
  })

  it('selecting a server makes it active', () => {
    render(<ServerSelector />)
    fireEvent.click(screen.getByRole('button', { name: /beta/ }))
    expect(App.SetActiveServerID).toHaveBeenCalledWith('beta')
  })

  it('the edit control opens the manager on that server', () => {
    render(<ServerSelector />)
    fireEvent.click(screen.getAllByTitle('Edit')[1])

    const s = useUiStore.getState()
    expect(s.serverManagerOpen).toBe(true)
    expect(s.serverManagerSelection).toBe('beta')
  })

  it('Add server opens the manager on the add form', () => {
    render(<ServerSelector />)
    fireEvent.click(screen.getByRole('button', { name: /Add server/ }))

    const s = useUiStore.getState()
    expect(s.serverManagerOpen).toBe(true)
    expect(s.serverManagerSelection).toBe('new')
  })

  it('disconnect raises the confirm rather than deleting', () => {
    render(<ServerSelector />)
    fireEvent.click(screen.getAllByTitle('Disconnect')[0])

    expect(useUiStore.getState().pendingDisconnect).toBe('alpha')
    expect(App.DeleteServerConfig).not.toHaveBeenCalled()
  })

  // Every overlay moved to App: a fixed overlay in the sidebar carries the same
  // z-50 as the maximized-tile overlay in <main> and comes earlier in the
  // document, so it opened underneath an open tile.
  it('renders no overlay of its own', () => {
    const { container } = render(<ServerSelector />)
    useUiStore.setState({ serverManagerOpen: true, pendingDisconnect: 'alpha' })

    expect(container.querySelector('.fixed')).toBeNull()
    expect(screen.queryByText('Disconnect server?')).toBeNull()
  })
})
