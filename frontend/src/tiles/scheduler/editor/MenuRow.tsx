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
  /** The row opens a fly-out; `expanded` says whether it is open. */
  hasPopup?: boolean
  expanded?: boolean
  title?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
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
  hasPopup = false,
  expanded,
  title,
  onKeyDown,
}: MenuRowProps) {
  const tone = active ? 'text-accent' : danger ? 'text-danger' : 'text-text-primary'
  // A row whose fly-out is open stays lit, so the fly-out says which row it is from.
  const surface = active
    ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
    : expanded
      ? 'bg-hover'
      : 'bg-transparent hover:bg-hover'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup={hasPopup ? 'menu' : undefined}
      aria-expanded={hasPopup ? (expanded ?? false) : undefined}
      title={title}
      onKeyDown={onKeyDown}
      // The default arrow, here and on the bar: a button in the editor does not
      // change the cursor (#697).
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs whitespace-nowrap transition-colors disabled:opacity-50 disabled:hover:bg-transparent ${tone} ${surface} ${NO_GRAPH_KEYS}`}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <span className="text-text-faint text-2xs shrink-0">{shortcut}</span>}
      {trailing}
    </button>
  )
}

/**
 * The hairline between groups of rows. Flush with the rows on both sides, so a
 * hovered row's fill meets the line rather than stopping short of it; the rows'
 * own padding is the space around the text.
 */
export function MenuDivider() {
  return <div role="separator" className="border-border-subtle border-t-hairline" />
}
