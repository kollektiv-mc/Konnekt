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
export function NavSection({ id, title, action, onToggle, children }: NavSectionProps) {
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
      {/* The tint sits on the bar, not on the button inside it. On the button it
          stopped 12px short of the card's right edge — 50px short where a
          section has an action — so it cut off exactly where the card's rounded
          corner begins, which is the one place a background most needs to
          reach. The bar spans the full width and the card's overflow-hidden
          rounds the tint into the corner for free. Hovering the action lights
          the bar too; that is the right reading, and the action's own hover
          square stacking on top is what marks it as the more specific target. */}
      <div className="border-border-subtle hover:bg-hover border-b-hairline flex shrink-0 items-center gap-1 pr-3 transition-colors">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!closed}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pl-3 text-left select-none"
        >
          {/* Where a tile header carries its icon, and in the same 24x24 box the
              crate rows put theirs in — a bare 16px glyph here starts its ink
              4px left of every row below it, which was half the stagger down
              this navbar. One glyph that rotates rather than two that swap: a
              lucide chevron's ink is centred in its box, so the rotation is a
              turn rather than a lurch, and a disclosure marker that *travels*
              between its two states is the part that reads as a hinge. */}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            <Icon
              icon={ChevronDown}
              size="sm"
              className={`text-text-muted duration-fast transition-transform ${
                closed ? '-rotate-90' : ''
              }`}
            />
          </span>
          <span className="font-title text-text-secondary truncate text-xs font-medium">
            {title}
          </span>
        </button>
        {action}
      </div>

      <Collapsible open={!closed}>{children}</Collapsible>
    </div>
  )
}
