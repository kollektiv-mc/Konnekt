import { useRef, useState } from 'react'
import { ChevronRight } from '../../../lib/icons'
import { Flyout } from '../../../components/ui/Flyout'
import type { FlyoutAnchor } from '../../../lib/flyoutPlacement'
import { Icon } from '../../../components/ui/Icon'
import { usePresence, useRetained } from '../../../hooks/usePresence'
import { NO_GRAPH_KEYS } from './blockMeta'
import { MenuDivider, MenuRow } from './MenuRow'
import type { EditRow } from './editMenuRows'

interface OpenFlyout {
  id: string
  anchor: FlyoutAnchor
  /** Opened from a click or a key rather than a hover: focus goes into it. */
  focus: boolean
}

// The panel's surface is the popover's, so a fly-out reads as more of the same menu.
const FLYOUT_PANEL = `border-border-subtle bg-overlay border-hairline max-w-64 min-w-44 overflow-hidden rounded-lg ${NO_GRAPH_KEYS}`

/**
 * Renders `editMenuRows` as popover rows. The two expanding rows (by type, by
 * name) open a fly-out beside themselves, on hover and on click, Enter or the
 * right arrow. It is portalled out of the popover (`Flyout`): opening a list in
 * place made the popover grow and then scroll inside the tile, and a fly-out
 * outside the tile's overflow has neither problem.
 *
 * `active` is whether the popover is open, so that closing it takes the fly-out
 * with it, and both play their exits together.
 */
export function EditMenuRows({
  rows,
  onDone,
  active,
}: {
  rows: EditRow[]
  onDone: () => void
  active: boolean
}) {
  const [open, setOpen] = useState<OpenFlyout | null>(null)
  // The popover closing drops the fly-out, during render so it is never drawn
  // once more against the next opening.
  if (!active && open) setOpen(null)

  const list = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const shown = useRetained(open)
  const presence = usePresence(open !== null, 'menu')

  const openAt = (id: string, focus: boolean) => {
    setOpen((prev) => {
      if (prev?.id === id) return focus && !prev.focus ? { ...prev, focus } : prev
      const row = rowEls.current.get(id)?.getBoundingClientRect()
      const column = list.current?.getBoundingClientRect()
      if (!row || !column) return prev
      return { id, focus, anchor: { left: column.left, right: column.right, top: row.top } }
    })
  }

  const closeFlyout = (returnFocusTo?: string) => {
    setOpen(null)
    if (returnFocusTo) rowEls.current.get(returnFocusTo)?.querySelector('button')?.focus()
  }

  const row = shown ? rows.find((r) => r.id === shown.id) : undefined

  return (
    <div ref={list}>
      {rows.map((r) => {
        if (r.kind === 'divider') return <MenuDivider key={r.id} />
        const expanding = r.kind === 'group' || r.kind === 'search'
        return (
          <div
            key={r.id}
            ref={(el) => {
              if (el) rowEls.current.set(r.id, el)
              else rowEls.current.delete(r.id)
            }}
            // Hovering a row closes a fly-out that is not its own, which is
            // how one folds away; leaving the popover for the fly-out does not.
            onMouseEnter={() => {
              if (expanding && !r.disabled) openAt(r.id, false)
              else setOpen(null)
            }}
          >
            {r.kind === 'item' ? (
              <MenuRow
                label={r.label}
                shortcut={r.shortcut}
                disabled={r.disabled}
                danger={r.danger}
                onClick={() => {
                  r.onSelect()
                  onDone()
                }}
              />
            ) : (
              <MenuRow
                label={r.label}
                disabled={r.disabled}
                hasPopup
                expanded={open?.id === r.id}
                trailing={<Icon icon={ChevronRight} size="xs" />}
                onClick={() => openAt(r.id, true)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    openAt(r.id, true)
                  }
                }}
              />
            )}
          </div>
        )
      })}

      {presence.mounted && shown && row && (row.kind === 'group' || row.kind === 'search') && (
        <Flyout
          key={shown.id}
          anchor={shown.anchor}
          label={row.label}
          className={`${FLYOUT_PANEL} ${presence.panelClass}`}
          leaving={presence.leaving}
          focusOnOpen={shown.focus}
          onAnimationEnd={presence.onAnimationEnd}
          onKeyDown={(e) => {
            // Escape closes the maximized tile from a window listener; here it
            // only folds the fly-out back into its row.
            if (e.key === 'Escape') {
              e.stopPropagation()
              closeFlyout(shown.id)
            } else if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) {
              e.preventDefault()
              closeFlyout(shown.id)
            }
          }}
        >
          {row.kind === 'group' ? (
            row.items.map((item) => (
              <MenuRow
                key={item.id}
                label={item.label}
                onClick={() => {
                  item.onSelect()
                  onDone()
                }}
              />
            ))
          ) : (
            <SearchField
              label={row.label}
              placeholder={row.placeholder}
              onSubmit={(query) => {
                row.onSubmit(query)
                onDone()
              }}
            />
          )}
        </Flyout>
      )}
    </div>
  )
}

function SearchField({
  label,
  placeholder,
  onSubmit,
}: {
  label: string
  placeholder: string
  onSubmit: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  return (
    <div className={`px-3 py-1.5 ${NO_GRAPH_KEYS}`}>
      <input
        type="text"
        aria-label={label}
        value={query}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter on a blank query does nothing, and Escape is the fly-out's.
          if (e.key === 'Enter' && query.trim() !== '') onSubmit(query)
        }}
        className="bg-canvas border-border-subtle text-text-primary border-hairline text-1xs focus:border-accent w-full rounded px-1.5 py-0.5 font-mono outline-none"
      />
    </div>
  )
}
