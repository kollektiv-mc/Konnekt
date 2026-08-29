import { useEffect, useState } from 'react'
import { useLoaderStore } from '../../stores/useLoaderStore'
import { loaderLabel } from '../../lib/loaders'
import type { ServerConfig } from '../../types'

interface Props {
  config: ServerConfig
  /** Bumped by the manager after an update, to re-read the installed build. */
  refreshKey?: number
}

/**
 * The loader section of the server detail: which build is installed, which are
 * available, and the control that moves between them.
 */
export function LoaderPanel({ config, refreshKey = 0 }: Props) {
  const { status, versions, loading, error, load, openUpdate, phase, showDialog } = useLoaderStore()
  const [showBeta, setShowBeta] = useState(false)
  // The backend allows one loader update at a time, globally, and refuses a
  // second. Offering the button anyway is a promise it cannot keep.
  const updateRunning = phase === 'running'

  useEffect(() => {
    load(config.id).catch(() => {
      /* recorded in the store as `error` */
    })
  }, [load, config.id, refreshKey])

  const installed = status?.installedVersion ?? config.loaderVersion
  const shown = versions.filter((v) => showBeta || v.stable)
  const hasBetas = versions.some((v) => !v.stable)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-text-faint text-2xs tracking-wider uppercase">
          {loaderLabel(status?.loader || config.loader)} version
        </span>
        {hasBetas && status?.managed && (
          <label className="text-text-faint text-2xs flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showBeta}
              onChange={(e) => setShowBeta(e.target.checked)}
              className="accent-accent"
            />
            Show betas
          </label>
        )}
      </div>

      {/* An unmanaged loader says why in place of the list, so the panel never
          just shows an empty box. */}
      {status && !status.managed ? (
        <span className="text-text-muted text-xs">{status.reason}</span>
      ) : loading ? (
        <span className="text-text-faint text-xs">Checking for versions…</span>
      ) : error ? (
        <div className="flex flex-col gap-1">
          <span className="text-danger text-xs">{error}</span>
          <button
            onClick={() => void load(config.id).catch(() => {})}
            className="text-text-muted hover:text-text-primary self-start text-xs transition-colors"
          >
            Try again
          </button>
        </div>
      ) : shown.length === 0 ? (
        <span className="text-text-muted text-xs">
          No {showBeta ? '' : 'stable '}builds found for Minecraft{' '}
          {status?.mcVersion || config.mcVersion || '(unknown)'}.
        </span>
      ) : (
        <div className="border-border-subtle border-hairline max-h-40 overflow-y-auto rounded">
          {shown.map((v) => {
            const isInstalled = v.version === installed
            return (
              <div
                key={v.version}
                className="border-border-subtle hover:bg-hover border-b-hairline flex items-center justify-between gap-3 px-2.5 py-1.5 last:border-b-0"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={`truncate font-mono text-xs ${
                      isInstalled ? 'text-accent' : 'text-text-secondary'
                    }`}
                  >
                    {v.version}
                  </span>
                  {v.latest && <span className="text-text-faint text-2xs">latest</span>}
                  {!v.stable && <span className="text-warning text-2xs">beta</span>}
                </span>

                {isInstalled ? (
                  <span className="text-text-faint text-2xs shrink-0">installed</span>
                ) : (
                  <button
                    onClick={() => openUpdate(config, installed, v)}
                    disabled={updateRunning}
                    className="text-text-muted border-border-subtle hover:border-border-hover hover:text-text-primary border-hairline text-2xs shrink-0 rounded px-2 py-0.5 transition-colors disabled:cursor-default disabled:opacity-30 disabled:hover:border-inherit disabled:hover:text-inherit"
                  >
                    Update
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {updateRunning && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted text-2xs">An update is already running.</span>
          <button
            onClick={showDialog}
            className="text-accent hover:text-accent/80 text-2xs shrink-0 transition-colors"
          >
            Show it
          </button>
        </div>
      )}
    </div>
  )
}
