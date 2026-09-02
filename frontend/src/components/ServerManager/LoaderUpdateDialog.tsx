import { useState } from 'react'
import { useLoaderStore } from '../../stores/useLoaderStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { InstallLog } from '../InstallLog'

/**
 * The confirm-and-watch dialog for an in-place loader update.
 *
 * It names the files that get rewritten rather than saying "this may modify
 * your server": those three are exactly what the backend snapshots, so the
 * warning and the safety net describe the same thing.
 *
 * A view over `useLoaderStore`, rendered from App rather than from the panel
 * that starts the update. That is what makes closing free — the update keeps
 * running, the log keeps filling, and the sidebar's process row opens this
 * again — and what puts it above a maximized tile.
 *
 * **A job outranks a pending selection.** A running update is the thing the
 * sidebar row points at, so if one exists this shows it whatever the panel was
 * last clicked on. Picking a second version while one runs used to overwrite
 * the running job here, which is how the row came to open a refusal instead of
 * the update it belonged to.
 */
export function LoaderUpdateDialog() {
  const {
    phase,
    log,
    updateError,
    rolledBack,
    jobServerId,
    jobFrom,
    jobTarget,
    pending,
    startError,
    versions,
    startUpdate,
    openUpdate,
    hideDialog,
  } = useLoaderStore()
  const configs = useServerConfigStore((s) => s.configs)
  const [fullBackup, setFullBackup] = useState(false)

  const hasJob = phase !== 'idle'
  const running = phase === 'running'
  const done = phase === 'done'
  const failed = phase === 'failed'

  // Nothing to show: no job, and no version picked.
  if (!hasJob && !pending) return null

  // One source for the name, so a job recovered from an event alone still has
  // one — the event carries an id, not a name.
  const serverId = hasJob ? jobServerId : pending!.serverId
  const serverName = configs.find((c) => c.id === serverId)?.name ?? 'This server'
  const version = hasJob ? jobTarget : pending!.target.version
  const from = hasJob ? jobFrom : pending!.from

  const begin = () => {
    if (!pending) return
    // The store records the refusal and the dialog renders it; rethrowing past
    // a click handler would only surface as an unhandled rejection.
    startUpdate(pending.serverId, pending.target.version, fullBackup).catch(() => {})
  }

  // Retrying turns the failed job back into a pending selection, so it goes
  // through the same confirm as any other start. Needs the full LoaderVersion,
  // which the job only knows as a string — absent if the list has not loaded,
  // in which case the panel is the way back.
  const retryTarget = failed ? versions.find((v) => v.version === jobTarget) : undefined
  const retry = () => {
    if (retryTarget) openUpdate({ id: jobServerId, name: serverName }, jobFrom, retryTarget)
  }

  return (
    <div className="z-dialog fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="bg-canvas border-border-subtle border-hairline flex w-[30rem] flex-col gap-3 rounded-xl p-5 font-mono">
        <div className="flex items-center gap-2.5">
          <span className="text-warning text-sm font-bold">[!]</span>
          <span className="font-title text-text-primary text-sm font-medium">
            {done ? 'Loader updated' : failed ? 'Update failed' : 'Update the loader'}
          </span>
        </div>

        {!hasJob && pending && (
          <>
            <p className="text-text-secondary text-xs leading-relaxed">
              {serverName} will move from{' '}
              <span className="text-text-primary">{from || 'an unknown build'}</span> to{' '}
              <span className="text-accent">{version}</span>
              {!pending.target.stable && <span className="text-warning"> (beta)</span>}.
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
            {serverName} is updating from{' '}
            <span className="text-text-primary">{from || 'an unknown build'}</span> to{' '}
            <span className="text-accent">{version}</span>. Closing this does not stop it: the
            sidebar keeps the update, and clicking there brings this back.
          </p>
        )}

        <InstallLog lines={log} maxHeight="max-h-56" />

        {/* A refused start, not an outcome — it sits beside whatever else is on
            screen rather than replacing it. */}
        {startError && (
          <span className="text-warning text-2xs break-words">
            Could not start another update: {startError}
          </span>
        )}

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
            Now on {version}. Start the server to pick it up.
          </span>
        )}

        <div className="border-border-subtle border-t-hairline flex gap-2 pt-2">
          {!hasJob && pending && (
            <button
              onClick={begin}
              disabled={pending.starting}
              className="text-accent border-accent/30 hover:bg-accent/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors disabled:opacity-40"
            >
              {pending.starting ? 'Starting…' : `Update to ${version}`}
            </button>
          )}
          {retryTarget && (
            <button
              onClick={retry}
              className="text-accent border-accent/30 hover:bg-accent/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors"
            >
              Try again
            </button>
          )}
          {/* Never disabled. The copy above says closing is free, and with the
              state in the store and a process row to reopen from, it is. */}
          <button
            onClick={hideDialog}
            className="text-text-faint hover:text-text-secondary px-3 py-1.5 text-xs transition-colors"
          >
            {done ? 'Done' : !hasJob ? 'Cancel' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
