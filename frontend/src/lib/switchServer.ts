import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'

/**
 * Make `id` the active server, unless the maximized tile has unsaved work.
 *
 * Dashboard keys a tile `${tile.id}:${serverId}` so a switch remounts it, which
 * is what throws away an editor's unsaved changes (#450). The tile's close
 * guard already knows how to ask about that, so a switch asks it the same way
 * and hands it the switch as the continuation: the guard runs it on discard or
 * save, or never on cancel.
 *
 * Lives here rather than as a `useServerConfigStore` action because it reads
 * `useUiStore`, and one store per domain means neither imports the other.
 *
 * Returns whether the switch was held, so a caller that renders under the
 * guard's dialog can get out of its way (the server manager sits above the
 * maximized tile, see lib/layers.ts). Selecting the active server does nothing.
 */
export function switchServer(id: string): boolean {
  if (id === useServerConfigStore.getState().activeId) return false

  // A refused switch surfaces through the store's own `error`, so there is
  // nothing to revert here.
  const proceed = () => {
    useServerConfigStore
      .getState()
      .setActiveId(id)
      .catch(() => {})
  }

  const guard = useUiStore.getState().closeGuard
  if (guard?.(proceed)) return true

  proceed()
  return false
}
