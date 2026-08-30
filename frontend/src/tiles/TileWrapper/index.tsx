import type { ReactNode } from 'react'
import { IconButton } from '../../components/ui/IconButton'
import { CloseIcon, CollapseIcon, ExpandIcon } from '../../components/ui/icons'

interface TileWrapperProps {
  id: string
  label: string
  icon: string
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
            <span className="text-sm leading-none">{icon}</span>
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
                {maximized ? <CollapseIcon /> : <ExpandIcon />}
              </IconButton>
            )}
            {!maximized && (
              <IconButton
                onClick={() => onRemove(id)}
                onMouseDown={(e) => e.stopPropagation()}
                title="Remove tile"
              >
                <CloseIcon />
              </IconButton>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
