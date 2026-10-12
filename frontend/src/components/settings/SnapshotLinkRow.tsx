import { useState } from 'react'
import { useDestinationsStore } from '../../stores/useDestinationsStore'
import type { Destination, SnapshotLinkResult } from '../../stores/useDestinationsStore'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'
import { errMsg } from '../../lib/ipc'
import { Toggle } from '../ui/Toggle'
import { CopyButton } from './CopyButton'
import { ACCENT_BUTTON, DANGER_BUTTON, QUIET_BUTTON } from './controls'

const ACCESS_TUTORIAL_URL = 'https://developers.cloudflare.com/r2/tutorials/cloudflare-access/'

type Confirming = 'mode' | 'rotate' | null

interface Note {
  text: string
  /** True for a refusal or for a link that could not be fully retired. */
  bad: boolean
}

function openAccessTutorial() {
  try {
    BrowserOpenURL(ACCESS_TUTORIAL_URL)
  } catch {
    /* non-Wails context */
  }
}

/**
 * One saved destination's private snapshot link (#561): the mode, Copy link and,
 * in private mode, Rotate link. A move reassembles the published snapshot in the
 * bucket and changes the address everyone uses, so the mode switch and Rotate
 * each ask first.
 *
 * The link itself is fetched on the click that copies it and goes straight to
 * the clipboard. It is never in this component's state or the store's.
 */
export function SnapshotLinkRow({ destination }: { destination: Destination }) {
  const { getSnapshotLink, setSnapshotLinkPrivate, rotateSnapshotLink } = useDestinationsStore()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)
  const isPrivate = destination.privateLink

  const show = (result: SnapshotLinkResult) =>
    setNote({ text: result.message, bad: result.oldLinkStillWorks })

  // A refusal is recorded in the store's `error`, shown in the pane's banner, and
  // repeated here beside the button that was pressed, which is where it is read.
  const move = async (call: () => Promise<SnapshotLinkResult>) => {
    setConfirming(null)
    setBusy(true)
    setNote(null)
    try {
      show(await call())
    } catch (e) {
      setNote({ text: errMsg(e), bad: true })
    } finally {
      setBusy(false)
    }
  }

  const onCopied = (error: string | null) => setNote(error ? { text: error, bad: true } : null)

  const fetchLink = async () => (await getSnapshotLink(destination.id)).link

  return (
    <div className="flex flex-col gap-2 pb-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-text-secondary text-xs">Snapshot link</span>
        <Toggle
          label={`Private link for ${destination.name}`}
          checked={isPrivate}
          disabled={busy}
          onChange={() => setConfirming('mode')}
        />
        <span className="text-text-primary text-xs">{isPrivate ? 'Private link' : 'Public'}</span>
        <span className="ml-auto flex items-center gap-2">
          <CopyButton text={fetchLink} label="Copy link" onResult={onCopied} />
          {isPrivate && (
            <button
              disabled={busy}
              onClick={() => setConfirming('rotate')}
              className={QUIET_BUTTON}
              aria-label={`Rotate link for ${destination.name}`}
            >
              Rotate link
            </button>
          )}
        </span>
      </div>

      {confirming === 'mode' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-muted text-xs">
            {isPrivate
              ? 'Make the published snapshot public again? It is moved, which takes a few minutes, and the private link stops working.'
              : 'Move the published snapshot under a private link? It is moved, which takes a few minutes, and the address everyone uses now stops working.'}
          </span>
          <button
            disabled={busy}
            onClick={() => void move(() => setSnapshotLinkPrivate(destination.id, !isPrivate))}
            className={ACCENT_BUTTON}
          >
            Confirm switch
          </button>
          <button onClick={() => setConfirming(null)} className={QUIET_BUTTON}>
            Keep
          </button>
        </div>
      )}
      {confirming === 'rotate' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-muted text-xs">
            Everyone with the current link loses access. The snapshot is moved to a new one, which
            takes a few minutes.
          </span>
          <button
            disabled={busy}
            onClick={() => void move(() => rotateSnapshotLink(destination.id))}
            className={DANGER_BUTTON}
          >
            Confirm rotate
          </button>
          <button onClick={() => setConfirming(null)} className={QUIET_BUTTON}>
            Keep
          </button>
        </div>
      )}

      {busy && (
        <p role="status" className="text-text-muted text-xs">
          Moving the published snapshot. This can take a few minutes.
        </p>
      )}
      {note && !busy && (
        <p role="status" className={`text-xs ${note.bad ? 'text-danger' : 'text-success'}`}>
          {note.text}
        </p>
      )}

      <div className="text-text-muted text-1xs flex flex-col gap-0.5">
        <p>
          A private link is a shared secret, not access control: anyone holding it can pass it on,
          and rotating it is the only way to revoke it.
        </p>
        <p>
          R2&apos;s public buckets do not list their contents; another provider&apos;s might, which
          would expose the parts.
        </p>
        <p>
          For sign-in, put Cloudflare Access in front of the bucket&apos;s domain.{' '}
          <a
            href={ACCESS_TUTORIAL_URL}
            onClick={(e) => {
              e.preventDefault()
              openAccessTutorial()
            }}
            className="text-accent underline"
          >
            How to set it up
          </a>
        </p>
      </div>
    </div>
  )
}
