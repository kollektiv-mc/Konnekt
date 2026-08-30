import type { ReactNode } from 'react'

interface Props {
  onClick: () => void
  /** Both the tooltip and the accessible name — the icon carries neither. */
  title: string
  children: ReactNode
  tone?: 'muted' | 'danger'
  className?: string
  /**
   * For a control sitting on a drag handle, which needs to stop the press
   * reaching the handle behind it (see `tiles/TileWrapper`).
   */
  onMouseDown?: (e: React.MouseEvent) => void
}

const TONES = {
  muted: 'text-text-faint hover:text-text-primary hover:bg-hover',
  danger: 'text-text-faint hover:text-danger hover:bg-danger/10',
} as const

/**
 * One square, flex-centred box for the navbar's icon controls.
 *
 * The box is the point. These controls sit in a column down the right edge of
 * the navbar — the settings gear, the manage-servers expand, a per-row edit —
 * and each used to size itself from its own glyph and padding, so no two of
 * them shared a width, a height, or a distance from the edge. Giving them one
 * box lines the column up regardless of what is drawn inside it, and pairs with
 * `icons.tsx` drawing every icon on the same grid.
 *
 * `h-6 w-6` with a 16px icon leaves a 4px ring of hit area around the ink, so
 * the hover background reads as a target rather than tracing the glyph.
 *
 * Where this belongs: a control that closes, expands or restores a panel,
 * dialog or tile. Not the small `×` that clears a search field or drops one
 * chip from a list — those live inside dense rows at their own scale, and a
 * 24px box would set the height of the row around them.
 */
export function IconButton({
  onClick,
  title,
  children,
  tone = 'muted',
  className = '',
  onMouseDown,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
      aria-label={title}
      className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors ${TONES[tone]} ${className}`}
    >
      {children}
    </button>
  )
}
