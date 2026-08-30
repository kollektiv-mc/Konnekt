import { useEffect } from 'react'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'
import { IconButton } from './ui/IconButton'
import { NavSection } from './ui/NavSection'
import { Maximize2 } from '../lib/icons'
import { Icon } from './ui/Icon'
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
    // The manage-servers control rides on the section header rather than inside
    // the list, which is where a tile's own controls sit too. It is passed to
    // NavSection rather than rendered here because a control nested inside the
    // disclosure button would be a button inside a button.
    <NavSection
      id="servers"
      title="Servers"
      action={
        <IconButton
          onClick={() => openServerManager(activeId || NEW_SERVER)}
          title="Manage servers"
        >
          <Icon icon={Maximize2} />
        </IconButton>
      }
    >
      {/* p-1, not p-2: the card's own inset is the padding this used to supply,
          and doubling the two cost enough width to truncate a server name as
          ordinary as "NeoForge 1.21.1" at the default navbar width. The rows
          carry px-1 of their own on top of this. */}
      <div className="flex flex-col gap-1 p-1">
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
          className="text-text-faint hover:bg-hover hover:text-text-secondary mx-2 mt-1 flex items-center gap-2 rounded py-1.5 pr-1 pl-2.5 text-xs transition-colors"
        >
          {/* Sized to the status dot above it, not to the glyph, so this row's
              label starts in the same column as the server names. The plus
              overflows its 6px box symmetrically and stays centred on the dot. */}
          <span className="w-1.5 text-center">+</span>
          <span>Add server</span>
        </button>
      </div>
    </NavSection>
  )
}
