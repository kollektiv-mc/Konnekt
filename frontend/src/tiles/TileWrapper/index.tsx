import { useState, type ReactNode } from 'react'
import type { LucideIcon } from '../../lib/icons'
import { IconButton } from '../../components/ui/IconButton'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { Maximize2, Minimize2, X } from '../../lib/icons'
import { Icon } from '../../components/ui/Icon'
import { TileContextMenu } from './LayoutMenu'
import type { TileLayout } from '../../types'

interface TileWrapperProps {
  id: string
  label: string
  icon: LucideIcon
  onRemove: (id: string) => void
  children: ReactNode
  maximizable?: boolean
  maximized?: boolean
  flash?: boolean
  onToggleMaximize?: (id: string) => void
  /**
   * The in-tile layout the compact face is on, for a tile that honours one
   * (`TileDefinition.layouts`). With both this and `onSetLayout` set, a
   * right-click on the header opens the menu that changes it.
   */
  layout?: TileLayout
  onSetLayout?: (id: string, layout: TileLayout) => void
}

export function TileWrapper({
  id,
  label,
  icon,
  onRemove,
  children,
  maximizable,
  maximized,
  flash,
  onToggleMaximize,
  layout,
  onSetLayout,
}: TileWrapperProps) {
  // Bumped by the fallback's Retry. The boundary is keyed on it, so a bump
  // unmounts the failed subtree and mounts the tile again from scratch —
  // fresh state, fresh effects — rather than asking the same instance to try
  // once more with whatever it had when it threw.
  const [attempt, setAttempt] = useState(0)
  // The layout menu opens from the header's context menu and only on the
  // canvas copy: the maximized face ignores the layout, so offering it there
  // would change nothing the user can see.
  // Where the right-click landed, in viewport coordinates; null while closed.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const hasLayoutMenu = !maximized && layout !== undefined && onSetLayout !== undefined

  return (
    <div className={`relative h-full ${maximized ? '' : 'tile-outer'}`}>
      {flash && <div className="tile-flash-ring" />}
      <div
        className="tile-wrapper border-border-subtle bg-canvas border-hairline duration-fast flex h-full flex-col overflow-hidden rounded-[10px] bg-[linear-gradient(var(--bg-surface),var(--bg-surface))] transition-colors"
        onMouseEnter={
          maximized
            ? undefined
            : (e) => {
                ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-hover)'
              }
        }
        onMouseLeave={
          maximized
            ? undefined
            : (e) => {
                ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'
              }
        }
      >
        <div
          className={`drag-handle border-border-subtle border-b-hairline flex shrink-0 items-center justify-between px-3 py-2 select-none ${
            maximized ? 'cursor-default' : 'cursor-grab'
          }`}
          onDoubleClick={maximizable ? () => onToggleMaximize?.(id) : undefined}
          onContextMenu={
            hasLayoutMenu
              ? (e) => {
                  e.preventDefault()
                  setMenuAt({ x: e.clientX, y: e.clientY })
                }
              : undefined
          }
          title={
            maximizable && !maximized
              ? hasLayoutMenu
                ? 'Double-click to maximize · right-click for layout'
                : 'Double-click to maximize'
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            <Icon icon={icon} size="sm" className="text-text-muted" />
            <span className="text-text-secondary font-title text-xs font-medium">{label}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* stopPropagation: these sit on the drag handle, so without it a
                press on one starts dragging the tile. */}
            {maximizable && (
              <IconButton
                onClick={() => onToggleMaximize?.(id)}
                onMouseDown={(e) => e.stopPropagation()}
                title={maximized ? 'Restore tile' : 'Maximize tile'}
              >
                {maximized ? <Icon icon={Minimize2} /> : <Icon icon={Maximize2} />}
              </IconButton>
            )}
            {!maximized && (
              <IconButton
                onClick={() => onRemove(id)}
                onMouseDown={(e) => e.stopPropagation()}
                title="Remove tile"
              >
                <Icon icon={X} />
              </IconButton>
            )}
          </div>
        </div>
        {/* A sibling of the header, not a child: the menu is a portal, and
            React bubbles a portal's events to its React parent, so inside
            the header its backdrop's right-click reopened it (its own
            handler stops that too; this keeps the tree honest). Eager rather
            than lazy: a chunk fetched on the first right-click was a visible
            pause before anything appeared, for about a kilobyte. */}
        {hasLayoutMenu && menuAt && (
          <TileContextMenu
            at={menuAt}
            layout={layout}
            onChoose={(next) => onSetLayout(id, next)}
            onClose={() => setMenuAt(null)}
          />
        )}
        {/* The boundary sits inside the frame and around the content only.
            Every tile renders through this slot — the canvas copy and the
            maximized copy alike (Dashboard.tsx) — so this one boundary is what
            keeps a tile that throws, or a lazy chunk that fails to load, from
            reaching the app-level boundary in main.tsx and replacing the whole
            dashboard with "render error". The header stays live above it, so
            Remove and Maximize/Restore still work on a failed tile; the
            fallback adds Retry. */}
        <div className="tile-body min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary
            key={attempt}
            fallback={(error) => (
              <TileFallback error={error} onRetry={() => setAttempt((n) => n + 1)} />
            )}
          >
            {children}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}

/**
 * What a tile shows in place of content that threw. The header above it still
 * names the tile, so this says what happened and what can be done about it,
 * in the same lowercase mono register as the app's other unavailable states
 * ("unavailable" in an Overview section, "render error" at app level).
 */
function TileFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center font-mono text-xs">
      <div className="text-danger">tile failed to render</div>
      <div className="text-text-faint max-w-full break-all">{error.message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="border-border-subtle text-text-faint hover:text-text-secondary border-hairline rounded px-3 py-1 transition-colors"
      >
        Retry
      </button>
    </div>
  )
}
