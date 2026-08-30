import { Icon } from '../../../components/ui/Icon'
import { Link2, Link2Off, TriangleAlert } from '../../../lib/icons'
import type { CommandButton } from '../../../stores/useCommandsStore'

interface LinkBadgeProps {
  link: NonNullable<CommandButton['link']>
  onAcknowledge: () => void
  onRevert: () => void
  onUnlink: () => void
  onRemove: () => void
}

/**
 * The link state of one row, and the actions that resolve it.
 *
 * Three states, and the decisions behind them are not symmetrical:
 *
 * - `ok` is quiet on purpose. A link that is working is not news.
 * - `changed` means an edit in Kommands was already applied here. It is shown
 *   after the fact rather than as a prompt, because a modal per edit is exactly
 *   what the decision rejected — but it stays until acknowledged, so a command
 *   cannot change meaning without the user ever being told.
 * - `broken` means the original is gone. The button is kept and only offered
 *   for removal: deleting somebody's working button because another application
 *   tidied up is hostile.
 */
export function LinkBadge({ link, onAcknowledge, onRevert, onUnlink, onRemove }: LinkBadgeProps) {
  if (link.status === 'broken') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-warning border-warning/30 bg-warning/10 border-hairline text-2xs flex items-center gap-1 rounded px-1.5 py-0.5">
          <Icon icon={TriangleAlert} size="xs" />
          Original deleted
        </span>
        <button onClick={onUnlink} className="text-text-muted hover:text-text-primary text-2xs">
          Unlink
        </button>
        <button onClick={onRemove} className="text-text-muted hover:text-danger text-2xs">
          Remove
        </button>
      </div>
    )
  }

  if (link.status === 'changed') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-accent border-accent/30 bg-accent/10 border-hairline text-2xs flex items-center gap-1 rounded px-1.5 py-0.5">
          <Icon icon={Link2} size="xs" />
          Updated in Kommands
        </span>
        <button
          onClick={onAcknowledge}
          className="text-text-muted hover:text-text-primary text-2xs"
          title="Keep the update and clear this badge"
        >
          Got it
        </button>
        <button
          onClick={onRevert}
          className="text-text-muted hover:text-text-primary text-2xs"
          title={
            link.prevValue
              ? `Put back "${link.prevValue}" and unlink`
              : 'Put back the previous version and unlink'
          }
        >
          Revert
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-text-muted border-border-subtle border-hairline text-2xs flex items-center gap-1 rounded px-1.5 py-0.5">
        <Icon icon={Link2} size="xs" />
        Linked
      </span>
      <button
        onClick={onUnlink}
        className="text-text-faint hover:text-text-primary text-2xs flex items-center gap-1"
        title="Stop following the Kommands original"
      >
        <Icon icon={Link2Off} size="xs" />
      </button>
    </div>
  )
}
