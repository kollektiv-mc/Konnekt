import { useEffect, useRef, useState } from 'react'
import { useRemoteStore } from '../../stores/useRemoteStore'
import type { RemoteDevice } from '../../stores/useRemoteStore'
import { relativeMs } from '../../lib/format'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'
import { SettingRow } from '../ui/SettingRow'
import { Toggle } from '../ui/Toggle'
import { PendingDeviceCard } from './PendingDeviceCard'
import { ACCENT_BUTTON, DANGER_BUTTON, QUIET_BUTTON, TEXT_INPUT } from './controls'

// The listener binds loopback and serves plain HTTP; there is no TLS to name.
const LISTENER_SCHEME = 'http:'
const MIN_PASSWORD = 12
const SECTION = 'border-border-subtle border-b-hairline py-3'

/** "Nobody connected", "1 browser connected", "3 browsers connected". */
function clientsLine(clients: number): string {
  if (clients <= 0) return 'Nobody connected'
  return clients === 1 ? '1 browser connected' : `${clients} browsers connected`
}

function lastSignedIn(device: RemoteDevice): string {
  return device.lastSeen ? `Last signed in ${relativeMs(device.lastSeen)}` : 'Never signed in'
}

function AddressRow({ addr, clients }: { addr: string; clients: number }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const url = `${LISTENER_SCHEME}//${addr}`

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      return // Clipboard refused: the address stays on screen to copy by hand.
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  const open = () => {
    try {
      BrowserOpenURL(url)
    } catch {
      /* non-Wails context */
    }
  }

  return (
    <div className={SECTION}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary text-xs">Address</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-text-muted text-1xs truncate font-mono">{url}</span>
          <button onClick={() => void copy()} className={QUIET_BUTTON}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={open} className={QUIET_BUTTON}>
            Open ↗
          </button>
        </div>
      </div>
      <p className="text-text-muted mt-1.5 text-xs">{clientsLine(clients)}</p>
    </div>
  )
}

export function RemoteAccessPane() {
  const {
    access,
    loaded,
    error,
    start,
    stop,
    setPassword,
    removeDevice,
    revokeSessions,
    approveDevice,
    denyDevice,
  } = useRemoteStore()
  const [busy, setBusy] = useState(false)
  const [password, setPasswordText] = useState('')

  // Every action records a refusal in the store's `error`, shown in the banner
  // above, so the catch only stops the rejection going unhandled.
  const run = async (call: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    try {
      await call()
      return true
    } catch {
      return false
    } finally {
      setBusy(false)
    }
  }

  const submitPassword = async () => {
    if (await run(() => setPassword(password))) setPasswordText('')
  }

  const disabled = !loaded || busy
  const passwordSet = access.passwordSet
  const devices = access.devices
  const pending = access.pendingDevices

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="text-danger border-danger/20 bg-danger/10 border-hairline my-2 rounded px-3 py-2 font-mono text-xs"
        >
          Couldn&apos;t do that: {error}
        </div>
      )}

      {pending.map((request) => (
        <PendingDeviceCard
          key={request.id}
          request={request}
          onApprove={(name) => approveDevice(request.id, name)}
          onDeny={() => denyDevice(request.id)}
        />
      ))}

      <SettingRow
        label="Remote access"
        description={`Serve this dashboard to a browser you have approved. Off until you switch it on, and it switches itself off after 30 minutes without use.${passwordSet ? '' : ' Set a password first.'}`}
      >
        <Toggle
          checked={access.running}
          disabled={disabled || !passwordSet}
          onChange={(on) => void run(on ? start : stop)}
        />
      </SettingRow>

      {access.running && <AddressRow addr={access.addr} clients={access.clients} />}

      <div className={SECTION}>
        <span className="text-text-primary text-sm">Password</span>
        <p className="text-text-muted mt-0.5 mb-3 text-xs">
          {passwordSet ? 'A password is set.' : 'No password yet.'}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            autoComplete="new-password"
            aria-label="New password"
            placeholder="At least 12 characters"
            value={password}
            disabled={disabled}
            onChange={(e) => setPasswordText(e.target.value)}
            className={`${TEXT_INPUT} flex-1`}
          />
          <button
            disabled={disabled || password.length < MIN_PASSWORD}
            onClick={() => void submitPassword()}
            className={ACCENT_BUTTON}
          >
            {passwordSet ? 'Change password' : 'Set password'}
          </button>
        </div>
        {passwordSet && (
          <p className="text-text-muted mt-1.5 text-xs">Changing it signs every device out.</p>
        )}
      </div>

      <div className="py-3">
        <span className="text-text-primary text-sm">Approved devices</span>
        {devices.length === 0 ? (
          <p className="text-text-muted mt-0.5 text-xs">
            No device has been approved yet. Sign in from a browser and approve it here.
          </p>
        ) : (
          <>
            <ul className="mt-2 flex flex-col gap-2">
              {devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-text-secondary flex items-center gap-2 text-xs">
                      <span className="truncate">{device.name}</span>
                      {device.sessions > 0 && (
                        <span className="bg-hover text-text-faint border-border-subtle border-hairline text-2xs shrink-0 rounded px-1.5 py-0.5">
                          signed in
                        </span>
                      )}
                    </span>
                    <span className="text-text-muted text-1xs">{lastSignedIn(device)}</span>
                  </div>
                  <button
                    disabled={disabled}
                    onClick={() => void run(() => removeDevice(device.id))}
                    className={DANGER_BUTTON}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-3">
              <button
                disabled={disabled}
                onClick={() => void run(revokeSessions)}
                className={QUIET_BUTTON}
              >
                Sign out everywhere
              </button>
              <span className="text-text-muted text-1xs">
                Devices stay approved and sign in again with the password.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
