import { useEffect, useState } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { ServerManager, NEW_SERVER } from './ServerManager'
import type { InstallResult } from './ServerInstallModal'
import { ServerRow } from './ServerRow'
import { EVENTS } from '../lib/constants'

/**
 * The sidebar's server switcher.
 *
 * Selecting, and nothing more: adding and editing moved into `ServerManager`,
 * which has room for them. What stays here is the disconnect confirm (the ×
 * lives on the row) and the install-finished listener, which is owned at this
 * level deliberately — see its comment.
 */
export function ServerSelector() {
  const { configs, activeId, error, loadConfigs, deleteConfig, setActiveId } =
    useServerConfigStore()
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [managerSelection, setManagerSelection] = useState<string>(NEW_SERVER)
  // What a just-finished install told us, so Save records the right loader and
  // MC version instead of waiting for the first run to detect them.
  const [installed, setInstalled] = useState<InstallResult | null>(null)

  useEffect(() => {
    loadConfigs().catch(console.error)
  }, [loadConfigs])

  // Owned here rather than in the install or manager modals so closing either
  // one mid-install still yields a configured server when the installer
  // finishes: this component is mounted for the app's whole life, and reopens
  // the manager on the add form with the result already filled in.
  useEffect(() => {
    let off: (() => void) | undefined
    try {
      off = EventsOn(
        EVENTS.INSTALL_FINISHED,
        (d?: {
          targetDir?: string
          mcVersion?: string
          loader?: string
          loaderVersion?: string
        }) => {
          if (!d?.targetDir) return
          setInstalled({
            targetDir: d.targetDir,
            mcVersion: d.mcVersion ?? '',
            loader: d.loader ?? '',
            loaderVersion: d.loaderVersion ?? '',
          })
          setManagerSelection(NEW_SERVER)
          setManagerOpen(true)
        },
      )
    } catch {
      /* non-Wails context */
    }
    return () => {
      try {
        off?.()
      } catch {
        /* teardown no-op */
      }
    }
  }, [])

  const openManager = (selection: string) => {
    setManagerSelection(selection)
    setManagerOpen(true)
  }

  const handleDisconnect = async (id: string) => {
    try {
      await deleteConfig(id)
    } catch {
      // Leave the confirm dialog open — the server is still connected.
      return
    }
    setPendingDisconnect(null)
  }

  const selectServer = (id: string) => {
    // Selecting is idempotent and re-selectable, so there is nothing to revert;
    // `error` renders below the list.
    setActiveId(id).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="font-title text-text-muted text-xs font-medium tracking-wider uppercase">
          Servers
        </span>
        <button
          onClick={() => openManager(activeId || NEW_SERVER)}
          className="text-text-faint hover:text-text-primary flex h-5 w-5 items-center justify-center rounded text-xs transition-colors"
          title="Manage servers"
        >
          ⤢
        </button>
      </div>

      {configs.map((cfg) => (
        <ServerRow
          key={cfg.id}
          cfg={cfg}
          active={cfg.id === activeId}
          onSelect={() => selectServer(cfg.id)}
          onEdit={() => openManager(cfg.id)}
          onDisconnect={() => setPendingDisconnect(cfg.id)}
        />
      ))}

      {/* Sits outside the list so a refused delete or select is visible too. */}
      {error && (
        <div
          role="alert"
          className="text-danger border-danger/20 bg-danger/10 border-hairline mt-1 rounded px-2 py-1 font-mono text-xs"
        >
          {error}
        </div>
      )}

      <button
        onClick={() => openManager(NEW_SERVER)}
        className="text-text-faint hover:bg-hover hover:text-text-secondary mt-1 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors"
      >
        <span>+</span>
        <span>Add server</span>
      </button>

      <ServerManager
        open={managerOpen}
        initialSelection={managerSelection}
        installed={installed}
        onInstalledConsumed={() => setInstalled(null)}
        onClose={() => setManagerOpen(false)}
      />

      {pendingDisconnect &&
        (() => {
          const name = configs.find((c) => c.id === pendingDisconnect)?.name ?? 'this server'
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.6)]"
              onClick={() => setPendingDisconnect(null)}
            >
              <div
                className="bg-canvas border-border-subtle border-hairline flex w-72 flex-col gap-4 rounded-xl p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-text-primary text-sm font-medium">Disconnect server?</span>
                  <span className="text-text-muted text-xs">
                    <span className="text-text-secondary">{name}</span> will be removed from
                    Konnekt. Your server files and data will not be affected.
                  </span>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setPendingDisconnect(null)}
                    className="text-text-muted hover:text-text-primary rounded px-3 py-1.5 text-xs transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDisconnect(pendingDisconnect)}
                    className="border-danger/20 bg-danger/10 text-danger hover:bg-danger/20 border-hairline rounded px-3 py-1.5 text-xs transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
