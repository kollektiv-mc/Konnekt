import { useEffect, useRef, useState } from 'react'
import { useInstallStore } from '../../stores/useInstallStore'
import { useLoaderStore } from '../../stores/useLoaderStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useUiStore } from '../../stores/useUiStore'
import { IconButton } from '../ui/IconButton'
import { CloseIcon } from '../ui/icons'
import { LoaderPanel } from './LoaderPanel'
import { ServerDetail } from './ServerDetail'
import { ServerEditForm } from './ServerEditForm'
import { ServerList, NEW_SERVER } from './ServerList'

/**
 * The server manager: every configured server, what each one actually is on
 * disk, and the editor for it.
 *
 * The sidebar remains the quick switcher. Editing lives here because the sidebar
 * is narrow — 192px by default, and never more than 30% of the window — which is
 * what made the old inline form cramped, and because one editor cannot drift
 * from itself. Disconnecting lives here for a different reason: as a second icon
 * on a sidebar row it was one click from the control that merely selects a
 * server, and said nothing about which server it would remove.
 *
 * Rendered from App, after <main>, and that position is load-bearing: a fixed
 * overlay in the sidebar carries the same z-50 as the maximized-tile overlay
 * but comes earlier in the document, so the tile won and the manager opened
 * underneath it. SettingsModal has always been rendered here for the same
 * reason.
 */
export function ServerManager() {
  const { configs, activeId, error, clearError, setActiveId } = useServerConfigStore()
  const {
    serverManagerOpen: open,
    serverManagerSelection,
    closeServerManager,
    setPendingDisconnect,
  } = useUiStore()
  const installOpen = useInstallStore((s) => s.open)
  const installResult = useInstallStore((s) => s.result)
  const clearResult = useInstallStore((s) => s.clearResult)
  const loaderDialogOpen = useLoaderStore((s) => s.dialogOpen)
  const loaderPhase = useLoaderStore((s) => s.phase)

  const [selected, setSelected] = useState(serverManagerSelection)
  // Bumped after a save or a finished update, so the detail and loader panels
  // re-read the install from disk.
  const [refreshKey, setRefreshKey] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Follow the caller's choice each time the modal is opened, not on every
  // render — the user's own clicks in the list own the selection while it is up.
  useEffect(() => {
    if (open) setSelected(serverManagerSelection)
  }, [open, serverManagerSelection])

  // A stale message from a previous visit would read as a failure of whatever
  // the user is about to touch.
  useEffect(() => {
    if (open) clearError()
  }, [open, clearError])

  // A finished loader update changes what is installed, which both panels show.
  useEffect(() => {
    if (loaderPhase === 'done') setRefreshKey(Date.now())
  }, [loaderPhase])

  // A disconnect performed from in here leaves `selected` pointing at a config
  // that no longer exists, which the render below reads as the add-server case
  // — so confirming a removal would silently turn the panel into a blank new
  // server form. Fall back to whichever server is active instead.
  useEffect(() => {
    if (!open || selected === NEW_SERVER) return
    if (!configs.some((c) => c.id === selected)) setSelected(activeId || NEW_SERVER)
  }, [open, selected, configs, activeId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Both job dialogs are siblings of this modal rather than children, so
      // without this Escape would close the manager out from under an open one.
      if (e.key === 'Escape' && !installOpen && !loaderDialogOpen) closeServerManager()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeServerManager, installOpen, loaderDialogOpen])

  if (!open) return null

  const current = configs.find((c) => c.id === selected) ?? null
  const isNew = selected === NEW_SERVER || !current

  return (
    <div
      ref={overlayRef}
      className="modal-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.65)]"
      onClick={(e) => {
        if (e.target === overlayRef.current) closeServerManager()
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
            <IconButton onClick={closeServerManager} title="Close">
              <CloseIcon />
            </IconButton>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!isNew && (
              <div className="mb-5 flex flex-col gap-5">
                <ServerDetail config={current} refreshKey={refreshKey} />
                <LoaderPanel config={current} refreshKey={refreshKey} />
                <div className="flex items-center gap-2">
                  {current.id !== activeId && (
                    <button
                      onClick={() => void setActiveId(current.id).catch(() => {})}
                      className="text-text-muted border-border-subtle hover:border-border-hover hover:text-text-primary border-hairline rounded px-2.5 py-1 text-xs transition-colors"
                    >
                      Make active
                    </button>
                  )}
                  {/* Raises the confirm rather than deleting. That dialog is a
                      sibling of this modal in App, so it lands on top of it. */}
                  <button
                    onClick={() => setPendingDisconnect(current.id)}
                    className="text-text-muted border-border-subtle hover:border-danger/40 hover:text-danger border-hairline rounded px-2.5 py-1 text-xs transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
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
              installed={isNew ? installResult : null}
              submitLabel={isNew ? 'Add server' : 'Save'}
              onSaved={(cfg) => {
                setRefreshKey(Date.now())
                if (isNew) {
                  setSelected(cfg.id)
                  if (installResult) clearResult()
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export { NEW_SERVER }
