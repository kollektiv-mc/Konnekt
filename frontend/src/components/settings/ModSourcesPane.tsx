import { useCallback, useEffect, useState } from 'react'
import {
  ModClearCurseForgeKey,
  ModCurseForgeStatus,
  ModSetCurseForgeKey,
} from '../../../wailsjs/go/main/App'
import type { models } from '../../../wailsjs/go/models'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'
import { errMsg, readOr } from '../../lib/ipc'
import { ACCENT_BUTTON, DANGER_BUTTON, QUIET_BUTTON, TEXT_INPUT } from './controls'

// CurseForge's own page on applying for an API key.
const KEY_HELP_URL =
  // aislop-ignore-next-line ai-slop/hardcoded-url -- the canonical help page, opened in the system browser
  'https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key'

function statusNote(status: models.CurseForgeStatus | null): string {
  if (!status) return 'Not set'
  if (status.keySet) return 'Set'
  if (status.builtIn) return 'Using Konnekt’s key'
  return 'Not set'
}

/**
 * The CurseForge API key. Typed here and handed to Go, which checks it
 * against CurseForge before saving: it is never read back, never pre-filled,
 * and cleared from the field the moment a save lands. Host-only, like a
 * bucket's credential: a browser on Remote Access cannot reach either call.
 */
export function ModSourcesPane() {
  const [status, setStatus] = useState<models.CurseForgeStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStatus(await readOr(() => ModCurseForgeStatus(), null))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (call: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await call()
      await load()
    } catch (e: unknown) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const onSave = () =>
    run(async () => {
      await ModSetCurseForgeKey(key)
      setKey('')
    })

  const onRemove = () => run(() => ModClearCurseForgeKey())

  return (
    <div>
      <div className="border-border-subtle border-b-hairline flex flex-col gap-2 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-text-primary text-sm">CurseForge API key</span>
            <span className="text-text-muted text-xs">{statusNote(status)}</span>
          </div>
          <button
            type="button"
            className={QUIET_BUTTON}
            onClick={() => {
              try {
                BrowserOpenURL(KEY_HELP_URL)
              } catch {
                /* non-Wails context (e.g. pnpm dev preview) */
              }
            }}
          >
            How to get a key ↗
          </button>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim() && !busy) void onSave()
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="CurseForge API key"
            placeholder={status?.keySet ? 'Paste a new key to replace it' : 'Paste your key'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={`${TEXT_INPUT} flex-1 font-mono`}
          />
          <button type="submit" disabled={busy || !key.trim()} className={ACCENT_BUTTON}>
            {busy ? 'Checking…' : 'Save'}
          </button>
          {status?.keySet && (
            <button type="button" disabled={busy} onClick={onRemove} className={DANGER_BUTTON}>
              Remove
            </button>
          )}
        </form>
        {error && (
          <p role="alert" className="text-danger text-xs break-words">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
