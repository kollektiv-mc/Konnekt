import { useEffect, useRef, useState } from 'react'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { ServerInstallModal } from '../ServerInstallModal'
import type { InstallerDetails, InstallResult } from '../ServerInstallModal'
import { ServerDetail } from './ServerDetail'
import { ServerEditForm } from './ServerEditForm'
import { ServerList, NEW_SERVER } from './ServerList'

interface Props {
  open: boolean
  /** Which server to open on: a config id, or NEW_SERVER for the add form. */
  initialSelection: string
  /**
   * A just-finished install, owned by `ServerSelector` so it survives this
   * modal being closed mid-install. Passed down for the form to pre-fill from.
   */
  installed: InstallResult | null
  /** Called once the install result has been saved into a config. */
  onInstalledConsumed: () => void
  onClose: () => void
}

/**
 * The server manager: every configured server, what each one actually is on
 * disk, and the editor for it.
 *
 * The sidebar remains the quick switcher. Editing lives here because the
 * sidebar is 12rem wide, which is what made the old inline form cramped, and
 * because one editor cannot drift from itself.
 */
export function ServerManager({
  open,
  initialSelection,
  installed,
  onInstalledConsumed,
  onClose,
}: Props) {
  const { configs, activeId, error, clearError, setActiveId } = useServerConfigStore()
  const [selected, setSelected] = useState(initialSelection)
  const [installer, setInstaller] = useState<InstallerDetails | null>(null)
  // Bumped after a save so the detail panel re-reads the install from disk.
  const [savedAt, setSavedAt] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Follow the caller's choice each time the modal is opened, not on every
  // render — the user's own clicks in the list own the selection while it is up.
  useEffect(() => {
    if (open) setSelected(initialSelection)
  }, [open, initialSelection])

  // A stale message from a previous visit would read as a failure of whatever
  // the user is about to touch.
  useEffect(() => {
    if (open) clearError()
  }, [open, clearError])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // The install modal sits on top and owns Escape while it is up.
      if (e.key === 'Escape' && !installer) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, installer])

  if (!open) return null

  const current = configs.find((c) => c.id === selected) ?? null
  const isNew = selected === NEW_SERVER || !current

  // The install modal covers this one, so it finishes the job itself rather
  // than pointing at a Save button the user cannot see behind it.
  const addInstalledServer = () => {
    setInstaller(null)
    setSelected(NEW_SERVER)
  }

  return (
    <div
      ref={overlayRef}
      className="modal-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.65)]"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div className="modal-panel-in bg-canvas border-border-subtle border-hairline flex h-[480px] w-[680px] overflow-hidden rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        <ServerList
          configs={configs}
          selected={isNew ? NEW_SERVER : selected}
          activeId={activeId}
          onSelect={setSelected}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-border-subtle border-b-hairline flex shrink-0 items-center justify-between px-5 py-3">
            <span className="font-title text-text-primary truncate text-sm font-semibold">
              {isNew ? 'Add a server' : current.name}
            </span>
            <button
              onClick={onClose}
              className="text-text-faint hover:text-text-primary flex h-6 w-6 items-center justify-center rounded text-sm transition-colors"
              title="Close"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!isNew && (
              <div className="mb-5">
                <ServerDetail config={current} refreshKey={savedAt} />
                {current.id !== activeId && (
                  <button
                    onClick={() => void setActiveId(current.id).catch(() => {})}
                    className="text-text-muted border-border-subtle hover:border-border-hover hover:text-text-primary border-hairline mt-3 rounded px-2.5 py-1 text-xs transition-colors"
                  >
                    Make active
                  </button>
                )}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="text-danger border-danger/20 bg-danger/10 border-hairline mb-4 rounded px-2 py-1.5 font-mono text-xs"
              >
                {error}
              </div>
            )}

            <ServerEditForm
              // Remount on selection change so the form re-seeds cleanly.
              key={isNew ? NEW_SERVER : current.id}
              config={isNew ? null : current}
              installed={isNew ? installed : null}
              onInstallerDetected={setInstaller}
              submitLabel={isNew ? 'Add server' : 'Save'}
              onSaved={(cfg) => {
                setSavedAt(Date.now())
                if (isNew) {
                  setSelected(cfg.id)
                  if (installed) onInstalledConsumed()
                }
              }}
            />
          </div>
        </div>
      </div>

      {installer && (
        <ServerInstallModal
          installer={installer}
          suggestedDir={isNew ? '' : current.workingDir}
          onAddServer={addInstalledServer}
          onClose={() => setInstaller(null)}
        />
      )}
    </div>
  )
}

export { NEW_SERVER }
