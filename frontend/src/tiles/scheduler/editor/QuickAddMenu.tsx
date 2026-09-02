import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { models } from '../../../../wailsjs/go/models'
import {
  CATEGORY_BORDER_CLASS,
  CATEGORY_COLOR,
  CATEGORY_ICON,
  CATEGORY_TEXT_CLASS,
  orderedCategories,
} from './blockMeta'

const PANEL_W = 160

interface Props {
  blockDefs: models.BlockDef[]
  screenPos: { x: number; y: number }
  onPick: (def: models.BlockDef) => void
  onClose: () => void
}

export function QuickAddMenu({ blockDefs, screenPos, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const categories = orderedCategories(blockDefs)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return blockDefs.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q),
    )
  }, [blockDefs, query])

  const isSearching = query.trim().length > 0

  useEffect(() => {
    setHighlightIdx(0)
  }, [query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (!isSearching) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[highlightIdx]) onPick(filtered[highlightIdx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, isSearching, filtered, highlightIdx, onPick])

  const vw = window.innerWidth
  const vh = window.innerHeight

  const primaryLeft = screenPos.x + PANEL_W > vw ? screenPos.x - PANEL_W : screenPos.x
  const menuHeight =
    30 + (isSearching ? Math.min(filtered.length, 10) * 26 + 4 : categories.length * 28 + 4)
  const primaryTop =
    screenPos.y + menuHeight > vh ? Math.max(0, screenPos.y - menuHeight) : screenPos.y

  const flyoutLeft =
    primaryLeft + PANEL_W + PANEL_W > vw ? primaryLeft - PANEL_W : primaryLeft + PANEL_W

  const activeDefs = activeCategory ? blockDefs.filter((d) => d.category === activeCategory) : []
  const activeColor = activeCategory ? (CATEGORY_COLOR[activeCategory] ?? '#6b7280') : '#6b7280'

  const panelClass =
    'fixed z-popover w-40 bg-elevated border-hairline border-border-subtle rounded-lg overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md'

  // Portaled to body so the menu escapes the maximized tile's stacking
  // context; z-popover carries it over the maximize overlay (lib/layers.ts).
  // Backdrop and panels share the value: the panels are later siblings.
  return createPortal(
    <>
      {/* Dismiss backdrop */}
      <div className="z-popover fixed inset-0" onClick={onClose} />

      {/* Primary panel */}
      <div
        className={panelClass}
        // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
        style={{ left: primaryLeft, top: primaryTop }}
      >
        {/* Search input */}
        <div className="border-border-subtle border-b-hairline flex items-center gap-1 px-3 py-[5px]">
          <span className="text-text-faint text-[9px]">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search blocks…"
            className="text-text-primary flex-1 border-none bg-transparent font-mono text-[11px] outline-none"
          />
        </div>

        {/* Results area */}
        <div className="max-h-[260px] overflow-y-auto">
          {isSearching ? (
            filtered.length === 0 ? (
              <div className="text-text-faint px-3 py-1.5 font-mono text-[11px]">no results</div>
            ) : (
              filtered.map((def, i) => {
                const isHilit = i === highlightIdx
                const borderClass = CATEGORY_BORDER_CLASS[def.category] ?? 'border-l-[#6b7280]'
                return (
                  <div
                    key={def.id}
                    title={def.description}
                    onClick={() => onPick(def)}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`text-text-primary flex cursor-pointer items-center gap-1.5 border-l-2 px-3 py-1 font-mono text-[11px] select-none ${
                      isHilit ? `bg-hover ${borderClass}` : 'border-l-transparent bg-transparent'
                    }`}
                  >
                    <span className="flex-1">{def.label}</span>
                    <span className="text-text-faint text-[9px] uppercase">{def.category}</span>
                  </div>
                )
              })
            )
          ) : (
            categories.map((cat) => {
              const icon = CATEGORY_ICON[cat] ?? '?'
              const isActive = activeCategory === cat
              const textClass = CATEGORY_TEXT_CLASS[cat] ?? 'text-[#6b7280]'
              const borderClass = CATEGORY_BORDER_CLASS[cat] ?? 'border-l-[#6b7280]'
              return (
                <div
                  key={cat}
                  onMouseEnter={() => setActiveCategory(cat)}
                  className={`flex cursor-default items-center gap-1.5 border-l-2 px-3 py-[5px] font-mono text-[11px] select-none ${textClass} ${
                    isActive ? `bg-hover ${borderClass}` : 'border-l-transparent bg-transparent'
                  }`}
                >
                  <span>{icon}</span>
                  <span className="flex-1 uppercase">{cat}</span>
                  <span className="text-text-faint text-[9px]">›</span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Fly-out for category browse — hidden when searching */}
      {!isSearching && activeCategory && (
        <div
          className={panelClass}
          // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
          style={{ left: flyoutLeft, top: primaryTop }}
        >
          {activeDefs.map((def) => (
            <div
              key={def.id}
              title={def.description}
              onClick={() => onPick(def)}
              className="text-text-primary cursor-pointer border-l-2 border-l-transparent px-3 py-[5px] font-mono text-[11px] select-none"
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement
                el.style.borderLeftColor = activeColor
                el.style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement
                el.style.borderLeftColor = 'transparent'
                el.style.background = 'transparent'
              }}
            >
              {def.label}
            </div>
          ))}
        </div>
      )}
    </>,
    document.body,
  )
}
