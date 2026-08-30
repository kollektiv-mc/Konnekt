import { useCallback, useRef, useState } from 'react'
import { GetServerSummary } from '../../wailsjs/go/main/App'
import { useHoverDelay } from '../hooks/useHoverDelay'
import { IconButton } from './ui/IconButton'
import { Pencil } from '../lib/icons'
import { Icon } from './ui/Icon'
import { ServerTooltip } from './ServerTooltip'
import type { ServerConfig, ServerSummary } from '../types'
import { readOr } from '../lib/ipc'

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
}

/**
 * One server in the sidebar's switcher.
 *
 * Selecting and editing, and nothing else. Disconnecting used to be a second
 * icon here, one click from the row you select a server with and with only a
 * `×` to say which of the two it was. It lives in the manager now, behind the
 * edit control, where the server it would remove is named on screen.
 */
export function ServerRow({ cfg, active, onSelect, onEdit }: Props) {
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
    // Only stamp `fetchedAt` on a real value: stamping it for the fallback too
    // would let the TTL above suppress the retry for five seconds after a miss.
    readOr(() => GetServerSummary(cfg.id), null).then((s) => {
      if (!s) return
      fetchedAt.current = Date.now()
      setSummary(s)
    })
  }, [cfg.id])

  const { hovered, onMouseEnter, onMouseLeave } = useHoverDelay(1000, prime)

  return (
    <div
      ref={rowRef}
      className="flex items-center gap-1 pr-2"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* pr-2 on the row, not px-2. Only the right half of that padding was
          doing anything — it sets the edit control's column, 12px inside the
          card with every other trailing control in the navbar — while the left
          half pushed this row's rectangle 8px inside the crate rows', which is
          the misalignment between the two lists. The button takes the 8px back
          as padding, so the rectangle moves and the dot does not.

          Only the left of that pair positions anything, so the right gives its
          width back to the name: pr-2.5 cost twelve pixels of "NeoForge 1.21.1"
          to pad a gap that already has the row's own gap-1 in it.

          pl-2 rather than the 18px it took to sit the dot on the crate rows'
          glyph centre. That centre belongs to a 16px glyph in a 24px box, and
          buying into it with a 6px dot meant 18px of empty pill before the dot
          — a gap wide enough to read as a mistake, to align a mark that is a
          third the size of the ones it was aligning with. This card is its own
          collapsible and does not owe them that column.

          8px is where it lands instead, matching this row's own py-1.5 more
          nearly than 12px did — a mark with more space to its left than above
          and below it reads as pushed right, whatever column it is on.

          min-w-0 is what lets the name actually truncate. The span inside carries
          `truncate`, but this button's own overflow is visible, so its intrinsic
          minimum is the full width of a nowrap label and it refuses to shrink
          past it — which pushed the edit control out of the section beside a
          name as ordinary as "NeoForge 1.21.1", at the navbar's 176px floor. */}
      <button
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded py-1.5 pr-1 pl-2 text-left text-xs transition-all ${
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
      <IconButton onClick={onEdit} title="Edit">
        <Icon icon={Pencil} />
      </IconButton>

      {hovered && <ServerTooltip summary={summary} anchor={anchor} />}
    </div>
  )
}
