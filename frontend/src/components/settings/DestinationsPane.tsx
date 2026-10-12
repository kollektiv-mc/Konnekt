import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useDestinationsStore } from '../../stores/useDestinationsStore'
import type { Destination, DestinationTestResult } from '../../stores/useDestinationsStore'
import { SnapshotLinkRow } from './SnapshotLinkRow'
import { ACCENT_BUTTON, DANGER_BUTTON, QUIET_BUTTON, TEXT_INPUT } from './controls'

const SECTION = 'border-border-subtle border-b-hairline py-3'

/** A blank form. The region is what Cloudflare R2 wants; any other S3 store says its own. */
const BLANK: Destination = {
  id: '',
  name: '',
  endpoint: '',
  region: 'auto',
  bucket: '',
  prefix: '',
  publicBaseUrl: '',
  accessKeyId: '',
  secretSet: false,
  privateLink: false,
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-text-secondary text-xs">{label}</span>
      {children}
      {help && <span className="text-text-muted text-1xs">{help}</span>}
    </label>
  )
}

function TestVerdict({ result }: { result: DestinationTestResult }) {
  return (
    <p role="status" className={`text-xs ${result.ok ? 'text-success' : 'text-danger'}`}>
      {result.message}
    </p>
  )
}

interface EditorProps {
  initial: Destination
  onClose: () => void
}

/**
 * One destination's form. The secret is its own piece of state, typed here and
 * handed to the store as a separate argument: it is never part of the
 * destination object, never pre-filled, and cleared the moment a save lands.
 */
