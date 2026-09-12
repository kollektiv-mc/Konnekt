import { Icon } from '../../../components/ui/Icon'
import { Tag } from '../../../components/ui/Tag'
import { Link2, TriangleAlert } from '../../../lib/icons'
import type { CommandButton } from '../../../stores/useCommandsStore'

interface LinkBadgeProps {
  link: NonNullable<CommandButton['link']>
  onAcknowledge: () => void
  onUnlink: () => void
}

const ACTION = 'text-text-muted hover:text-text-primary text-2xs shrink-0 whitespace-nowrap'

/**
 * The link state of one row, and the action that resolves it.
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
 * - `broken` means the original is not in Kommands' file any more: unlinked or
 *   deleted there, or the file is gone. The button was placed here on purpose,
 *   so it is kept with its last text, and the one thing offered is to make it
 *   this server's own; the row's own delete covers the other choice.
 */
export function LinkBadge({ link, onAcknowledge, onUnlink }: LinkBadgeProps) {
  if (link.status === 'broken') {
    return (
      <>
        <Tag
          tone="warning"
          title="Not in Kommands any more, unlinked or deleted there. This still runs the last text it was given."
        >
          <Icon icon={TriangleAlert} size="xs" />
          Unlinked in Kommands
        </Tag>
        <button
          onClick={onUnlink}
          className={ACTION}
          title="Stop following Kommands and keep this as a command of this server's own"
        >
          Keep
        </button>
      </>
    )
  }

  if (link.status === 'changed') {
    return (
      <>
        <Tag tone="accent" title="An edit in Kommands was applied to this command">
          <Icon icon={Link2} size="xs" />
          Updated in Kommands
        </Tag>
        <button
          onClick={onAcknowledge}
          className={ACTION}
          title="Keep the update and clear this badge"
        >
          Got it
        </button>
      </>
    )
  }

  return (
    <Tag title="Follows its original in Kommands. Edit or unlink it there; take a copy to change it here.">
      <Icon icon={Link2} size="xs" />
      Kommands
    </Tag>
  )
}
