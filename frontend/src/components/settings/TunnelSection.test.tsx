import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { RemoteAccessState } from '../../stores/useRemoteStore'
import { TunnelSection } from './TunnelSection'

afterEach(cleanup)

type Tunnel = RemoteAccessState['tunnel']
type Status = Tunnel['status']

const ADDRESS = 'https://quiet-fox.trycloudflare.com'
const ALL: Status[] = ['off', 'downloading', 'starting', 'running', 'failed']
const NONE = { hostname: '', port: 0, tokenSet: false }
const NAMED = { hostname: 'dash.example.net', port: 48321, tokenSet: true }

const tunnel = (over: Partial<Tunnel> = {}): Tunnel => ({
  status: 'off',
  url: '',
  error: '',
  percent: 0,
  version: '2026.9.3',
  named: NONE,
  ...over,
})

function setup(
  t: Partial<Tunnel> = {},
  props: { listening?: boolean; disabled?: boolean; saveOk?: boolean } = {},
) {
  const onStart = vi.fn()
  const onStop = vi.fn()
  const onSaveNamed = vi.fn(() => Promise.resolve(props.saveOk ?? true))
  const onForgetNamed = vi.fn()
  const view = render(
    <TunnelSection
      tunnel={tunnel(t)}
      listening={props.listening ?? true}
      disabled={props.disabled ?? false}
      onStart={onStart}
      onStop={onStop}
      onSaveNamed={onSaveNamed}
      onForgetNamed={onForgetNamed}
    />,
  )
  return { onStart, onStop, onSaveNamed, onForgetNamed, ...view }
}

const hostInput = () => screen.getByLabelText('Hostname') as HTMLInputElement
const portInput = () => screen.getByLabelText('Port') as HTMLInputElement
const tokenInput = () => screen.getByLabelText('Tunnel token') as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

const sw = () => screen.getByRole('switch') as HTMLButtonElement

describe('TunnelSection', () => {
  describe('off, with the listener running', () => {
    it('names itself and carries no explanation', () => {
      setup()
      expect(screen.getByText('Reach it from anywhere')).toBeTruthy()
      expect(screen.queryByText(/Cloudflare/)).toBeNull()
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

  describe('the named tunnel form (#512)', () => {
    it('offers the three fields and Save only once they are filled', () => {
      const { onSaveNamed } = setup()
      expect(screen.getByText(/Route the hostname to/)).toBeTruthy()
      expect(tokenInput().type).toBe('password')
      expect(saveButton().disabled).toBe(true)
      fireEvent.change(hostInput(), { target: { value: 'Dash.Example.net' } })
      fireEvent.change(portInput(), { target: { value: '48321' } })
      expect(saveButton().disabled).toBe(true)
      fireEvent.change(tokenInput(), { target: { value: 'tok' } })
      expect(saveButton().disabled).toBe(false)
      fireEvent.click(saveButton())
      expect(onSaveNamed).toHaveBeenCalledWith('Dash.Example.net', 48321, 'tok')
    })

    it.each(['80', '70000', 'abc', ''])('keeps Save off for port %j', (port) => {
      setup()
      fireEvent.change(hostInput(), { target: { value: 'dash.example.net' } })
      fireEvent.change(portInput(), { target: { value: port } })
      fireEvent.change(tokenInput(), { target: { value: 'tok' } })
      expect(saveButton().disabled).toBe(true)
    })

    it('clears the token field after a save the backend accepted', async () => {
      setup()
      fireEvent.change(hostInput(), { target: { value: 'dash.example.net' } })
      fireEvent.change(portInput(), { target: { value: '48321' } })
      fireEvent.change(tokenInput(), { target: { value: 'tok' } })
      fireEvent.click(saveButton())
      await waitFor(() => expect(tokenInput().value).toBe(''))
    })

    it('keeps the token typed when the backend refused', async () => {
      const { onSaveNamed } = setup({}, { saveOk: false })
      fireEvent.change(hostInput(), { target: { value: '*.example.net' } })
      fireEvent.change(portInput(), { target: { value: '48321' } })
      fireEvent.change(tokenInput(), { target: { value: 'tok' } })
      fireEvent.click(saveButton())
      await waitFor(() => expect(onSaveNamed).toHaveBeenCalled())
      expect(tokenInput().value).toBe('tok')
    })

    it('shows the saved hostname and port on one line, with Change and Forget token', () => {
      const { onForgetNamed } = setup({ named: NAMED })
      expect(screen.getByText('dash.example.net on port 48321')).toBeTruthy()
      expect(screen.queryByLabelText('Tunnel token')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Forget token' }))
      expect(onForgetNamed).toHaveBeenCalledTimes(1)
    })

    it('lets a saved tunnel change port with the stored token kept', () => {
      const { onSaveNamed } = setup({ named: NAMED })
      fireEvent.click(screen.getByRole('button', { name: 'Change' }))
      expect(hostInput().value).toBe('dash.example.net')
      expect(portInput().value).toBe('48321')
      expect(tokenInput().placeholder).toBe('Keep the stored token')
      fireEvent.change(portInput(), { target: { value: '48400' } })
      expect(saveButton().disabled).toBe(false)
      fireEvent.click(saveButton())
      expect(onSaveNamed).toHaveBeenCalledWith('dash.example.net', 48400, '')
    })

    it('says the address stays while a named tunnel runs', () => {
      setup({ status: 'running', url: 'https://dash.example.net', named: NAMED })
      expect(screen.getByText(/The address stays the same across runs/)).toBeTruthy()
      expect(screen.queryByText(/The address is new every time\./)).toBeNull()
    })

    it.each<Status>(['downloading', 'starting', 'running'])('locks the form while %s', (status) => {
      setup({ status, url: ADDRESS, named: NAMED })
      expect((screen.getByRole('button', { name: 'Change' }) as HTMLButtonElement).disabled).toBe(
        true,
      )
      expect(
        (screen.getByRole('button', { name: 'Forget token' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })
  })
})
