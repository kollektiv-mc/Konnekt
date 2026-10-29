import { fitItems, useGridFit } from '../../hooks/useGridFit'
import type { TileLayout } from '../../types'
import type { InstalledMod, ModUpdateInfo } from './useMods'

interface Props {
  mods: InstalledMod[]
  updates: Record<string, ModUpdateInfo>
  loading: boolean
  error: string | null
  kind: 'mods' | 'plugins'
  layout: TileLayout
}

/** Enabled first, then by name: what is running reads before what is parked. */
function glanceOrder(mods: readonly InstalledMod[]): InstalledMod[] {
  return [...mods].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  )
}

/**
 * The canvas face's detail for Plugins: every installed mod or plugin as one
 * short cell, wrapped across the tile's width, never scrolled.
 *
 * Managing them (toggles, versions, filters, pages) is the maximized face's
 * job; this one answers "what is on this server and is it on" at a glance. A
 * cell is a status dot and the name, plus the version in the detailed layout,
 * and an update that is waiting tints the dot. What does not fit gives its
 * last cell to a count of the rest rather than a scrollbar.
 */
export function ModsGlance({ mods, updates, loading, error, kind, layout }: Props) {
  const ordered = glanceOrder(mods)
  const [measure, capacity] = useGridFit(ordered.length)
  const { shown, more } = fitItems(ordered, capacity)

  if (error) return <p className="text-danger px-3 font-mono text-xs">{error}</p>
  if (loading && mods.length === 0) {
    return <p className="text-text-faint px-3 font-mono text-xs">loading…</p>
  }
  if (mods.length === 0) {
    return (
      <p className="text-text-faint px-3 font-mono text-xs">
        no {kind} installed · maximize to browse
      </p>
    )
  }

  return (
    <ul
      ref={measure}
      aria-label={`Installed ${kind}`}
      className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] content-start gap-x-3 gap-y-1 overflow-hidden px-3 pb-2"
    >
      {shown.map((mod) => {
        const update = updates[mod.fileName]?.updateAvailable
        return (
          <li
            key={mod.fileName}
            className="flex h-6 min-w-0 items-center gap-1.5"
            title={update ? `${mod.displayName}: update available` : mod.displayName}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                update ? 'bg-warning' : mod.enabled ? 'bg-success' : 'bg-border-subtle'
              }`}
            />
            <span
              className={`min-w-0 truncate text-xs ${
                mod.enabled ? 'text-text-primary' : 'text-text-faint'
              }`}
            >
              {mod.displayName}
            </span>
            {layout === 'detailed' && mod.versionNumber && (
              <span className="text-text-faint text-2xs shrink-0 font-mono">
                {mod.versionNumber}
              </span>
            )}
          </li>
        )
      })}
      {more > 0 && (
        <li className="text-text-muted flex h-6 items-center font-mono text-xs">+{more} more</li>
      )}
    </ul>
  )
}
