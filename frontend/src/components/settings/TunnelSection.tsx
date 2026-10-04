import type { RemoteAccessState } from '../../stores/useRemoteStore'
import { QrCode } from '../ui/QrCode'
import { Toggle } from '../ui/Toggle'
import { CopyButton } from './CopyButton'

type Tunnel = RemoteAccessState['tunnel']

interface Props {
  tunnel: Tunnel
  /** The tunnel carries the listener, so it is offered only while that runs. */
  listening: boolean
  disabled: boolean
  onStart: () => void
  onStop: () => void
}

/** Anything but off or failed is a tunnel that is up or on its way up. */
function isOn(status: string): boolean {
  return status === 'downloading' || status === 'starting' || status === 'running'
}

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
              <p>
                The address is new every time. A device approved through it is forgotten when the
                tunnel closes, and is approved again on the next one.
              </p>
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

/**
 * The public way in (#46): a Cloudflare quick tunnel to the loopback listener.
 * It says what switching it on means before the switch, in the one place the
 * decision is made: the address is public, the sign-in is what stands in front
 * of the dashboard, and Cloudflare terminates the TLS and so can read what
 * passes, the password included.
 */
export function TunnelSection({ tunnel, listening, disabled, onStart, onStop }: Props) {
  const on = isOn(tunnel.status)
  return (
    <div className="border-border-subtle border-b-hairline py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-text-primary text-sm">Reach it from anywhere</span>
          <p className="text-text-muted mt-0.5 text-xs">
            Opens a public address through Cloudflare. Anyone who has the address reaches the
            sign-in page, and only a device you approve gets further. Cloudflare carries the traffic
            and can read it, your password included.
            {listening ? '' : ' Switch remote access on first.'}
          </p>
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
    </div>
  )
}
