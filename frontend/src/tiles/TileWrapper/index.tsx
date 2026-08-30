import type { ReactNode } from 'react'
import type { LucideIcon } from '../../lib/icons'
import { Maximize2, Minimize2, X } from '../../lib/icons'
import { Icon } from '../../components/ui/Icon'

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
}: TileWrapperProps) {
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
          title={maximizable && !maximized ? 'Double-click to maximize' : undefined}
        >
          <div className="flex items-center gap-2">
            <Icon icon={icon} size="sm" className="text-text-muted" />
            <span className="text-text-secondary font-title text-xs font-medium">{label}</span>
          </div>
          <div className="flex items-center gap-1">
            {maximizable && (
              <button
                onClick={() => onToggleMaximize?.(id)}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-text-faint flex h-5 w-5 items-center justify-center text-xs leading-none transition-colors"
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
                }}
                title={maximized ? 'Restore tile' : 'Maximize tile'}
                aria-label={maximized ? 'Restore tile' : 'Maximize tile'}
              >
                <Icon icon={maximized ? Minimize2 : Maximize2} size="xs" />
              </button>
            )}
            {!maximized && (
              <button
                onClick={() => onRemove(id)}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-text-faint flex h-5 w-5 items-center justify-center text-sm leading-none transition-colors"
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
                }}
                title="Remove tile"
                aria-label="Remove tile"
              >
                <Icon icon={X} size="sm" />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
