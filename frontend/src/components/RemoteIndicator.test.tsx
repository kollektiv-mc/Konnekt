import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useRemoteStore } from '../stores/useRemoteStore'
import type { RemoteAccessState } from '../stores/useRemoteStore'
import { RemoteIndicator } from './RemoteIndicator'

afterEach(() => {
  cleanup()
  useRemoteStore.setState({ loaded: false, error: null })
})

function seed(over: Record<string, unknown> = {}) {
  useRemoteStore.setState({
    access: {
      passwordSet: true,
      running: true,
      addr: '',
      clients: 0,
      devices: [],
      pendingDevices: [],
      approvals: [],
      tunnel: { status: 'off', url: '', error: '', percent: 0, version: '2026.9.3' },
      ...over,
    } as unknown as RemoteAccessState,
    loaded: true,
    error: null,
  })
}

const chip = () => screen.getByRole('button', { name: 'Remote access is on. Click to manage.' })

describe('RemoteIndicator', () => {
  it('is not rendered while remote access is off', () => {
    seed({ running: false, clients: 2 })
    const { container } = render(<RemoteIndicator onOpen={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('reads "Remote on" while it runs', () => {
    seed()
    render(<RemoteIndicator onOpen={() => {}} />)
    expect(chip().textContent).toBe('Remote on')
    expect(chip().getAttribute('title')).toBe('Remote access is on. Click to manage.')
  })

  it.each([
    [0, 'Remote on'],
    [1, 'Remote on · 1 browser'],
    [3, 'Remote on · 3 browsers'],
  ])('with %i clients reads %s', (clients, text) => {
    seed({ clients })
    render(<RemoteIndicator onOpen={() => {}} />)
    expect(chip().textContent).toBe(text)
  })

  const tunnel = (status: string) => ({
    status,
    url: status === 'running' ? 'https://quiet-fox.trycloudflare.com' : '',
    error: '',
    percent: 0,
    version: '2026.9.3',
  })

  it('says "public" while the tunnel is running', () => {
    seed({ tunnel: tunnel('running') })
    render(<RemoteIndicator onOpen={() => {}} />)
    expect(chip().textContent).toBe('Remote on, public')
  })

  it.each([
    [1, 'Remote on, public · 1 browser'],
    [3, 'Remote on, public · 3 browsers'],
  ])('with %i clients and a running tunnel reads %s', (clients, text) => {
    seed({ clients, tunnel: tunnel('running') })
    render(<RemoteIndicator onOpen={() => {}} />)
    expect(chip().textContent).toBe(text)
  })

  it.each(['off', 'downloading', 'starting', 'failed'])(
    'keeps the plain wording while the tunnel is %s',
    (status) => {
      seed({ clients: 1, tunnel: tunnel(status) })
      render(<RemoteIndicator onOpen={() => {}} />)
      expect(chip().textContent).toBe('Remote on · 1 browser')
    },
  )

  it('lets the waiting variant win over "public"', () => {
    seed({ clients: 2, tunnel: tunnel('running'), pendingDevices: [{ id: 'p1' }] })
    render(<RemoteIndicator onOpen={() => {}} />)
    expect(chip().textContent).toBe('Remote: waiting for you')
  })

  it('is not rendered with a tunnel up but the listener off', () => {
    seed({ running: false, tunnel: tunnel('running') })
    const { container } = render(<RemoteIndicator onOpen={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('turns to the warning variant for a waiting device', () => {
    seed({ clients: 2, pendingDevices: [{ id: 'p1' }] })
    render(<RemoteIndicator onOpen={() => {}} />)
    expect(chip().textContent).toBe('Remote: waiting for you')
    expect(chip().className).toContain('text-warning')
  })

  it('turns to the warning variant for a waiting approval', () => {
    seed({ approvals: [{ id: 'a1' }] })
    render(<RemoteIndicator onOpen={() => {}} />)
    expect(chip().textContent).toBe('Remote: waiting for you')
    expect(chip().className).toContain('border-warning/30')
  })

  it('calls onOpen when clicked', () => {
    seed()
    const onOpen = vi.fn()
    render(<RemoteIndicator onOpen={onOpen} />)
    fireEvent.click(chip())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
