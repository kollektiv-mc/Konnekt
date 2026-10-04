import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { RemoteAccessState } from '../../stores/useRemoteStore'
import { TunnelSection } from './TunnelSection'

afterEach(cleanup)

type Tunnel = RemoteAccessState['tunnel']
type Status = Tunnel['status']

const ADDRESS = 'https://quiet-fox.trycloudflare.com'
const ALL: Status[] = ['off', 'downloading', 'starting', 'running', 'failed']

const tunnel = (over: Partial<Tunnel> = {}): Tunnel => ({
  status: 'off',
  url: '',
  error: '',
  percent: 0,
  version: '2026.9.3',
  ...over,
})

function setup(t: Partial<Tunnel> = {}, props: { listening?: boolean; disabled?: boolean } = {}) {
  const onStart = vi.fn()
  const onStop = vi.fn()
  const view = render(
    <TunnelSection
      tunnel={tunnel(t)}
      listening={props.listening ?? true}
      disabled={props.disabled ?? false}
      onStart={onStart}
      onStop={onStop}
    />,
  )
  return { onStart, onStop, ...view }
}

const sw = () => screen.getByRole('switch') as HTMLButtonElement

describe('TunnelSection', () => {
  describe('off, with the listener running', () => {
    it('names itself and says Cloudflare can read the traffic', () => {
      setup()
      expect(screen.getByText('Reach it from anywhere')).toBeTruthy()
      expect(screen.getByText(/can read it, your password included/)).toBeTruthy()
      expect(screen.queryByText(/Switch remote access on first\./)).toBeNull()
    })

    it('has an enabled, unchecked switch that starts the tunnel', () => {
      const { onStart, onStop } = setup()
      expect(sw().getAttribute('aria-checked')).toBe('false')
      expect(sw().disabled).toBe(false)
      fireEvent.click(sw())
      expect(onStart).toHaveBeenCalledTimes(1)
      expect(onStop).not.toHaveBeenCalled()
    })

    it('shows no progress area', () => {
      setup()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    })
  })

  describe('off, with the listener off', () => {
    it('says to switch remote access on first and disables the switch', () => {
      const { onStart } = setup({}, { listening: false })
      expect(screen.getByText(/Switch remote access on first\./)).toBeTruthy()
      expect(sw().disabled).toBe(true)
      fireEvent.click(sw())
      expect(onStart).not.toHaveBeenCalled()
    })
  })

  describe('downloading', () => {
    it('shows the version and percentage, and stops when clicked', () => {
      const { onStart, onStop } = setup({ status: 'downloading', percent: 42, version: '2026.9.3' })
      const text = document.body.textContent ?? ''
      expect(text).toContain('Downloading cloudflared 2026.9.3')
      expect(text).toContain('42%')
      expect(sw().getAttribute('aria-checked')).toBe('true')
      fireEvent.click(sw())
      expect(onStop).toHaveBeenCalledTimes(1)
      expect(onStart).not.toHaveBeenCalled()
    })
  })

  describe('starting', () => {
    it('says the tunnel is opening, with the switch on', () => {
      setup({ status: 'starting' })
      expect(screen.getByText('Opening the tunnel.')).toBeTruthy()
      expect(sw().getAttribute('aria-checked')).toBe('true')
    })
  })

  describe('running', () => {
    it('shows the address, a Copy button and the new-every-time note', () => {
      setup({ status: 'running', url: ADDRESS })
      expect(screen.getByText(ADDRESS)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
      expect(screen.getByText(/The address is new every time\./)).toBeTruthy()
      expect(sw().getAttribute('aria-checked')).toBe('true')
    })

    it('shows a QR code named for the address', () => {
      setup({ status: 'running', url: ADDRESS })
      expect(screen.getByRole('img', { name: `QR code for ${ADDRESS}` })).toBeTruthy()
    })

    it('shows no QR code while the address is empty', () => {
      setup({ status: 'running', url: '' })
      expect(screen.queryByRole('img')).toBeNull()
    })

    it('copies the tunnel address', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      Object.assign(navigator, { clipboard: { writeText } })
      setup({ status: 'running', url: ADDRESS })
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await screen.findByRole('button', { name: 'Copied' })
      expect(writeText).toHaveBeenCalledWith(ADDRESS)
    })

    it('stops when the switch is clicked', () => {
      const { onStart, onStop } = setup({ status: 'running', url: ADDRESS })
      fireEvent.click(sw())
      expect(onStop).toHaveBeenCalledTimes(1)
      expect(onStart).not.toHaveBeenCalled()
    })
  })

  describe('failed', () => {
    const error = 'failed to dial edge\nconnection refused'

    it('shows the failure in an alert with the error text', () => {
      setup({ status: 'failed', error })
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('The tunnel did not open.')
      expect(alert.textContent).toContain('failed to dial edge')
      expect(alert.textContent).toContain('connection refused')
    })

    it('leaves the switch off and, with the listener on, enabled to retry', () => {
      const { onStart } = setup({ status: 'failed', error })
      expect(sw().getAttribute('aria-checked')).toBe('false')
      expect(sw().disabled).toBe(false)
      fireEvent.click(sw())
      expect(onStart).toHaveBeenCalledTimes(1)
    })

    it('disables the switch when the listener is off', () => {
      setup({ status: 'failed', error }, { listening: false })
      expect(sw().disabled).toBe(true)
    })
  })

  it.each<Status>(['off', 'downloading', 'starting', 'failed'])(
    'shows no QR code while %s, even with a stale address',
    (status) => {
      setup({ status, url: ADDRESS, error: 'boom' })
      expect(screen.queryByRole('img')).toBeNull()
    },
  )

  describe('the disabled prop', () => {
    it.each(ALL)('disables the switch while %s', (status) => {
      setup({ status, url: ADDRESS, error: 'boom' }, { disabled: true })
      expect(sw().disabled).toBe(true)
    })
  })

  it.each<Status>(['downloading', 'starting', 'running'])(
    'keeps the switch usable while %s even if the listener is reported off',
    (status) => {
      const { onStop } = setup({ status, url: ADDRESS }, { listening: false })
      expect(sw().disabled).toBe(false)
      fireEvent.click(sw())
      expect(onStop).toHaveBeenCalledTimes(1)
    },
  )

  it.each(ALL)('uses no em dash in what it shows while %s', (status) => {
    setup({ status, url: ADDRESS, error: 'boom', percent: 7 })
    expect(document.body.textContent).not.toContain('—')
  })
})
