import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { GripVertical, Trash2 } from '../../../lib/icons'
import type { CommandButton } from '../../../stores/useCommandsStore'
import { LinkBadge } from './LinkBadge'

interface CommandRowProps {
  item: CommandButton
  /** Index in the full ordered array, not in the filtered view. */
  index: number
  canReorder: boolean
  lifecycleBusy: boolean
  onRun: () => void
  onEdit: (patch: Partial<CommandButton>) => void
  onRemove: () => void
  onReorder: (from: number, to: number) => void
  onAcknowledge: () => void
  onRevert: () => void
  onUnlink: () => void
}

/**
 * One command in the library: label and value editable in place, at a size the
 * compact grid has never had room for.
 *
 * `kind` is deliberately not editable. A `lifecycle` value is one of a fixed
 * set the frontend dispatches on and a `special` value names a dialog, so
 * retyping either would produce a button that does nothing. Delete and re-add
 * from the presets instead.
 */
export function CommandRow({
  item,
  index,
  canReorder,
  lifecycleBusy,
  onRun,
  onEdit,
  onRemove,
  onReorder,
  onAcknowledge,
  onRevert,
  onUnlink,
}: CommandRowProps) {
  const [label, setLabel] = useState(item.label)
  const [value, setValue] = useState(item.value)
  const [over, setOver] = useState(false)
  const dragFrom = useRef<number | null>(null)

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

  const editable = item.kind === 'cmd'

  return (
    <div
      draggable={canReorder}
      onDragStart={(e) => {
        dragFrom.current = index
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!canReorder) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        setOver(false)
        const from = dragFrom.current
        dragFrom.current = null
        if (from !== null) onReorder(from, index)
      }}
      onDragEnd={() => {
        dragFrom.current = null
        setOver(false)
      }}
      className={`flex items-center gap-2 rounded border px-2 py-1.5 transition-colors ${
        over ? 'border-border-hover bg-hover' : 'border-border-subtle'
      }`}
    >
      <span
        className={canReorder ? 'cursor-grab' : 'cursor-not-allowed'}
        title={canReorder ? 'Drag to reorder' : 'Clear the search and filter to reorder'}
      >
        <Icon icon={GripVertical} size="xs" className="text-text-faint" />
      </span>

      <span className="text-text-faint border-border-subtle border-hairline text-2xs shrink-0 rounded px-1.5 py-0.5">
        {item.kind}
      </span>

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
        className="text-text-primary focus:border-border-hover w-40 shrink-0 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs transition-colors outline-none"
      />

      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitValue}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setValue(item.value)
        }}
        readOnly={!editable}
        title={editable ? undefined : 'A lifecycle or dialog button has a fixed action'}
        aria-label={`Command for ${item.label}`}
        className={`focus:border-border-hover min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs transition-colors outline-none ${
          editable ? 'text-text-secondary' : 'text-text-faint'
        }`}
      />

      {item.link && (
        <LinkBadge
          link={item.link}
          onAcknowledge={onAcknowledge}
          onRevert={onRevert}
          onUnlink={onUnlink}
          onRemove={onRemove}
        />
      )}

      <button
        onClick={onRun}
        disabled={item.kind === 'lifecycle' && item.value !== 'force-stop' && lifecycleBusy}
        className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary shrink-0 rounded border px-2 py-0.5 text-xs transition-all disabled:opacity-40"
      >
        Run
      </button>

      <button
        onClick={onRemove}
        aria-label={`Delete ${item.label}`}
        className="text-text-faint hover:text-danger shrink-0 transition-colors"
      >
        <Icon icon={Trash2} size="xs" />
      </button>
    </div>
  )
}
