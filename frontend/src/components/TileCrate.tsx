import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TileDefinition } from '../types'
import { useTileStore } from '../stores/useTileStore'
import { useUiStore } from '../stores/useUiStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { TILE_REGISTRY } from '../tiles/registry'
import { dropIndexAt, reorderWithinGroup } from '../lib/crateOrder'
import { DURATION_MS } from '../styles/tokens'

// Pixels the pointer must travel before a press becomes a drag (vs a click).
const DRAG_THRESHOLD = 5

function resolveGroup(order: readonly string[], ids: ReadonlySet<string>): TileDefinition[] {
  const byId = new Map(TILE_REGISTRY.map((t) => [t.id, t]))
  return order
    .filter((id) => ids.has(id))
    .map((id) => byId.get(id))
    .filter((t): t is TileDefinition => t !== undefined)
}

// Committing a crate reorder. `update` reverts `crateOrder` itself if the write
// is refused, and the next render reads the reverted value back, so there is
// nothing to undo here — this only keeps a mouse handler from raising an
// unhandled rejection.
function persistCrateOrder(order: string[]) {
  useSettingsStore
    .getState()
    .update({ crateOrder: order })
    .catch(() => {})
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

interface Press {
  tile: TileDefinition
  group: ReadonlySet<string>
  startX: number
  startY: number
  dragging: boolean
  // null until the drag threshold is crossed; then tracks which zone the
  // pointer is currently in. Crossing back into the crate from the canvas
  // resumes aiming at a gap.
  mode: 'reorder' | 'canvas' | null
  // The gap the pointer last pointed at, mirroring `drop` in state. Held on the
  // press as well because the window listeners close over the render that
  // registered them, so by mouseup the `drop` they can see is the one from
  // before the gesture started.
  index: number | null
  shiftKey: boolean
}

/** Which row is being dragged, and the gap it would land in. */
interface Drop {
  id: string
  index: number
}

export function TileCrate() {
  const { activeTileIds, addTile } = useTileStore()
  const { requestMaximize, requestCloseMaximize, flashTile, setDraggingTileId, setCrateDragId } =
    useUiStore()
  const crateOrder = useSettingsStore((s) => s.settings.crateOrder)

  // Where the dragged row *would* land, not where anything has moved to.
  //
  // The rows used to reorder live under the pointer, which made the target move
  // as you approached it: you were aiming at a gap that the aiming itself kept
  // shifting. Nothing reorders until the release now, and this is the marker
  // that says where the release will put it.
  const [drop, setDrop] = useState<Drop | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  // Row tops measured just before a commit, for the animation below.
  const flipFrom = useRef<Map<string, number> | null>(null)

  const utilityIds = useMemo(
    () => new Set(TILE_REGISTRY.filter((t) => !t.maximizable).map((t) => t.id)),
    [],
  )
  const moduleIds = useMemo(
    () => new Set(TILE_REGISTRY.filter((t) => t.maximizable).map((t) => t.id)),
    [],
  )
  const order = crateOrder.length > 0 ? crateOrder : TILE_REGISTRY.map((t) => t.id)
  const utilityTiles = useMemo(() => resolveGroup(order, utilityIds), [order, utilityIds])
  const moduleTiles = useMemo(() => resolveGroup(order, moduleIds), [order, moduleIds])

  // The rows land in their new slots instantly — the order is the order. Play
  // the move they *would* have made, from where each row was to where it now
  // is, so the list reads as having rearranged rather than having been swapped
  // out. Runs only when a commit left tops behind, so an unrelated re-render
  // (a tile reaching the canvas, say) does not animate anything.
  useLayoutEffect(() => {
    const from = flipFrom.current
    if (!from) return
    flipFrom.current = null
    if (prefersReducedMotion()) return
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue('--ease-standard').trim() ||
      'ease'
    itemRefs.current.forEach((el, id) => {
      const was = from.get(id)
      // jsdom has no Web Animations API, and a row that was not on screen
      // before has no "from" to travel out of.
      if (was === undefined || typeof el.animate !== 'function') return
      const delta = was - el.getBoundingClientRect().top
      if (Math.abs(delta) < 1) return
      el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
        duration: DURATION_MS.fast,
        easing,
      })
    })
  }, [crateOrder])

  const handleClick = (tile: TileDefinition) => {
    if (tile.maximizable) {
      requestMaximize(tile.id, null)
      return
    }
    // Utility tile: never fullscreen. Close any open fullscreen, then add it to
    // the canvas (best available spot) if absent, and flash it green.
    requestCloseMaximize()
    place(tile)
  }

  // Shift-click: skip maximize entirely and add straight to the canvas — the
  // quick way to place a module tile without dragging it.
  const handleShiftClick = (tile: TileDefinition) => {
    requestCloseMaximize()
    place(tile)
  }

  // A refused `addTile` leaves the crate as it was, so the flash would announce
  // a placement that did not happen.
  const place = (tile: TileDefinition) => {
    if (activeTileIds.includes(tile.id)) {
      flashTile(tile.id)
      return
    }
    addTile(tile.id)
      .then(() => flashTile(tile.id))
      .catch(() => {})
  }

  const press = useRef<Press | null>(null)

  const withinCrateBounds = (x: number, y: number) => {
    const el = rootRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  // The gap the pointer is currently over, in the dragged row's own group. The
  // group's rendered order is the persisted one throughout, because nothing
  // moves until the drop — so unlike the live-reordering version this reads the
  // same rects on every frame of the gesture.
  const dropIndexFor = (p: Press, clientY: number): number => {
    const siblings = order.filter((id) => p.group.has(id) && id !== p.tile.id)
    const rows = siblings.map((id) => {
      const el = itemRefs.current.get(id)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { top: rect.top, height: rect.height }
    })
    return dropIndexAt(rows, clientY)
  }

  const onWindowMove = (e: MouseEvent) => {
    const p = press.current
    if (!p || p.shiftKey) return
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <= DRAG_THRESHOLD) return
      p.dragging = true
    }
    if (withinCrateBounds(e.clientX, e.clientY)) {
      if (p.mode === 'canvas') setDraggingTileId(null)
      if (p.mode !== 'reorder') setCrateDragId(p.tile.id)
      p.mode = 'reorder'
      const index = dropIndexFor(p, e.clientY)
      p.index = index
      // Most frames of a drag point at the gap the previous frame did. Holding
      // the same object through those keeps the crate off React's work list.
      setDrop((d) => (d && d.id === p.tile.id && d.index === index ? d : { id: p.tile.id, index }))
    } else {
      if (p.mode !== 'canvas') {
        setCrateDragId(null)
        setDraggingTileId(p.tile.id)
        // No half-applied reorder to freeze on the way out: the crate still
        // holds the persisted order, and the gap this was aiming at is simply
        // not the gesture any more. Dashboard's listeners own the drop now.
        p.index = null
        setDrop(null)
      }
      p.mode = 'canvas'
    }
  }

  const onWindowUp = () => {
    window.removeEventListener('mousemove', onWindowMove)
    window.removeEventListener('mouseup', onWindowUp)
    const p = press.current
    press.current = null
    setDrop(null)
    setCrateDragId(null)
    if (!p) return
    if (!p.dragging) {
      if (p.shiftKey) handleShiftClick(p.tile)
      else handleClick(p.tile)
      return
    }
    if (p.mode === 'reorder' && p.index !== null) {
      const next = reorderWithinGroup(order, p.group, p.tile.id, p.index)
      // Measured before the commit, because the commit is what moves them.
      flipFrom.current = new Map(
        [...itemRefs.current].map(([id, el]) => [id, el.getBoundingClientRect().top]),
      )
      persistCrateOrder(next)
    }
    // mode === 'canvas': Dashboard's own mouseup handler performs the drop
    // and clears draggingTileId; nothing left to do here.
  }

  const onMouseDown = (tile: TileDefinition, group: ReadonlySet<string>, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault() // stop text selection / focus during a drag
    press.current = {
      tile,
      group,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      mode: null,
      index: null,
      shiftKey: e.shiftKey,
    }
    window.addEventListener('mousemove', onWindowMove)
    window.addEventListener('mouseup', onWindowUp)
  }

  const renderTile = (tile: TileDefinition, group: ReadonlySet<string>) => {
    const onCanvas = activeTileIds.includes(tile.id)
    const held = drop?.id === tile.id
    // Mid-drag the hover styles come off entirely rather than being overridden.
    // `hover:border-border-subtle` is a variant, so it outranks the held row's
    // `border-accent` however the two are ordered in the class string — which
    // is what made the green outline vanish the moment the pointer sat on the
    // row it belonged to.
    const dragging = drop !== null
    return (
      <button
        key={tile.id}
        ref={(el) => {
          if (el) itemRefs.current.set(tile.id, el)
          else itemRefs.current.delete(tile.id)
        }}
        onMouseDown={(e) => onMouseDown(tile, group, e)}
        className={`border-hairline flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-left transition-all ${
          dragging ? '' : 'hover:border-border-subtle'
        } ${
          onCanvas
            ? `text-text-primary bg-transparent ${dragging ? '' : 'hover:bg-hover'}`
            : `text-text-secondary bg-black/20 ${dragging ? '' : 'hover:bg-black/10'}`
        } ${
          // The border colour is picked here rather than appended to a
          // `border-transparent` base: both are border-colour utilities, and
          // which one wins is decided by their order in the generated
          // stylesheet, not by their order in this string.
          held ? 'border-accent/60 opacity-40' : 'border-transparent'
        }`}
      >
        <span className="w-6 text-center text-base">{tile.icon}</span>
        <span className="flex-1 text-xs font-medium">{tile.label}</span>
      </button>
    )
  }

  /**
   * One group's rows, with the drop marker in the gap it points at.
   *
   * The marker's negative margin is what keeps the rows still: as a plain flex
   * child it would add its own height plus a second 4px gap, pushing everything
   * below it down by exactly the distance the rows are not supposed to move
   * until the drop. Cancelling that leaves a 2px bar centred in the existing
   * gap and the list untouched.
   */
  const renderGroup = (tiles: TileDefinition[], group: ReadonlySet<string>) => {
    const marker = <div key="drop" className="bg-accent -my-[3px] h-0.5 shrink-0 rounded-full" />
    const active = drop !== null && group.has(drop.id)
    const out: React.ReactNode[] = []
    let siblingIndex = 0
    for (const tile of tiles) {
      const isHeld = drop?.id === tile.id
      if (active && !isHeld && drop.index === siblingIndex) out.push(marker)
      out.push(renderTile(tile, group))
      // The marker is placed in the gaps between *siblings* of the held row, so
      // the held row itself does not advance the count.
      if (!isHeld) siblingIndex++
    }
    if (active && drop.index >= siblingIndex) out.push(marker)
    return out
  }

  return (
    <div ref={rootRef} className="flex flex-col">
      <div className="border-border-subtle border-b-hairline flex flex-col gap-1 p-2">
        {renderGroup(utilityTiles, utilityIds)}
      </div>
      <div className="flex flex-col gap-1 p-2">{renderGroup(moduleTiles, moduleIds)}</div>
    </div>
  )
}
