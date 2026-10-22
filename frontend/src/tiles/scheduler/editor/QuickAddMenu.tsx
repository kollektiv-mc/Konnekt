import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { models } from '../../../../wailsjs/go/models'
import { useOutsideDismiss } from '../../../hooks/useOutsideDismiss'
import {
  CATEGORY_ICON,
  categoryBorderClass,
  categoryColor,
  categoryTextClass,
  NO_GRAPH_KEYS,
  orderedCategories,
} from './blockMeta'
import { blockEntries } from './blockGroups'
import { placeFlyoutTop, placeGroupPanelLeft, placeQuickAdd, type Size } from './quickAddPlacement'

// First-paint guess only; the primary panel is measured before the browser paints.
const INITIAL_PANEL: Size = { w: 160, h: 0 }

interface Props {
  blockDefs: models.BlockDef[]
  screenPos: { x: number; y: number }
  onPick: (def: models.BlockDef) => void
  onClose: () => void
  /** An exit is playing (QuickAddHost keeps the menu mounted for it). */
  leaving?: boolean
}

export function QuickAddMenu({ blockDefs, screenPos, onPick, onClose, leaving = false }: Props) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const groupPanelRef = useRef<HTMLDivElement>(null)
  const [panelSize, setPanelSize] = useState<Size>(INITIAL_PANEL)
  const [flyoutHeight, setFlyoutHeight] = useState(0)
  // The hovered category row's top, from the primary panel's top (#672).
  const [rowOffset, setRowOffset] = useState(0)
  // A group row in the fly-out opens a third panel, placed the same way: level
  // with its row, measured, clamped.
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [groupHeight, setGroupHeight] = useState(0)
  const [groupOffset, setGroupOffset] = useState(0)
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
        (d.group ?? '').toLowerCase().includes(q) ||
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

  // Measure the rendered panel so flipping and clamping use its real size, not
  // a constant that drifts from the CSS. Runs before paint, again whenever the
  // row count (and so the height) changes.
  const rowCount = isSearching ? filtered.length : categories.length
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPanelSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }))
  }, [rowCount])

  const viewport = { w: window.innerWidth, h: window.innerHeight }
  const { primaryLeft, primaryTop, flyoutLeft } = placeQuickAdd(screenPos, panelSize, viewport)
  const flyoutTop = placeFlyoutTop(primaryTop, rowOffset, flyoutHeight, viewport.h)

  // A press outside closes it, with no backdrop to eat that press: the one
  // that closes the menu also pans, selects or opens the next menu.
  useOutsideDismiss(!leaving, onClose, [panelRef, flyoutRef, groupPanelRef], true)

  const activeDefs = activeCategory ? blockDefs.filter((d) => d.category === activeCategory) : []
  const activeEntries = blockEntries(activeDefs)
  const activeGroupEntry = activeEntries.find((e) => e.kind === 'group' && e.name === activeGroup)
  const groupDefs = activeGroupEntry?.kind === 'group' ? activeGroupEntry.defs : []
  const showGroupPanel = !isSearching && activeCategory !== null && groupDefs.length > 0
  const groupTop = placeFlyoutTop(flyoutTop, groupOffset, groupHeight, viewport.h)
  const groupLeft = placeGroupPanelLeft(primaryLeft, flyoutLeft, panelSize.w, viewport.w)

  // The fly-out is measured like the primary panel, so the clamp to the window
  // uses its real height. Re-run per category, since each list is a different
  // length.
  useLayoutEffect(() => {
    const el = flyoutRef.current
    if (!el) return
    const { height } = el.getBoundingClientRect()
    setFlyoutHeight((prev) => (prev === height ? prev : height))
  }, [activeCategory, isSearching, activeDefs.length])

  useLayoutEffect(() => {
    const el = groupPanelRef.current
    if (!el) return
    const { height } = el.getBoundingClientRect()
    setGroupHeight((prev) => (prev === height ? prev : height))
  }, [activeGroup, activeCategory, isSearching, groupDefs.length])

  function hoverCategory(cat: string, row: HTMLElement) {
    const panel = panelRef.current
    if (panel) setRowOffset(row.getBoundingClientRect().top - panel.getBoundingClientRect().top)
    // A group belongs to the category it was opened in; a same-named group in
    // the next category must not open by itself.
    if (cat !== activeCategory) setActiveGroup(null)
    setActiveCategory(cat)
  }

  function hoverGroup(name: string, row: HTMLElement) {
    const flyout = flyoutRef.current
    if (flyout) setGroupOffset(row.getBoundingClientRect().top - flyout.getBoundingClientRect().top)
    setActiveGroup(name)
  }
  const activeColor = categoryColor(activeCategory ?? '')

  // A block row in either fly-out panel. Hovering one also closes any open group
  // panel: the pointer has left the group row for a plain block.
  function blockRow(def: models.BlockDef, inFlyout: boolean) {
    return (
      <div
        key={def.id}
        title={def.description}
        onClick={() => onPick(def)}
        className="text-text-primary text-1xs border-l-2 border-l-transparent px-3 py-[5px] font-mono select-none"
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderLeftColor = activeColor
          el.style.background = 'var(--hover-surface)'
          // A member of the group panel itself is where the pointer is headed,
          // so only the fly-out's own blocks close it.
          if (inFlyout) setActiveGroup(null)
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderLeftColor = 'transparent'
          el.style.background = 'transparent'
        }}
      >
        {def.label}
      </div>
    )
  }

  // Both panels share it, so NO_GRAPH_KEYS lands on both. The menu is portaled
  // to body, well outside the canvas, but React Flow binds its keys to the
  // document, so being elsewhere in the tree guards nothing (#159).
  const panelClass = `fixed z-popover w-40 bg-overlay border-hairline border-border-subtle rounded-lg overflow-hidden ${NO_GRAPH_KEYS} ${leaving ? 'menu-out pointer-events-none' : 'menu-in'}`
  // Both panels grow from the corner the menu opened at, which is the far one
  // where placeQuickAdd flipped it.
  const originX = primaryLeft < screenPos.x ? 'right' : 'left'
  const originY = primaryTop < screenPos.y ? 'bottom' : 'top'

  // Portaled to body so the menu escapes the maximized tile's stacking
  // context; z-popover carries it over the maximize overlay (lib/layers.ts).
  return createPortal(
    <>
      {/* Primary panel */}
      <div
        ref={panelRef}
        className={panelClass}
        // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
        style={{ left: primaryLeft, top: primaryTop, transformOrigin: `${originX} ${originY}` }}
      >
        {/* Search input */}
        <div className="border-border-subtle border-b-hairline flex items-center gap-1 px-3 py-[5px]">
          <span className="text-text-faint text-3xs">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search blocks…"
            className="text-text-primary text-1xs min-w-0 flex-1 border-none bg-transparent font-mono outline-none"
          />
        </div>

        {/* Results area */}
        <div className="max-h-[260px] overflow-y-auto">
          {isSearching ? (
            filtered.length === 0 ? (
              <div className="text-text-faint text-1xs px-3 py-1.5 font-mono">no results</div>
            ) : (
              filtered.map((def, i) => {
                const isHilit = i === highlightIdx
                const borderClass = categoryBorderClass(def.category)
                return (
                  <div
                    key={def.id}
                    title={def.description}
                    onClick={() => onPick(def)}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`text-text-primary text-1xs flex items-center gap-1.5 border-l-2 px-3 py-1 font-mono select-none ${
                      isHilit ? `bg-hover ${borderClass}` : 'border-l-transparent bg-transparent'
                    }`}
                  >
                    <span className="flex-1">{def.label}</span>
                    <span className="text-text-faint text-3xs uppercase">
                      {def.group ?? def.category}
                    </span>
                  </div>
                )
              })
            )
          ) : (
            categories.map((cat) => {
              const icon = CATEGORY_ICON[cat] ?? '?'
              const isActive = activeCategory === cat
              const textClass = categoryTextClass(cat)
              const borderClass = categoryBorderClass(cat)
              return (
                <div
                  key={cat}
                  onMouseEnter={(e) => hoverCategory(cat, e.currentTarget)}
                  className={`text-1xs flex cursor-default items-center gap-1.5 border-l-2 px-3 py-[5px] font-mono select-none ${textClass} ${
                    isActive ? `bg-hover ${borderClass}` : 'border-l-transparent bg-transparent'
                  }`}
                >
                  <span>{icon}</span>
                  <span className="flex-1 uppercase">{cat}</span>
                  <span className="text-text-faint text-3xs">›</span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Fly-out for category browse — hidden when searching */}
      {!isSearching && activeCategory && (
        <div
          ref={flyoutRef}
          className={panelClass}
          // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
          style={{
            left: flyoutLeft,
            top: flyoutTop,
            transformOrigin: `${flyoutLeft < primaryLeft ? 'right' : 'left'} ${originY}`,
          }}
        >
          {activeEntries.map((entry) => {
            if (entry.kind === 'block') return blockRow(entry.def, true)
            const isActive = activeGroup === entry.name
            return (
              <div
                key={`group:${entry.name}`}
                onMouseEnter={(e) => hoverGroup(entry.name, e.currentTarget)}
                className={`text-text-primary text-1xs flex cursor-default items-center gap-1.5 border-l-2 px-3 py-[5px] font-mono select-none ${
                  isActive
                    ? `bg-hover ${categoryBorderClass(activeCategory ?? '')}`
                    : 'border-l-transparent bg-transparent'
                }`}
              >
                <span className="flex-1">{entry.name}</span>
                <span className="text-text-faint text-3xs">›</span>
              </div>
            )
          })}
        </div>
      )}

      {/* A group's blocks, beside the fly-out and level with the group's row */}
      {showGroupPanel && (
        <div
          ref={groupPanelRef}
          className={panelClass}
          // eslint-disable-next-line no-restricted-syntax -- left/top are viewport-computed positions (clamped against window dimensions)
          style={{ left: groupLeft, top: groupTop }}
        >
          {groupDefs.map((def) => blockRow(def, false))}
        </div>
      )}
    </>,
    document.body,
  )
}
