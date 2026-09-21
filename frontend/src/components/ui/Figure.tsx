import type { ReactNode } from 'react'

/**
 * The two shapes a tile's key figure comes in, and the one axis a tile layout
 * moves them along.
 *
 * A tile's compact face leads with the number that is the point of the tile:
 * how many players, what the TPS is, when the last backup ran. The default
 * layout sets that figure large with its detail below it; the minimal layout
 * (later, per tile, from the header's context menu) keeps only the figure; the
 * maximal one sets it small to make room for more detail. `size` is that axis,
 * so a tile never picks its own figure scale and the three layouts stay one
 * decision made in one place.
 *
 * Values are `font-mono` for the reason `.claude/rules/frontend-style.md`
 * § Numerals gives: a readout that changes in place has to keep its width,
 * and the mono stack is the one face here whose digits do. Both sizes are
 * steps on the type scale, never a pixel value.
 */
export type FigureSize = 'lg' | 'sm'

const VALUE_SIZE: Record<FigureSize, string> = {
  lg: 'text-xl',
  sm: 'text-sm',
}

const LABEL_SIZE: Record<FigureSize, string> = {
  lg: 'text-xs',
  sm: 'text-2xs',
}

interface FigureProps {
  label: string
  value: string
  size?: FigureSize
  /** A tone for the value, such as the TPS banding. Defaults to primary ink. */
  valueClass?: string
  title?: string
}

/**
 * Label over value. For a grid of figures (Overview's four, Performance's
 * three) and for a single headline with its caption (Backups' last run).
 */
export function Figure({ label, value, size = 'lg', valueClass, title }: FigureProps) {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <span className={`text-text-muted ${LABEL_SIZE[size]}`}>{label}</span>
      <span
        className={`truncate font-mono leading-tight font-medium ${VALUE_SIZE[size]} ${
          valueClass ?? 'text-text-primary'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

interface HeadlineProps {
  value: string
  /** The phrase after the value: "of 20 online", "worlds · 1.6 GB". */
  unit: string
  /** Right-aligned status for the same line: "next in 46m", "world active". */
  aside?: ReactNode
  size?: FigureSize
  valueClass?: string
}

/**
 * Value then phrase on one baseline, with room for a status at the far end.
 * For a tile whose figure is a count of the list beneath it (Players,
 * Scheduler, Worlds, Plugins), where the phrase is what the count is of.
 */
export function Headline({ value, unit, aside, size = 'lg', valueClass }: HeadlineProps) {
  return (
    <div className="flex shrink-0 items-baseline gap-2">
      <span
        className={`font-mono leading-tight font-medium ${VALUE_SIZE[size]} ${
          valueClass ?? 'text-text-primary'
        }`}
      >
        {value}
      </span>
      <span className={`text-text-muted truncate ${LABEL_SIZE[size]}`}>{unit}</span>
      {aside !== undefined && (
        <span className={`text-text-muted ml-auto shrink-0 ${LABEL_SIZE[size]}`}>{aside}</span>
      )}
    </div>
  )
}
