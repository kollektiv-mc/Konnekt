import { useState } from 'react'
import type { FormEvent } from 'react'

interface Props {
  /** `locked`: the session is missing or ended. `unreachable`: the app did not answer at all. */
  state: 'locked' | 'unreachable'
  onUnlocked: () => void
}

const CARD =
  'bg-canvas border-border-subtle border-hairline flex w-full max-w-sm flex-col gap-4 rounded-xl p-5 font-mono'
const INPUT =
  'bg-surface border-border-subtle text-text-primary placeholder-text-faint focus:border-border-hover border-hairline w-full min-w-0 rounded px-2 py-1.5 font-mono text-base transition-colors outline-none'
const BUTTON =
  'text-accent border-accent/30 hover:bg-accent/10 border-hairline rounded py-1.5 text-xs transition-colors disabled:opacity-40'

/** `Retry-After` in whole seconds. The HTTP-date form is not one the server sends. */
function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get('Retry-After')
  return raw !== null && /^\d+$/.test(raw.trim()) ? Number(raw) : undefined
}

/** What a refused sign-in says. Never includes the password, which is not in the reply. */
async function refusal(res: Response): Promise<string> {
  switch (res.status) {
    case 401:
      return 'Wrong password.'
    case 429: {
      const seconds = retryAfterSeconds(res)
      return seconds === undefined
        ? 'Too many attempts. Try again later.'
        : `Too many attempts. Try again in ${seconds} seconds.`
    }
    case 403: {
      const text = (await res.text()).trim().slice(0, 200)
      return text || 'This device was refused.'
    }
    // 405 as well: before the sign-in route exists the listener answers a POST
    // to an unknown path with Method Not Allowed, not Not Found.
    case 404:
    case 405:
      return 'This Konnekt does not accept sign-ins yet.'
    default:
      return `Sign-in failed (${res.status}).`
  }
}

/**
 * The page a browser lands on when the Remote Access listener will not answer
 * its calls (#44). Rendered by `main.tsx` in place of the dashboard, and only
 * ever loaded by a dynamic import, so the desktop bundle does not carry it.
 *
 * The sign-in is a `fetch`, never a native form submission: the CSP's
 * `form-action 'none'` refuses one. The cookie it earns is HttpOnly and set by
 * the server (§ S8.5), so success reloads rather than reading anything back.
 */
export function RemoteLoginGate({ state, onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        onUnlocked()
        return
      }
      setError(await refusal(res))
    } catch {
      setError('Konnekt is unreachable. Check that the app is running and try again.')
    }
    setSubmitting(false)
  }

  if (state === 'unreachable') {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className={CARD}>
          <h1 className="font-title text-text-primary text-sm font-medium">
            Konnekt is unreachable
          </h1>
          <p className="text-text-secondary text-xs leading-relaxed">
            This page loaded, but the app did not answer. Check that Konnekt is running and that
            remote access is still switched on.
          </p>
          <button type="button" onClick={() => window.location.reload()} className={BUTTON}>
            Retry
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className={CARD}>
        <h1 className="font-title text-text-primary text-sm font-medium">
          Sign in to this Konnekt
        </h1>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="remote-password"
            className="text-text-faint text-2xs tracking-wider uppercase"
          >
            Password
          </label>
          <input
            id="remote-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </div>
        <p aria-live="polite" className="text-danger min-h-4 text-xs">
          {error}
        </p>
        <button type="submit" disabled={submitting} className={BUTTON}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
