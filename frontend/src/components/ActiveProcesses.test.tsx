import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ActiveProcesses } from './ActiveProcesses'
import { useInstallStore } from '../stores/useInstallStore'
import { useLoaderStore } from '../stores/useLoaderStore'
import { useProcessesStore } from '../stores/useProcessesStore'
import { useUiStore } from '../stores/useUiStore'

// Vitest runs with `globals: false`, so RTL cannot register its own auto-cleanup
// afterEach and a previous test's DOM would still be mounted.
afterEach(cleanup)

describe('ActiveProcesses', () => {
  beforeEach(() => {
    useProcessesStore.setState({ processes: {} })
    useLoaderStore.setState({ dialogOpen: false })
    useInstallStore.setState({ open: false })
    useUiStore.setState({ maximizeRequest: null })
  })

  it('renders nothing when there is no work', () => {
    const { container } = render(<ActiveProcesses />)
    expect(container.firstChild).toBeNull()
  })

  // The backend's guards are per-service and nothing coordinates across them, so
  // work of different kinds genuinely overlaps. The sidebar has to show that.
  it('stacks concurrent jobs', () => {
    const { start } = useProcessesStore.getState()
    start('srv1', 'Backing up world…', { view: { kind: 'tile', tileId: 'backups' } })
    start('mod:srv1', 'Downloading create…', { view: { kind: 'tile', tileId: 'mods' } })
    render(<ActiveProcesses />)

    expect(screen.getByText('Backing up world…')).toBeTruthy()
    expect(screen.getByText('Downloading create…')).toBeTruthy()
  })

  it('opens the loader dialog from its row', () => {
    useProcessesStore.getState().start('loader:srv1', 'Updating loader to 21.1.209…', {
      indeterminate: true,
      view: { kind: 'loader', serverId: 'srv1' },
    })
    render(<ActiveProcesses />)

    fireEvent.click(screen.getByRole('button', { name: 'Updating loader to 21.1.209…' }))

    expect(useLoaderStore.getState().dialogOpen).toBe(true)
  })

  it('opens the install modal from its row', () => {
    useProcessesStore.getState().start('install:/srv/mc', 'Installing server…', {
      indeterminate: true,
      view: { kind: 'install' },
    })
    render(<ActiveProcesses />)

    fireEvent.click(screen.getByRole('button', { name: 'Installing server…' }))

    expect(useInstallStore.getState().open).toBe(true)
  })

  // Backups and mod installs have no window of their own, so the row opens the
  // tile that shows them.
  it.each([
    ['srv1', 'Backing up world…', 'backups'],
    ['mod:srv1', 'Downloading create…', 'mods'],
  ])('opens the %s tile from its row', (id, label, tileId) => {
    useProcessesStore.getState().start(id, label, { view: { kind: 'tile', tileId } })
    render(<ActiveProcesses />)

    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(useUiStore.getState().maximizeRequest).toEqual({ id: tileId, rect: null })
  })

  it('leaves a row without a view unclickable', () => {
    useProcessesStore.getState().start('p1', 'Something else…')
    render(<ActiveProcesses />)

    expect(screen.queryByRole('button', { name: 'Something else…' })).toBeNull()
    expect(screen.getByText('Something else…')).toBeTruthy()
  })

  // A failure sticks around, so it needs a way out that is not "wait three
  // seconds and lose the error".
  it('offers dismiss on a failure and not on a success', () => {
    const { start, finish } = useProcessesStore.getState()
    start('p1', 'Backing up world…', { view: { kind: 'tile', tileId: 'backups' } })
    finish('p1', 'failed')
    render(<ActiveProcesses />)

    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    fireEvent.click(dismiss)

    expect(useProcessesStore.getState().processes.p1).toBeUndefined()
  })

  it('has no dismiss while a job is still running', () => {
    useProcessesStore.getState().start('p1', 'Backing up world…')
    render(<ActiveProcesses />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('shows a pulse for indeterminate work and a percentage otherwise', () => {
    const { start, updateProgress } = useProcessesStore.getState()
    start('a', 'Installing server…', { indeterminate: true })
    start('b', 'Backing up world…')
    updateProgress('b', 42)
    render(<ActiveProcesses />)

    expect(screen.getByText('…')).toBeTruthy()
    expect(screen.getByText('42%')).toBeTruthy()
  })
})
