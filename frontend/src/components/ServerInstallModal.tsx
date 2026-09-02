import { AbortInstall, BrowseDirectory, InstallServer } from '../../wailsjs/go/main/App'
import { LOADER_LABELS } from '../lib/loaders'
import { useInstallStore } from '../stores/useInstallStore'
import { InstallLog } from './InstallLog'

export interface InstallerDetails {
  jarPath: string
  loader: string
  version: string
  mcVersion: string
}

export interface InstallResult {
  targetDir: string
  mcVersion: string
  loader: string
  /** The loader build the installer laid down, e.g. "21.1.72". */
  loaderVersion: string
}

function describe({ loader, version, mcVersion }: InstallerDetails): string {
  const name = LOADER_LABELS[loader] ?? 'Forge/NeoForge'
  const ver = version ? ` ${version}` : ''
  const mc = mcVersion ? ` for Minecraft ${mcVersion}` : ''
  return `${name}${ver} installer${mc}.`
}

/**
 * A Forge/NeoForge download installs a server rather than being one. This
 * offers to run it properly (`--installServer` into a directory the user picks)
 * instead of letting Konnekt launch the installer as if it were a jar.
 *
 * A view over `useInstallStore` and nothing more. It used to hold the phase,
 * the log and the error itself, which made its own promise — that closing never
 * blocks — false in the way that mattered: the install kept running and every
 * trace of it was gone. Now closing hides, the sidebar's process row brings it
 * back, and App owns the event listeners.
 *
 * Rendered from App, after <main>, so it sits above a maximized tile.
 */
export function ServerInstallModal() {
  const { installer, targetDir, phase, log, error, setTargetDir, begin, hide, fail } =
    useInstallStore()

  // openFor always sets one; this is the "never happens" guard that keeps the
  // rest of the component free of optional chaining.
  if (!installer) return null

  const running = phase === 'running'
  const done = phase === 'done'

  const browse = async () => {
    const path = await BrowseDirectory().catch(() => '')
    if (path) setTargetDir(path)
  }

  const install = async () => {
    if (!targetDir) return
    begin()
    try {
      await InstallServer(installer.jarPath, targetDir)
    } catch (err) {
      fail(String(err))
    }
  }

  return (
    <div className="z-dialog fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="bg-canvas border-border-subtle border-hairline flex w-[28rem] flex-col gap-3 rounded-xl p-5 font-mono">
        <div className="flex items-center gap-2.5">
          <span className="text-warning text-sm font-bold">[i]</span>
          <span className="font-title text-text-primary text-sm font-medium">
            Installer detected
          </span>
        </div>

        <p className="text-text-secondary text-xs leading-relaxed">
          {describe(installer)} Pick an empty folder to install into.
        </p>

        <div className="flex gap-1">
          <input
            type="text"
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            placeholder="Install directory"
            disabled={running || done}
            className="bg-surface border-border-subtle text-text-primary placeholder-text-faint focus:border-border-hover border-hairline min-w-0 flex-1 rounded px-2 py-1 font-mono text-xs transition-colors outline-none disabled:opacity-40"
          />
          <button
            type="button"
            onClick={browse}
            disabled={running || done}
            className="border-border-subtle text-text-muted hover:border-border-hover hover:text-text-primary border-hairline shrink-0 rounded px-2 py-1 font-mono text-xs transition-colors disabled:opacity-40"
            title="Browse"
          >
            …
          </button>
        </div>

        <InstallLog lines={log} />

        {phase === 'failed' && <span className="text-danger text-xs">{error}</span>}
        {done && <span className="text-accent text-xs">Install complete.</span>}

        {running && (
          <span className="text-text-muted text-2xs">
            Closing this does not stop the install. The sidebar keeps it, and clicking there brings
            this back.
          </span>
        )}

        <div className="border-border-subtle border-t-hairline flex gap-2 pt-2">
          {done ? (
            // The add-server form is already open behind this, filled in by the
            // install:finished listener, so finishing here is just a dismissal.
            <button
              onClick={hide}
              className="text-accent border-accent/30 hover:bg-accent/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors"
            >
              Add server
            </button>
          ) : running ? (
            <button
              onClick={() => void AbortInstall().catch(() => {})}
              className="text-danger border-danger/30 hover:bg-danger/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors"
            >
              Abort install
            </button>
          ) : (
            <button
              onClick={install}
              disabled={!targetDir}
              className="text-accent border-accent/30 hover:bg-accent/10 border-hairline flex-1 rounded py-1.5 text-xs transition-colors disabled:opacity-40"
            >
              {phase === 'failed' ? 'Retry install' : 'Install server'}
            </button>
          )}
          <button
            onClick={hide}
            className="text-text-faint hover:text-text-secondary px-3 py-1.5 text-xs transition-colors"
          >
            {done ? 'Not now' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
