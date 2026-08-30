import { useEffect } from 'react'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'
import { IconButton } from './ui/IconButton'
import { ExpandIcon } from './ui/icons'
import { ServerRow } from './ServerRow'
import { NEW_SERVER } from './ServerManager/ServerList'

/**
 * The sidebar's server switcher.
 *
 * Selecting, and two intents: open the manager, or open it on a server.
 * Disconnecting was a third until it moved into the manager itself, where the
 * server being removed is named rather than being whichever row the `×` was
 * next to. Everything it used to render as an overlay — the manager, the
 * install modal, the disconnect confirm — moved to App, because a fixed overlay
 * inside <aside> loses to the maximized-tile overlay inside <main>. It also
 * used to own the install-finished result, on the reasoning that this component
 * outlives the modals; with that state in `useInstallStore` nothing is at risk
 * of unmounting and App is the natural place for the listener.
 */
export function ServerSelector() {
  const { configs, activeId, error, loadConfigs, setActiveId } = useServerConfigStore()
  const openServerManager = useUiStore((s) => s.openServerManager)

  useEffect(() => {
    loadConfigs().catch(console.error)
  }, [loadConfigs])

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
        <IconButton
          onClick={() => openServerManager(activeId || NEW_SERVER)}
          title="Manage servers"
        >
          <ExpandIcon />
        </IconButton>
      </div>

      {configs.map((cfg) => (
        <ServerRow
          key={cfg.id}
          cfg={cfg}
          active={cfg.id === activeId}
          onSelect={() => selectServer(cfg.id)}
          onEdit={() => openServerManager(cfg.id)}
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
        onClick={() => openServerManager(NEW_SERVER)}
        className="text-text-faint hover:bg-hover hover:text-text-secondary mx-1 mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors"
      >
        {/* Sized to the status dot above it, not to the glyph, so this row's
            label starts in the same column as the server names. The plus
            overflows its 6px box symmetrically and stays centred on the dot. */}
        <span className="w-1.5 text-center">+</span>
        <span>Add server</span>
      </button>
    </div>
  )
}
