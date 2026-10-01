import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { RemoteLoginGate } from './RemoteLoginGate'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const fetchMock = vi.fn<typeof fetch>()
const onUnlocked = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  onUnlocked.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

const signIn = (password = 'hunter2') => {
  render(<RemoteLoginGate state="locked" onUnlocked={onUnlocked} />)
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('RemoteLoginGate', () => {
  it('asks for one password, as a labelled password field the browser can fill', () => {
    render(<RemoteLoginGate state="locked" onUnlocked={onUnlocked} />)
    const input = screen.getByLabelText('Password')
    expect(input.getAttribute('type')).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByRole('heading').textContent).toBe('Sign in to this Konnekt')
  })

  it('posts the password as JSON with the session cookie, without a native submission', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    render(<RemoteLoginGate state="locked" onUnlocked={onUnlocked} />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    const submitted = fireEvent.submit(
      screen.getByRole('button', { name: 'Sign in' }).closest('form')!,
    )
    // fireEvent returns false when a handler called preventDefault.
    expect(submitted).toBe(false)
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/login')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ password: 'hunter2' })
  })

  it('calls onUnlocked on any 2xx and says nothing', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    signIn()
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Signing in…')).toBeTruthy()
  })

  it.each([
    ['401', new Response('', { status: 401 }), 'Wrong password.'],
    [
      '429 with a Retry-After',
      new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
      'Too many attempts. Try again in 30 seconds.',
    ],
    ['429 without one', new Response('', { status: 429 }), 'Too many attempts. Try again later.'],
    [
      '429 with an HTTP-date, which is not read',
      new Response('', {
        status: 429,
        headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
      }),
      'Too many attempts. Try again later.',
    ],
    ['403', new Response('  device not approved \n', { status: 403 }), 'device not approved'],
    ['404', new Response('', { status: 404 }), 'This Konnekt does not accept sign-ins yet.'],
    ['405', new Response('', { status: 405 }), 'This Konnekt does not accept sign-ins yet.'],
    ['500', new Response('', { status: 500 }), 'Sign-in failed (500).'],
  ])('says why on a %s', async (_name, reply, message) => {
    fetchMock.mockResolvedValue(reply)
    signIn()
    expect((await screen.findByText(message)).getAttribute('aria-live')).toBe('polite')
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('caps a 403 body at 200 characters', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(500), { status: 403 }))
    signIn()
    expect((await screen.findByText(/^x+$/)).textContent).toHaveLength(200)
  })

  it('says Konnekt is unreachable when the network fails, and lets the user try again', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    signIn()
    expect(await screen.findByText(/Konnekt is unreachable/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('disables the button while a sign-in is in flight', async () => {
    let finish: (res: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)))
    signIn()
    const busy = await screen.findByRole('button', { name: 'Signing in…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    finish(new Response('', { status: 401 }))
    await screen.findByText('Wrong password.')
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('clears the last message when a new attempt starts', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    signIn()
    await screen.findByText('Wrong password.')
    let finish: (res: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (finish = resolve)))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.queryByText('Wrong password.')).toBeNull())
    finish(new Response('', { status: 200 }))
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
  })

  it('offers a retry, not a password, when the app did not answer', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<RemoteLoginGate state="unreachable" onUnlocked={onUnlocked} />)
    expect(screen.queryByLabelText('Password')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
