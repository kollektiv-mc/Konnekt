import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'

/**
 * Confirms removing a server from Konnekt.
 *
 * Raised from the server manager, and rendered from App rather than inside it:
 * a fixed overlay nested in another overlay's subtree cannot escape it, and
 * this has to sit above the manager (z-50) that opens it. Before the manager
 * existed the same call was raised from the sidebar, where an overlay carrying
 * the same z-50 as the maximized-tile overlay lost the tie on document order
 * and opened underneath an open tile.
 */
export function DisconnectConfirm() {
  const { configs, deleteConfig } = useServerConfigStore()
  const { pendingDisconnect, setPendingDisconnect } = useUiStore()

  if (!pendingDisconnect) return null

  const name = configs.find((c) => c.id === pendingDisconnect)?.name ?? 'this server'

  const confirm = async () => {
    try {
      await deleteConfig(pendingDisconnect)
    } catch {
      // Leave the dialog open — the server is still connected, and the store's
      // `error` renders under the sidebar list.
      return
    }
    setPendingDisconnect(null)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(0,0,0,0.6)]"
      onClick={() => setPendingDisconnect(null)}
    >
      <div
        className="bg-canvas border-border-subtle border-hairline flex w-72 flex-col gap-4 rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <span className="text-text-primary text-sm font-medium">Disconnect server?</span>
          <span className="text-text-muted text-xs">
            <span className="text-text-secondary">{name}</span> will be removed from Konnekt. Your
            server files and data will not be affected.
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
            onClick={confirm}
            className="border-danger/20 bg-danger/10 text-danger hover:bg-danger/20 border-hairline rounded px-3 py-1.5 text-xs transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  )
}
