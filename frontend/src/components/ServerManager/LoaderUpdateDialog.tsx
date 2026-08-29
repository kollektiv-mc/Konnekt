import { useState } from 'react'
import { useLoaderStore } from '../../stores/useLoaderStore'
import type { LoaderVersion } from '../../stores/useLoaderStore'
import { InstallLog } from '../InstallLog'

interface Props {
  serverId: string
  serverName: string
  /** The build currently installed, for the "from → to" line. */
  from: string
  target: LoaderVersion
  onClose: () => void
}

/**
 * The confirm-and-watch dialog for an in-place loader update.
 *
 * It names the files that get rewritten rather than saying "this may modify
 * your server": those three are exactly what the backend snapshots, so the
 * warning and the safety net describe the same thing.
 */
export function LoaderUpdateDialog({ serverId, serverName, from, target, onClose }: Props) {
  const { phase, log, updateError, rolledBack, startUpdate, reset } = useLoaderStore()
  const [fullBackup, setFullBackup] = useState(false)

  const running = phase === 'running'
  const done = phase === 'done'
  const failed = phase === 'failed'

  const begin = () => {
    // The store records the refusal and the dialog renders it; rethrowing past
    // a click handler would only surface as an unhandled rejection.
    startUpdate(serverId, target.version, fullBackup).catch(() => {})
  }

  const close = () => {
    reset()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-canvas border-border-subtle border-hairline flex w-[30rem] flex-col gap-3 rounded-xl p-5 font-mono">
        <div className="flex items-center gap-2.5">
          <span className="text-warning text-sm font-bold">[!]</span>
          <span className="font-title text-text-primary text-sm font-semibold">
            {done ? 'Loader updated' : failed ? 'Update failed' : 'Update the loader'}
          </span>
        </div>

        {phase === 'idle' && (
          <>
            <p className="text-text-secondary text-xs leading-relaxed">
              {serverName} will move from{' '}
              <span className="text-text-primary">{from || 'an unknown build'}</span> to{' '}
              <span className="text-accent">{target.version}</span>
              {!target.stable && <span className="text-warning"> (beta)</span>}.
            </p>
            <p className="text-text-muted text-2xs leading-relaxed">
              This runs the official installer in the server folder. It rewrites{' '}
              <span className="text-text-secondary">run.sh</span>,{' '}
              <span className="text-text-secondary">run.bat</span> and{' '}
              <span className="text-text-secondary">user_jvm_args.txt</span>, and adds a new
              libraries folder. Konnekt copies those three files first and puts them back if the
              install fails. Your worlds, mods and configs are not touched.
            </p>

            <label className="text-text-secondary flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={fullBackup}
                onChange={(e) => setFullBackup(e.target.checked)}
                className="accent-accent mt-0.5"
              />
              <span>
                Back up the whole server first
                <span className="text-text-faint text-2xs block">
                  Includes worlds, so it can take a while on a large server.
                </span>
              </span>
            </label>
          </>
        )}

        {running && (
          <p className="text-text-secondary text-xs">
            Updating to {target.version}. Leaving this open is not required.
          </p>
        )}

        <InstallLog lines={log} maxHeight="max-h-56" />

        {failed && (
          <div className="flex flex-col gap-1">
            <span className="text-danger text-xs break-words">{updateError}</span>
            <span className="text-text-muted text-2xs">
              {rolledBack
                ? 'The previous launch files were restored, so the server still starts on ' +
                  (from || 'its previous build') +
                  '.'
                : 'Nothing was changed in the server folder.'}
            </span>
          </div>
        )}

        {done && (
          <span className="text-accent text-xs">
            Now on {target.version}. Start the server to pick it up.
          </span>
        )}

        <div className="border-border-subtle border-t-hairline flex gap-2 pt-2">
          {phase === 'idle' && (
            <button
              onClick={begin}
              className="text-accent border-accent/30 hover:bg-accent/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors"
            >
              Update to {target.version}
            </button>
          )}
          {failed && (
            <button
              onClick={begin}
              className="text-accent border-accent/30 hover:bg-accent/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors"
            >
              Try again
            </button>
          )}
          <button
            onClick={close}
            disabled={running}
            className="text-text-faint hover:text-text-secondary px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
          >
            {done ? 'Done' : phase === 'idle' ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
