import { useState } from 'react'
import { ChevronDown, ChevronRight } from '../../../lib/icons'
import { Icon } from '../../../components/ui/Icon'
import { NO_GRAPH_KEYS } from './blockMeta'
import { MenuDivider, MenuRow } from './MenuRow'
import type { EditRow } from './editMenuRows'

/**
 * Renders `editMenuRows` as popover rows. The two expanding rows (by type, by
 * name) open in place beneath themselves: the popover clips its overflow, so a
 * fly-out beside it would be cut off, and a nested list reads the same at the
 * toolbar's narrowest.
 */
export function EditMenuRows({ rows, onDone }: { rows: EditRow[]; onDone: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id))

  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'divider') return <MenuDivider key={row.id} />
        if (row.kind === 'item') {
          return (
            <MenuRow
              key={row.id}
              label={row.label}
              shortcut={row.shortcut}
              disabled={row.disabled}
              danger={row.danger}
              onClick={() => {
                row.onSelect()
                onDone()
              }}
            />
          )
        }
        const open = expanded === row.id
        const chevron = <Icon icon={open ? ChevronDown : ChevronRight} size="xs" />
        if (row.kind === 'group') {
          return (
            <div key={row.id}>
              <MenuRow
                label={row.label}
                disabled={row.disabled}
                expanded={open}
                trailing={chevron}
                onClick={() => toggle(row.id)}
              />
              {open &&
                row.items.map((item) => (
                  <MenuRow
                    key={item.id}
                    label={item.label}
                    indent
                    onClick={() => {
                      item.onSelect()
                      onDone()
                    }}
                  />
                ))}
            </div>
          )
        }
        return (
          <div key={row.id}>
            <MenuRow
              label={row.label}
              disabled={row.disabled}
              expanded={open}
              trailing={chevron}
              onClick={() => toggle(row.id)}
            />
            {open && (
              <SearchRow
                label={row.label}
                placeholder={row.placeholder}
                onCancel={() => setExpanded(null)}
                onSubmit={(query) => {
                  row.onSubmit(query)
                  onDone()
                }}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

function SearchRow({
  label,
  placeholder,
  onCancel,
  onSubmit,
}: {
  label: string
  placeholder: string
  onCancel: () => void
  onSubmit: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  return (
    <div className={`py-1 pr-3 pl-6 ${NO_GRAPH_KEYS}`}>
      <input
        autoFocus
        type="text"
        aria-label={label}
        value={query}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim() !== '') onSubmit(query)
          else if (e.key === 'Escape') {
            // Escape closes the maximized tile from a window listener; here it
            // only folds the row back up.
            e.stopPropagation()
            onCancel()
          }
        }}
        className="bg-canvas border-border-subtle text-text-primary border-hairline text-1xs focus:border-accent w-full rounded px-1.5 py-0.5 font-mono outline-none"
      />
    </div>
  )
}
