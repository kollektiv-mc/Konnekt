import type { ReactNode } from 'react'
import type { LucideIcon } from '../../lib/icons'
import { Maximize2 } from '../../lib/icons'
import { Icon } from '../../components/ui/Icon'
import { IconButton } from '../../components/ui/IconButton'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { useUiStore } from '../../stores/useUiStore'

interface Props {
  /** Registry id of the tile this card summarises, or undefined for the vitals. */
  tileId?: string
  label: string
  icon: LucideIcon
  children: ReactNode
}

/**
 * One cell of the Overview roll-up: a tile's own chrome around a tile's own
 * summary.
 *
 * The maximize control is what makes the panel a navigator rather than a
 * mirror of the canvas. Overview lists the registry, not `activeTileIds`, so a
 * card appears for a tile the user has taken off the canvas entirely — and
 * this is the way back into it. `requestMaximize` from a maximized tile is an
 * established path (`tiles/backups/index.tsx` jumps to the scheduler this
 * way): Dashboard's request effect closes what is open, queues the new id and
 * opens it once the close animation lands.
 *
 * The body gets its own `ErrorBoundary` because this is the one place in the
 * app that mounts ten independent tile subtrees side by side. Without it, a
 * single summary throwing takes the panel and — the app-level boundary in
 * `main.tsx` being the only other one — the whole window with it.
 */
export function SummaryCard({ tileId, label, icon, children }: Props) {
  const requestMaximize = useUiStore((s) => s.requestMaximize)

  return (
    <div className="border-border-subtle bg-surface border-hairline flex h-full min-h-0 flex-col overflow-hidden rounded-[10px]">
      <div className="border-border-subtle border-b-hairline flex shrink-0 items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon={icon} size="sm" className="text-text-muted" />
          <span className="text-text-secondary font-title truncate text-xs font-medium">
            {label}
          </span>
        </div>
        {tileId && (
          <IconButton onClick={() => requestMaximize(tileId, null)} title={`Open ${label}`}>
            <Icon icon={Maximize2} />
          </IconButton>
        )}
      </div>

      {/* `relative` so a summary's own overlay — BackupsSummary mounts
          BackupRunningDialog at `absolute inset-0` — is contained by its card
          instead of covering the whole panel. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary
          fallback={
            <div className="text-danger flex h-full items-center justify-center px-3 text-center font-mono text-xs">
              summary unavailable
            </div>
          }
        >
          {children}
        </ErrorBoundary>
      </div>
    </div>
  )
}
