import { useEffect, useState } from 'react'
import { Icon } from '../../../components/ui/Icon'
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
  'focus:border-border-hover hover:border-border-subtle rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs transition-colors outline-none'

/**
 * One command in the library: label and value editable in place, at a size the
 * compact grid has never had room for.
 *
 * A linked row is the exception, and shows its text as text. Its label and
 * command are Kommands', it exists because it was linked there, and an edit
 * here would either be undone by the next sync or stop the link meaning
 * anything. So the row offers a copy instead — the same text under this
 * server's own identity — and keeps the original following its source. That
 * replaced fork-on-edit, which unlinked the row the user was typing into and
 * then watched the sync bring the original back beside it.
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
  // Removing a row that Kommands still lists would only have the next sync put
  // it back, so the trash is not offered there; the way to remove it is to
  // unlink it in Kommands. A row whose file is gone is removable, since nothing
  // would return it.
  const removable = !linked || item.link?.status === 'broken'

  return (
    <div
      ref={rowRef}
      className={`flex items-center gap-2 rounded border px-2 py-1.5 ${
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
        className={`text-text-faint hover:text-text-secondary shrink-0 touch-none ${
          canReorder ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed'
        }`}
      >
        <Icon icon={GripVertical} size="xs" />
      </button>

      <span className="text-text-faint border-border-subtle border-hairline text-2xs shrink-0 rounded px-1.5 py-0.5">
        {item.kind}
      </span>

      {linked ? (
        <span
          className="text-text-primary w-40 shrink-0 truncate px-1.5 py-0.5 text-xs"
          title={item.label}
        >
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
          className={`min-w-0 flex-1 truncate px-1.5 py-0.5 font-mono text-xs ${
            linked ? 'text-text-secondary' : 'text-text-faint'
          }`}
          title={linked ? item.value : 'A lifecycle or dialog button has a fixed action'}
        >
          {item.value}
        </span>
      )}

      {item.link && (
        <LinkBadge link={item.link} onAcknowledge={onAcknowledge} onUnlink={onUnlink} />
      )}

      <button
        onClick={onRun}
        disabled={item.kind === 'lifecycle' && item.value !== 'force-stop' && lifecycleBusy}
        className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary shrink-0 rounded border px-2 py-0.5 text-xs transition-all disabled:opacity-40"
      >
        Run
      </button>

      {linked && (
        <button
          onClick={onDuplicate}
          aria-label={`Make a copy of ${item.label}`}
          title="Make a copy that is this server's own to edit"
          className="text-text-faint hover:text-text-primary shrink-0 transition-colors"
        >
          <Icon icon={CopyPlus} size="xs" />
        </button>
      )}

      {removable && (
        <button
          onClick={onRemove}
          aria-label={`Delete ${item.label}`}
          className="text-text-faint hover:text-danger shrink-0 transition-colors"
        >
          <Icon icon={Trash2} size="xs" />
        </button>
      )}
    </div>
  )
}
