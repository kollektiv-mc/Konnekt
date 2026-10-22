import type { ReactNode } from 'react'
import { NO_GRAPH_KEYS } from './blockMeta'

interface MenuRowProps {
  label: string
  onClick: () => void
  /** The key chord that does the same, shown quietly at the row's right edge. */
  shortcut?: string
  disabled?: boolean
  /** A destructive row, in the danger colour. */
  danger?: boolean
  /** The current choice in a list, set apart the way the graph list marks its own. */
  active?: boolean
  /** Whatever leads the label (an icon slot); the label does not move for it. */
  leading?: ReactNode
  /** Whatever ends the row in place of a shortcut, such as a fly-out's chevron. */
  trailing?: ReactNode
  /** Nesting depth under an expanded row, for the inset. */
  indent?: boolean
  expanded?: boolean
  /** Makes the row a switch and says whether it is on; the caller draws the mark. */
  checked?: boolean
  title?: string
}

/**
 * One row of a toolbar menu. A button, so it is focusable and named; the
 * hover is a utility rather than a style write on enter and leave (#279), and a
 * disabled row drops its hover so it does not look pressable.
 *
 * Each row carries NO_GRAPH_KEYS itself rather than leaning on the toolbar
 * above it: React Flow binds Delete and Backspace to the document, a button is
 * not an input to it, and these rows are meant to be reused where the toolbar
 * is not the ancestor (the node's right-click menu, #181).
 */
export function MenuRow({
  label,
  onClick,
  shortcut,
  disabled = false,
  danger = false,
  active = false,
  leading,
  trailing,
  indent = false,
  expanded,
  checked,
  title,
}: MenuRowProps) {
  const tone = active ? 'text-accent' : danger ? 'text-danger' : 'text-text-primary'
  const surface = active
    ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
    : 'bg-transparent hover:bg-hover'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      role={checked === undefined ? undefined : 'switch'}
      aria-checked={checked}
      title={title}
      className={`flex w-full cursor-pointer items-center gap-2 py-1.5 text-left font-mono text-xs whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${
        indent ? 'pr-3 pl-6' : 'px-3'
      } ${tone} ${surface} ${NO_GRAPH_KEYS}`}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <span className="text-text-faint text-2xs shrink-0">{shortcut}</span>}
      {trailing}
    </button>
  )
}

/** The hairline between groups of rows. */
export function MenuDivider() {
  return <div role="separator" className="border-border-subtle border-t-hairline my-1" />
}
