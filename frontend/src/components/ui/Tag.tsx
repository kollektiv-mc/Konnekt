import type { ReactNode } from 'react'

/**
 * The tones a tag comes in. `muted` is a fact ("Kommands"); the three tinted
 * ones are states worth a glance, in the same accent / warning / danger
 * vocabulary the rest of the UI uses for tinted controls: text in the colour,
 * a 30% border, a 10% fill, all on the hairline.
 */
const TONES = {
  muted: 'text-text-muted border-border-subtle',
  accent: 'text-accent border-accent/30 bg-accent/10',
  warning: 'text-warning border-warning/30 bg-warning/10',
  danger: 'text-danger border-danger/30 bg-danger/10',
} as const

interface TagProps {
  tone?: keyof typeof TONES
  /** The tooltip, for the longer version of what the tag says. */
  title?: string
  className?: string
  children: ReactNode
}

/**
 * A small inline label that states something about the row it sits in: where
 * a command came from, that it changed, that its source is gone.
 *
 * One component rather than the class string it replaces, for the reason
 * `IconButton` gives for its box: every row that grows a tag otherwise sizes
 * and tints its own, and no two agree on padding or radius. The shape is the
 * hairline chip the tinted buttons in Settings already draw, at the `2xs` size
 * a dense row can afford, and never interactive: a tag says, a button does.
 */
export function Tag({ tone = 'muted', title, className = '', children }: TagProps) {
  return (
    <span
      title={title}
      className={`border-hairline text-2xs inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
