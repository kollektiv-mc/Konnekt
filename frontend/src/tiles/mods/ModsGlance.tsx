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

/**
 * By name alone. Sorting the disabled ones last pushed them into the "+N more"
 * count on a full tile, which read as hiding them; the grey dot already says
 * which they are.
 */
function glanceOrder(mods: readonly InstalledMod[]): InstalledMod[] {
  return [...mods].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  )
}

/**
 * The canvas face's detail for Plugins: every installed mod or plugin as one
 * short cell, wrapped across the tile's width, never scrolled.
 *
 * Managing them (toggles, versions, filters, pages) is the maximized face's
 * job; this one answers "what is on this server and is it on" at a glance. A
 * cell is a status dot and the name, with the version on a second line in the
 * detailed layout. The dot is green when on, grey when off, and takes the
 * warning tone while an update waits. What does not fit gives its last cell
 * to a count of the rest rather than a scrollbar.
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

  const detailed = layout === 'detailed'
  // Every cell one height, which useGridFit counts on: two lines in the
  // detailed layout, whether or not a mod reports a version.
  const cell = detailed ? 'h-9 items-start' : 'h-6 items-center'

  return (
    <ul
      ref={measure}
      aria-label={`Installed ${kind}`}
      className={`grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] content-start gap-x-3 overflow-hidden px-3 pb-3 ${
        detailed ? 'gap-y-2' : 'gap-y-1.5'
      }`}
    >
      {shown.map((mod) => {
        const update = updates[mod.fileName]?.updateAvailable
        return (
          <li
            key={mod.fileName}
            className={`flex min-w-0 gap-1.5 ${cell}`}
            title={update ? `${mod.displayName}: update available` : mod.displayName}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${detailed ? 'mt-1.5' : ''} ${
                update ? 'bg-warning' : mod.enabled ? 'bg-success' : 'bg-text-faint'
              }`}
            />
            <span className="flex min-w-0 flex-col">
              <span
                className={`truncate text-xs leading-snug ${
                  mod.enabled ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {mod.displayName}
              </span>
              {detailed && mod.versionNumber && (
                <span className="text-text-faint text-2xs truncate font-mono leading-snug">
                  {mod.versionNumber}
                </span>
              )}
            </span>
          </li>
        )
      })}
      {more > 0 && (
        <li className={`text-text-muted flex font-mono text-xs ${cell}`}>+{more} more</li>
      )}
    </ul>
  )
}