function DestinationEditor({ initial, onClose }: EditorProps) {
  const { save, remove, test } = useDestinationsStore()
  const [draft, setDraft] = useState<Destination>(initial)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<DestinationTestResult | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isNew = initial.id === ''

  const set = (patch: Partial<Destination>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setVerdict(null)
  }

  // A refusal is recorded in the store's `error`, shown in the pane's banner, so
  // the catch only keeps the rejection from going unhandled and the form open.
  const run = async (call: () => Promise<void>) => {
    setBusy(true)
    try {
      await call()
    } catch {
      /* shown in the banner */
    } finally {
      setBusy(false)
    }
  }

  const onSave = () =>
    run(async () => {
      await save(draft, secret)
      setSecret('')
      onClose()
    })

  const onTest = () =>
    run(async () => {
      setVerdict(await test(draft, secret))
    })

  const onDelete = () =>
    run(async () => {
      await remove(draft.id)
      setSecret('')
      onClose()
    })

  const needsSecret = !draft.secretSet && secret === ''
  const incomplete =
    draft.name.trim() === '' ||
    draft.endpoint.trim() === '' ||
    draft.bucket.trim() === '' ||
    draft.accessKeyId.trim() === ''

  return (
    <div className={SECTION}>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label="Name" help="What a scheduler graph calls this bucket.">
          <input
            aria-label="Name"
            value={draft.name}
            disabled={busy}
            onChange={(e) => set({ name: e.target.value })}
            className={TEXT_INPUT}
          />
        </Field>
        <Field label="Endpoint" help="The S3 address, host only.">
          <input
            aria-label="Endpoint"
            placeholder="https://<account>.r2.cloudflarestorage.com"
            value={draft.endpoint}
            disabled={busy}
            onChange={(e) => set({ endpoint: e.target.value })}
            className={TEXT_INPUT}
          />
        </Field>
        <Field label="Region" help="auto for Cloudflare R2.">
          <input
            aria-label="Region"
            value={draft.region}
            disabled={busy}
            onChange={(e) => set({ region: e.target.value })}
            className={TEXT_INPUT}
          />
        </Field>
        <Field label="Bucket">
          <input
            aria-label="Bucket"
            value={draft.bucket}
            disabled={busy}
            onChange={(e) => set({ bucket: e.target.value })}
            className={TEXT_INPUT}
          />
        </Field>
        <Field label="Prefix" help="Optional. Uploads go under this folder.">
          <input
            aria-label="Prefix"
            value={draft.prefix}
            disabled={busy}
            onChange={(e) => set({ prefix: e.target.value })}
            className={TEXT_INPUT}
          />
        </Field>
        <Field
          label="Public base URL"
          help="Optional. The custom domain the bucket is served from."
        >
          <input
            aria-label="Public base URL"
            placeholder="https://files.example.com"
            value={draft.publicBaseUrl}
            disabled={busy}
            onChange={(e) => set({ publicBaseUrl: e.target.value })}
            className={TEXT_INPUT}
          />
        </Field>
        <Field label="Access key ID">
          <input
            aria-label="Access key ID"
            autoComplete="off"
            value={draft.accessKeyId}
            disabled={busy}
            onChange={(e) => set({ accessKeyId: e.target.value })}
            className={TEXT_INPUT}
          />
        </Field>
        <Field
          label="Secret access key"
          help={
            draft.secretSet
              ? 'A secret is saved. Leave this blank to keep it.'
              : 'Stored on this computer, never shown again.'
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            aria-label="Secret access key"
            placeholder={draft.secretSet ? 'Saved' : ''}
            value={secret}
            disabled={busy}
            onChange={(e) => {
              setSecret(e.target.value)
              setVerdict(null)
            }}
            className={TEXT_INPUT}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          disabled={busy || incomplete || needsSecret}
          onClick={() => void onSave()}
          className={ACCENT_BUTTON}
        >
          Save
        </button>
        <button
          disabled={busy || incomplete || needsSecret}
          onClick={() => void onTest()}
          className={QUIET_BUTTON}
        >
          Test
        </button>
        <button disabled={busy} onClick={onClose} className={QUIET_BUTTON}>
          Cancel
        </button>
        {!isNew &&
          (confirmingDelete ? (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-text-muted text-xs">
                Delete this destination and its secret?
              </span>
              <button disabled={busy} onClick={() => void onDelete()} className={DANGER_BUTTON}>
                Confirm delete
              </button>
              <button
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
                className={QUIET_BUTTON}
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
              className={`${DANGER_BUTTON} ml-auto`}
            >
              Delete
            </button>
          ))}
      </div>
      {verdict && (
        <div className="mt-2">
          <TestVerdict result={verdict} />
        </div>
      )}
    </div>
  )
}

export function DestinationsPane() {
  const { destinations, loaded, loading, error, refresh } = useDestinationsStore()
  // The id being edited, '' for a new one, null for none. Keyed so switching
  // destinations remounts the form with a clean secret field.
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const current =
    editing === null ? null : editing === '' ? BLANK : destinations.find((d) => d.id === editing)

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

      <div className={SECTION}>
        <p className="text-text-muted text-xs">
          Buckets Konnekt can upload to, such as Cloudflare R2 or any S3-compatible store. The
          secret stays on this computer and is never shown again.
        </p>
      </div>

      {loaded && destinations.length === 0 && editing === null && (
        <p className="text-text-muted py-3 text-xs">No destination yet.</p>
      )}

      {destinations.map((d) =>
        editing === d.id && current ? (
          <DestinationEditor key={d.id} initial={current} onClose={() => setEditing(null)} />
        ) : (
          <div key={d.id} className="border-border-subtle border-b-hairline">
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-text-primary flex items-center gap-2 text-sm">
                  <span className="truncate">{d.name}</span>
                  {d.secretSet && (
                    <span className="bg-hover text-text-faint border-border-subtle border-hairline text-2xs shrink-0 rounded px-1.5 py-0.5">
                      secret saved
                    </span>
                  )}
                </span>
                <span className="text-text-muted text-1xs truncate font-mono">
                  {d.bucket} at {d.endpoint}
                </span>
              </div>
              <button
                disabled={loading}
                onClick={() => setEditing(d.id)}
                className={QUIET_BUTTON}
                aria-label={`Edit ${d.name}`}
              >
                Edit
              </button>
            </div>
            <SnapshotLinkRow destination={d} />
          </div>
        ),
      )}

      {editing === '' && current && (
        <DestinationEditor key="new" initial={current} onClose={() => setEditing(null)} />
      )}

      {editing === null && (
        <div className="py-3">
          <button onClick={() => setEditing('')} className={ACCENT_BUTTON}>
            Add destination
          </button>
        </div>
      )}
    </div>
  )
}
