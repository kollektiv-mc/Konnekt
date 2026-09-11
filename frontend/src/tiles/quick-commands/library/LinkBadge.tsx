import { Icon } from '../../../components/ui/Icon'
import { Link2, TriangleAlert } from '../../../lib/icons'
import type { CommandButton } from '../../../stores/useCommandsStore'

interface LinkBadgeProps {
  link: NonNullable<CommandButton['link']>
  onAcknowledge: () => void
  onUnlink: () => void
}

/**
 * The link state of one row, and the actions that resolve it.
 *
 * Three states, and the decisions behind them are not symmetrical:
 *
 * - `ok` names where the command comes from and nothing more. A link that is
 *   working is not news, but a row that cannot be edited here needs to say
 *   why, and "Kommands" is the why.
 * - `changed` means an edit in Kommands was already applied here. It is shown
 *   after the fact rather than as a prompt, because a modal per edit is exactly
 *   what the decision rejected — but it stays until acknowledged, so a command
 *   cannot change meaning without the user ever being told.
 * - `broken` means Kommands' file is gone altogether (an uninstall, a moved
 *   directory). The button still holds the last text it was given, so it is
 *   kept, and the one thing offered is to make it this server's own. A command
 *   merely unlinked in Kommands never reaches this state: Go removes its button.
 */
export function LinkBadge({ link, onAcknowledge, onUnlink }: LinkBadgeProps) {
  if (link.status === 'broken') {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="text-warning border-warning/30 bg-warning/10 border-hairline text-2xs flex items-center gap-1 rounded px-1.5 py-0.5"
          title="The file Kommands shares is not there any more. This still runs the last text it was given."
        >
          <Icon icon={TriangleAlert} size="xs" />
          Kommands not found
        </span>
        <button
          onClick={onUnlink}
          className="text-text-muted hover:text-text-primary text-2xs"
          title="Stop following Kommands and keep this as a command of this server's own"
        >
          Keep as custom
        </button>
      </div>
    )
  }

  if (link.status === 'changed') {
    return (
      <div className="flex shrink-0 items-center gap-2">
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
      </div>
    )
  }

  return (
    <span
      className="text-text-muted border-border-subtle border-hairline text-2xs flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5"
      title="Follows its original in Kommands. Edit or unlink it there; take a copy to change it here."
    >
      <Icon icon={Link2} size="xs" />
      Kommands
    </span>
  )
}
