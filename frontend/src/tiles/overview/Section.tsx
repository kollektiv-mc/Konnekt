import type { ReactNode } from 'react'
import type { LucideIcon } from '../../lib/icons'
import { Maximize2 } from '../../lib/icons'
import { Icon } from '../../components/ui/Icon'
import { IconButton } from '../../components/ui/IconButton'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { useUiStore } from '../../stores/useUiStore'

interface Props {
  /** Registry id of the tile this section reports on, and the one its header opens. */
  tileId: string
  label: string
  icon: LucideIcon
  /** Small right-aligned figure in the header — a count, a total. */
  meta?: ReactNode
  children: ReactNode
}

/**
 * One block of the Overview dashboard.
 *
 * The header is the panel's only affordance. Section bodies are readouts, and
 * anything you want to *change* you do in the owning tile, which the header
 * opens — one rule for the whole panel rather than a judgement call per
 * section. `requestMaximize` from inside a maximized tile is an established
 * path (`tiles/backups/index.tsx` reaches the scheduler this way): Dashboard's
 * request effect closes what is open, queues the id and opens it once the close
 * animation lands, and handles a tile that is not on the canvas at all.
 *
 * Each body gets its own `ErrorBoundary`. This panel mounts five independent
 * tile-domain subtrees side by side; `TileWrapper`'s boundary around the whole
 * tile would keep a throwing section from reaching the app, but it would blank
 * the other four with it, and one readout going dark should not cost the rest.
 */
export function Section({ tileId, label, icon, meta, children }: Props) {
  const requestMaximize = useUiStore((s) => s.requestMaximize)

  return (
    <div className="border-border-subtle bg-surface border-hairline flex h-full min-h-0 flex-col overflow-hidden rounded-[10px]">
      <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-2 px-3 py-2">
        <Icon icon={icon} size="sm" className="text-text-muted" />
        <span className="text-text-secondary font-title truncate text-xs font-medium">{label}</span>
        {meta !== undefined && (
          <span className="text-text-faint ml-auto font-mono text-xs">{meta}</span>
        )}
        <IconButton
          onClick={() => requestMaximize(tileId, null)}
          title={`Open ${label}`}
          className={meta === undefined ? 'ml-auto' : ''}
        >
          <Icon icon={Maximize2} />
        </IconButton>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary
          fallback={
            <div className="text-danger flex h-full items-center justify-center px-3 text-center font-mono text-xs">
              unavailable
            </div>
          }
        >
          {children}
        </ErrorBoundary>
      </div>
    </div>
  )
}

/**
 * The line a section shows instead of its content when there is nothing to
 * report. Its own component so "no backups yet" and "no players online" are
 * never a blank block, and always look alike.
 */
export function SectionEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="text-text-faint flex h-full items-center justify-center px-3 text-center font-mono text-xs">
      {children}
    </div>
  )
}
