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
