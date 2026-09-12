import { useEffect, useState } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { IconButton } from '../../../components/ui/IconButton'
import { CopyPlus, GripVertical, Trash2 } from '../../../lib/icons'
import type { Offset, SortableHandleProps } from '../../../hooks/useSortable'
import type { CommandButton } from '../../../stores/useCommandsStore'
import { LinkBadge } from './LinkBadge'

interface CommandRowProps {
  item: CommandButton
  canReorder: boolean
  /** How far this row has been dragged, while it is the one being dragged. */
  lift: Offset | null
  /** How far this row has moved aside for a row being dragged, or null. */
  shift: Offset | null
  rowRef: (el: HTMLElement | null) => void
  handleProps: SortableHandleProps
  lifecycleBusy: boolean
  onRun: () => void
  onEdit: (patch: Partial<CommandButton>) => void
  onRemove: () => void
  onDuplicate: () => void
  onAcknowledge: () => void
  onUnlink: () => void
}

/** The inline transform for a row on the move, or none. */
function translate(offset: Offset | null) {
  return offset ? { transform: `translate(${offset.dx}px, ${offset.dy}px)` } : undefined
}

const FIELD =
  'focus:border-border-hover hover:border-border-subtle h-6 rounded border border-transparent bg-transparent px-1.5 text-xs transition-colors outline-none'
const TEXT = 'flex h-6 items-center truncate px-1.5 text-xs'

/**
 * One command in the library: label and value editable in place, at a size the
 * compact grid has never had room for.
 *
 * Every row lays out on the same columns, whatever it holds: grip, label,
 * command, then whatever the link has to say, then Run, copy, delete. The last
 * three keep their width whether or not they are drawn, so the buttons line up
 * down the list instead of drifting with each row's tag.
 *
 * A linked row is the exception to editing, and shows its text as text. Its
 * label and command are Kommands', and an edit here would either be undone by
 * the next sync or stop the link meaning anything. So the row offers a copy
 * instead — the same text under this server's own identity — and keeps the
 * original following its source.
 *
 * `kind` is deliberately not editable either. A `lifecycle` value is one of a
 * fixed set the frontend dispatches on and a `special` value names a dialog, so
 * retyping either would produce a button that does nothing. Delete and re-add
 * from the presets instead.
 */
export function CommandRow({
  item,
  canReorder,
  lift,
  shift,
  rowRef,
  handleProps,
  lifecycleBusy,
  onRun,
  onEdit,
  onRemove,
  onDuplicate,
  onAcknowledge,
  onUnlink,
}: CommandRowProps) {
  const [label, setLabel] = useState(item.label)
  const [value, setValue] = useState(item.value)

  // The row is a controlled editor over store state that something else can
  // change underneath it — a Kommands update lands as a new label and value on
  // an existing row. Without this the row would keep showing the old text until
  // it remounted, which is the one thing a "this changed" badge must not do.
  useEffect(() => setLabel(item.label), [item.label])
  useEffect(() => setValue(item.value), [item.value])

  const commitLabel = () => {
    if (label !== item.label) onEdit({ label })
  }
  const commitValue = () => {
    if (value !== item.value) onEdit({ value })
  }

  const linked = item.link !== undefined
  const editable = item.kind === 'cmd' && !linked

  return (
    <div
      ref={rowRef}
      className={`flex items-center gap-2 rounded border px-2 py-1 ${
        lift
          ? 'border-accent/60 bg-canvas relative z-10 transition-none'
          : 'border-border-subtle duration-fast transition-[transform,border-color]'
      }`}
      // eslint-disable-next-line no-restricted-syntax -- a row follows the pointer or slides aside for one; a per-frame offset has no class
      style={translate(lift ?? shift)}
    >
      <button
        type="button"
        {...handleProps}
        disabled={!canReorder}
        aria-label={`Reorder ${item.label}`}
        title={
          canReorder
            ? 'Drag to reorder, or use the arrow keys'
            : 'Clear the search and filter to reorder'
        }
        className={`text-text-faint hover:text-text-secondary flex h-6 w-4 shrink-0 touch-none items-center justify-center ${
          canReorder ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed'
        }`}
      >
        <Icon icon={GripVertical} size="xs" />
      </button>

      {linked ? (
        <span className={`text-text-primary w-40 shrink-0 ${TEXT}`} title={item.label}>
          {item.label}
        </span>
      ) : (
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setLabel(item.label)
          }}
          aria-label={`Label for ${item.label}`}
          title="Click to rename"
          className={`text-text-primary w-40 shrink-0 ${FIELD}`}
        />
      )}

      {editable ? (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setValue(item.value)
          }}
          aria-label={`Command for ${item.label}`}
          title="Click to edit"
          className={`text-text-secondary min-w-0 flex-1 font-mono ${FIELD}`}
        />
      ) : (
        <span
          className={`min-w-0 flex-1 font-mono ${TEXT} ${
            linked ? 'text-text-secondary' : 'text-text-faint'
          }`}
          title={linked ? item.value : 'A lifecycle or dialog button has a fixed action'}
        >
          {item.value}
        </span>
      )}

      {item.link && (
        <div className="flex shrink-0 items-center gap-1.5">
          <LinkBadge link={item.link} onAcknowledge={onAcknowledge} onUnlink={onUnlink} />
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onRun}
          disabled={item.kind === 'lifecycle' && item.value !== 'force-stop' && lifecycleBusy}
          className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary h-6 w-12 shrink-0 rounded border text-xs transition-all disabled:opacity-40"
        >
          Run
        </button>
        {linked ? (
          <IconButton onClick={onDuplicate} title={`Make a copy of ${item.label}`}>
            <Icon icon={CopyPlus} size="xs" />
          </IconButton>
        ) : (
          // Holds the column so the delete lines up whether or not a copy is
          // offered.
          <span aria-hidden className="h-6 w-6 shrink-0" />
        )}
        <IconButton onClick={onRemove} tone="danger" title={`Delete ${item.label}`}>
          <Icon icon={Trash2} size="xs" />
        </IconButton>
      </div>
    </div>
  )
}
