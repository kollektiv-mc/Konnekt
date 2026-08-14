import { useCallback, useRef, useState } from 'react'
import { GetServerSummary } from '../../wailsjs/go/main/App'
import { useHoverDelay } from '../hooks/useHoverDelay'
import { ServerTooltip } from './ServerTooltip'
import type { ServerConfig, ServerSummary } from '../types'

// Re-read rather than trust a cached summary for longer than this — the
// running flag changes underneath us when a server starts or stops.
const SUMMARY_TTL_MS = 5000
const TOOLTIP_GAP_PX = 8
const TOOLTIP_HEIGHT_PX = 140

interface Props {
  cfg: ServerConfig
  active: boolean
  onSelect: () => void
  onEdit: () => void
  onDisconnect: () => void
}

export function ServerRow({ cfg, active, onSelect, onEdit, onDisconnect }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [summary, setSummary] = useState<ServerSummary | null>(null)
  const [anchor, setAnchor] = useState({ top: 0, left: 0 })
  const fetchedAt = useRef(0)

  // Fetch on mouse-enter so the card is already populated when the delay fires.
  const prime = useCallback(() => {
    const rect = rowRef.current?.getBoundingClientRect()
    if (rect) {
      setAnchor({
        top: Math.min(rect.top, window.innerHeight - TOOLTIP_HEIGHT_PX),
        left: rect.right + TOOLTIP_GAP_PX,
      })
    }
    if (Date.now() - fetchedAt.current < SUMMARY_TTL_MS) return
    GetServerSummary(cfg.id)
      .then((s) => {
        fetchedAt.current = Date.now()
        setSummary(s)
      })
      .catch(() => {
        /* Wails IPC unavailable */
      })
  }, [cfg.id])

  const { hovered, onMouseEnter, onMouseLeave } = useHoverDelay(1000, prime)

  return (
    <div
      ref={rowRef}
      className="flex items-center gap-1"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        onClick={onSelect}
        className={`flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-all ${
          active
            ? 'text-accent bg-accent/10'
            : 'text-text-secondary hover:bg-hover hover:text-text-primary'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-text-faint'}`}
        />
        <span className="truncate">{cfg.name}</span>
      </button>
      <button
        onClick={onEdit}
        className="text-text-faint hover:text-text-secondary px-1 text-xs transition-colors"
        title="Edit"
      >
        ✎
      </button>
      <button
        onClick={onDisconnect}
        className="text-text-faint px-1 text-xs transition-colors hover:text-red-400"
        title="Disconnect"
      >
        ×
      </button>

      {hovered && <ServerTooltip summary={summary} anchor={anchor} />}
    </div>
  )
}
