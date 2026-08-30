import type { ReactNode } from 'react'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { ChevronDown } from '../../lib/icons'
import { Collapsible } from './Collapsible'
import { Icon } from './Icon'

interface NavSectionProps {
  /**
   * Persistence key, and the only thing that ties a card to its remembered
   * state: `servers`, `widgets`, `tiles`, `layouts`. Renaming one forgets that
   * section's collapse, which is a shrug rather than a bug.
   */
  id: string
  title: string
  /** Rendered faintly at the right of the header; the point of it is the collapsed state. */
  count?: number
  /** The section's own control, e.g. Servers' manage-servers expand. Never nested in the toggle. */
  action?: ReactNode
  /**
   * Called with the state the header just moved to, for a section holding
   * something that should not survive being closed — an armed destructive
   * control, say. Fires on the click, not on the write landing, because it is
   * about the gesture rather than about what was persisted.
   */
  onToggle?: (open: boolean) => void
  children: ReactNode
}

/**
 * One navbar section, wearing a dashboard tile's chrome but nailed down.
 *
 * The navbar's sections used to be captions: a `text-text-muted` uppercase
 * micro-label floating above its content, with nothing to say it could be
 * opened or closed, and only the last one could be. Giving them the card the
 * canvas already uses makes a section legible as an object you act on rather
 * than a label you read past — and the leading chevron, sitting where a tile's
 * icon sits, is what says which way it acts.
 *
 * Locked by construction, not by a prop: there is no drag handle, no maximize
 * and no close, because a navbar section has nowhere to go. That is the whole
 * difference from `tiles/TileWrapper`, whose chrome this mirrors — the border,
 * the radius, and the opaque base under a translucent surface film are copied
 * from there deliberately, so a skin retheming one retheme the other. Keep the
 * two in step by hand; extracting them into a shared class would have to unpick
 * TileWrapper's inline hover-border writes, which is a dashboard change
 * hitchhiking on a navbar one.
 */
export function NavSection({ id, title, count, action, onToggle, children }: NavSectionProps) {
  const closed = useSettingsStore((s) => s.settings.navClosedSections[id] === true)
  const update = useSettingsStore((s) => s.update)

  // Swallows on purpose: `update` puts the flag back itself if the write is
  // refused, so the card springs shut again on its own and `settings.error`
  // carries the reason. Nothing local mirrors the state, so there is nothing
  // else here to revert.
  const toggle = () => {
    const nav = useSettingsStore.getState().settings.navClosedSections
    onToggle?.(closed)
    update({ navClosedSections: { ...nav, [id]: !closed } }).catch(() => {})
  }

  return (
    <div className="border-border-subtle bg-canvas hover:border-border-hover border-hairline duration-fast rounded-panel flex shrink-0 flex-col overflow-hidden bg-[linear-gradient(var(--bg-surface),var(--bg-surface))] transition-colors">
      <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-1 pr-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!closed}
          className="hover:bg-hover flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pl-3 text-left transition-colors select-none"
        >
          {/* Where a tile header carries its icon. One glyph that rotates
              rather than two that swap: a lucide chevron's ink is centred in
              its box, so the rotation is a turn rather than a lurch, and a
              disclosure marker that *travels* between its two states is the
              part that reads as a hinge. */}
          <Icon
            icon={ChevronDown}
            size="sm"
            className={`text-text-muted duration-fast shrink-0 transition-transform ${
              closed ? '-rotate-90' : ''
            }`}
          />
          <span className="font-title text-text-secondary truncate text-xs font-medium">
            {title}
          </span>
          {count !== undefined && (
            <span className="text-text-faint text-2xs ml-auto shrink-0 pl-1">{count}</span>
          )}
        </button>
        {action}
      </div>

      <Collapsible open={!closed}>{children}</Collapsible>
    </div>
  )
}
