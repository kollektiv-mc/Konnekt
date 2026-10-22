import { useState } from 'react'
import type { RemoteAccessState } from '../../stores/useRemoteStore'
import { QrCode } from '../ui/QrCode'
import { Toggle } from '../ui/Toggle'
import { CopyButton } from './CopyButton'
import { ACCENT_BUTTON, DANGER_BUTTON, QUIET_BUTTON, TEXT_INPUT } from './controls'

type Tunnel = RemoteAccessState['tunnel']

interface Props {
  tunnel: Tunnel
  /** The tunnel carries the listener, so it is offered only while that runs. */
  listening: boolean
  disabled: boolean
  onStart: () => void
  onStop: () => void
  /** Saves the named tunnel; resolves true when the backend accepted it. */
  onSaveNamed: (hostname: string, port: number, token: string) => Promise<boolean>
  onForgetNamed: () => void
}

/** Anything but off or failed is a tunnel that is up or on its way up. */
function isOn(status: string): boolean {
  return status === 'downloading' || status === 'starting' || status === 'running'
}

/** A named tunnel is configured once it has a hostname and a stored token. */
function isNamed(tunnel: Tunnel): boolean {
  return tunnel.named.hostname !== '' && tunnel.named.tokenSet
}

const PORT_MIN = 1024
const PORT_MAX = 65535

function Progress({ tunnel }: { tunnel: Tunnel }) {
  switch (tunnel.status) {
    case 'downloading':
      return (
        <p className="text-text-muted mt-2 text-xs">
          Downloading cloudflared {tunnel.version}:{' '}
          <span className="font-mono">{tunnel.percent}%</span>
        </p>
      )
    case 'starting':
      return <p className="text-text-muted mt-2 text-xs">Opening the tunnel.</p>
    case 'running':
      return (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-accent text-1xs truncate font-mono">{tunnel.url}</span>
            <CopyButton text={tunnel.url} />
          </div>
          <div className="mt-3 flex items-start gap-4">
            {tunnel.url && <QrCode text={tunnel.url} />}
            <div className="text-text-muted text-xs">
              {tunnel.url && <p className="mb-1.5">Point a phone camera at the code to open it.</p>}
              {isNamed(tunnel) ? (
                <p>
                  The address stays the same across runs, and a device approved through it stays
                  approved.
                </p>
              ) : (
                <p>
                  The address is new every time. A device approved through it is forgotten when the
                  tunnel closes, and is approved again on the next one.
                </p>
              )}
            </div>
          </div>
        </>
      )
    case 'failed':
      return (
        <div
          role="alert"
          className="text-danger border-danger/20 bg-danger/10 border-hairline mt-2 rounded px-3 py-2 text-xs"
        >
          <p>The tunnel did not open.</p>
          <pre className="text-2xs mt-1 max-h-24 overflow-auto font-mono break-all whitespace-pre-wrap">
            {tunnel.error}
          </pre>
        </div>
      )
    default:
      return null
  }
}

interface NamedProps {
  named: Tunnel['named']
  /** The form is locked while a tunnel runs: the backend refuses a change then too. */
  locked: boolean
  onSave: Props['onSaveNamed']
  onForget: () => void
}

/**
 * The named tunnel's form (#512): a hostname the user routed in their own
 * Cloudflare dashboard, the loopback port that route points at, and the tunnel
 * token. Shown collapsed to one line once saved. The token field is a password
 * field and is cleared after a save; the backend never sends it back, only
 * whether one is stored, so an empty field on a later save keeps it.
 */
function NamedForm({ named, locked, onSave, onForget }: NamedProps) {
  const configured = named.hostname !== '' && named.tokenSet
  const [editing, setEditing] = useState(false)
  const [hostname, setHostname] = useState(named.hostname)
  const [port, setPort] = useState(named.port ? String(named.port) : '')
  const [token, setToken] = useState('')

  const portNumber = Number(port)
  const portOk = /^\d+$/.test(port) && portNumber >= PORT_MIN && portNumber <= PORT_MAX
  // A first save needs a token; a later one may keep the stored one.
  const canSave = hostname.trim() !== '' && portOk && (token !== '' || named.tokenSet)

  const save = async () => {
    if (await onSave(hostname.trim(), portNumber, token)) {
      setToken('')
      setEditing(false)
    }
  }

  if (configured && !editing) {
    return (
      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-text-secondary text-xs">Your own address</span>
          <p className="text-text-muted text-1xs mt-0.5 truncate font-mono">
            {named.hostname} on port {named.port}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            disabled={locked}
            onClick={() => {
              setHostname(named.hostname)
              setPort(String(named.port))
              setEditing(true)
            }}
            className={QUIET_BUTTON}
          >
            Change
          </button>
          <button disabled={locked} onClick={onForget} className={DANGER_BUTTON}>
            Forget token
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <span className="text-text-secondary text-xs">Your own address</span>
      <p className="text-text-muted mt-0.5 mb-2 text-xs">
        Route the hostname to{' '}
        <span className="font-mono">http://127.0.0.1:{portOk ? port : 'PORT'}</span>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="Hostname"
          placeholder="dash.example.net"
          value={hostname}
          disabled={locked}
          onChange={(e) => setHostname(e.target.value)}
          className={`${TEXT_INPUT} min-w-40 flex-1`}
        />
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Port"
          placeholder="Port"
          value={port}
          disabled={locked}
          onChange={(e) => setPort(e.target.value)}
          className={`${TEXT_INPUT} w-20`}
        />
        <input
          type="password"
          autoComplete="off"
          aria-label="Tunnel token"
          placeholder={named.tokenSet ? 'Keep the stored token' : 'Tunnel token'}
          value={token}
          disabled={locked}
          onChange={(e) => setToken(e.target.value)}
          className={`${TEXT_INPUT} min-w-40 flex-1`}
        />
        <button disabled={locked || !canSave} onClick={() => void save()} className={ACCENT_BUTTON}>
          Save
        </button>
        {configured && (
          <button disabled={locked} onClick={() => setEditing(false)} className={QUIET_BUTTON}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The public way in (#46): a Cloudflare tunnel to the loopback listener, a
 * quick one by default or the user's own named one once configured (#512).
 * The address is public, the sign-in is what stands in front of the
 * dashboard, and Cloudflare terminates the TLS and so can read what passes,
 * the password included. The row no longer says so; the docs Settings
 * reference (#653) is where it belongs.
 */
export function TunnelSection({
  tunnel,
  listening,
  disabled,
  onStart,
  onStop,
  onSaveNamed,
  onForgetNamed,
}: Props) {
  const on = isOn(tunnel.status)
  return (
    <div className="border-border-subtle border-b-hairline py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-text-primary text-sm">Reach it from anywhere</span>
          {!listening && (
            <p className="text-text-muted mt-0.5 text-xs">Switch remote access on first.</p>
          )}
        </div>
        <div className="shrink-0">
          <Toggle
            checked={on}
            disabled={disabled || (!listening && !on)}
            onChange={(next) => (next ? onStart() : onStop())}
          />
        </div>
      </div>
      <Progress tunnel={tunnel} />
      <NamedForm
        named={tunnel.named}
        locked={disabled || on}
        onSave={onSaveNamed}
        onForget={onForgetNamed}
      />
    </div>
  )
}
