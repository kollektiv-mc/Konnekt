import { useEffect, useRef, useState } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { AbortInstall, BrowseDirectory, InstallServer } from '../../wailsjs/go/main/App'
import { EVENTS } from '../lib/constants'

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
}

interface Props {
  installer: InstallerDetails
  /** Working dir already typed into the form, used to pre-fill the target. */
  suggestedDir?: string
  /** Adds the installed server to the sidebar and closes. */
  onAddServer: () => void
  onClose: () => void
}

const LOADER_LABELS: Record<string, string> = { neoforge: 'NeoForge', forge: 'Forge' }

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
 * Closing never blocks: the install keeps going and stays visible as the
 * sidebar process chip, and ServerSelector owns the finish event so a closed
 * modal still yields a configured server.
 */
export function ServerInstallModal({ installer, suggestedDir, onAddServer, onClose }: Props) {
  const [targetDir, setTargetDir] = useState(suggestedDir ?? '')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offs: Array<() => void> = []
    try {
      offs.push(
        EventsOn(EVENTS.INSTALL_LOG, (d?: { line?: string }) => {
          setLog((l) => [...l.slice(-499), d?.line ?? ''])
        }),
      )
      // ServerSelector owns INSTALL_FINISHED — it has to survive this modal
      // being closed mid-install. Here we only reflect it in the local phase.
      offs.push(EventsOn(EVENTS.INSTALL_FINISHED, () => setPhase('done')))
      offs.push(
        EventsOn(EVENTS.INSTALL_FAILED, (d?: { error?: string }) => {
          setPhase('failed')
          setError(d?.error ?? 'The installer failed.')
        }),
      )
    } catch {
      /* non-Wails context */
    }
    return () => {
      for (const off of offs) {
        try {
          off()
        } catch {
          /* teardown no-op */
        }
      }
    }
  }, [])

  // Follow the tail as the installer talks.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  const browse = async () => {
    const path = await BrowseDirectory().catch(() => '')
    if (path) setTargetDir(path)
  }

  const install = async () => {
    if (!targetDir) return
    setPhase('running')
    setError('')
    setLog([])
    try {
      await InstallServer(installer.jarPath, targetDir)
    } catch (err) {
      setPhase('failed')
      setError(String(err))
    }
  }

  const running = phase === 'running'
  const done = phase === 'done'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-canvas border-border-subtle flex w-[28rem] flex-col gap-3 rounded-xl border-[0.5px] p-5 font-mono">
        <div className="flex items-center gap-2.5">
          <span className="text-warning text-sm font-bold">[i]</span>
          <span className="font-title text-text-primary text-sm font-semibold">
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
            className="bg-surface border-border-subtle text-text-primary placeholder-text-faint focus:border-border-hover min-w-0 flex-1 rounded border-[0.5px] px-2 py-1 font-mono text-xs transition-colors outline-none disabled:opacity-40"
          />
          <button
            type="button"
            onClick={browse}
            disabled={running || done}
            className="border-border-subtle text-text-muted hover:border-border-hover hover:text-text-primary shrink-0 rounded border-[0.5px] px-2 py-1 font-mono text-xs transition-colors disabled:opacity-40"
            title="Browse"
          >
            …
          </button>
        </div>

        {log.length > 0 && (
          <div
            ref={logRef}
            className="border-border-subtle bg-surface max-h-40 overflow-y-auto rounded border-[0.5px] p-2"
          >
            {log.map((line, i) => (
              <div key={i} className="text-text-muted text-2xs leading-relaxed break-all">
                {line}
              </div>
            ))}
          </div>
        )}

        {phase === 'failed' && <span className="text-danger text-xs">{error}</span>}
        {done && <span className="text-accent text-xs">Install complete.</span>}

        <div className="border-border-subtle flex gap-2 border-t-[0.5px] pt-2">
          {done ? (
            <button
              onClick={onAddServer}
              className="text-accent border-accent/30 hover:bg-accent/10 flex-1 rounded border-[0.5px] py-1.5 text-xs transition-colors"
            >
              Add server
            </button>
          ) : running ? (
            <button
              onClick={() => void AbortInstall().catch(() => {})}
              className="text-danger border-danger/30 hover:bg-danger/10 flex-1 rounded border-[0.5px] py-1.5 text-xs transition-colors"
            >
              Abort install
            </button>
          ) : (
            <button
              onClick={install}
              disabled={!targetDir}
              className="text-accent border-accent/30 hover:bg-accent/10 flex-1 rounded border-[0.5px] py-1.5 text-xs transition-colors disabled:opacity-40"
            >
              {phase === 'failed' ? 'Retry install' : 'Install server'}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-text-faint hover:text-text-secondary px-3 py-1.5 text-xs transition-colors"
          >
            {done ? 'Not now' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
