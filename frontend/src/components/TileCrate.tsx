import { useMemo, useRef, useState } from 'react'
import type { TileDefinition } from '../types'
import { useTileStore } from '../stores/useTileStore'
import { useUiStore } from '../stores/useUiStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { TILE_REGISTRY } from '../tiles/registry'
import { reorderWithinGroup } from '../lib/crateOrder'

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

interface Press {
  tile: TileDefinition
  group: ReadonlySet<string>
  startX: number
  startY: number
  dragging: boolean
  // null until the drag threshold is crossed; then tracks which zone the
  // pointer is currently in. Crossing back into the crate from the canvas
  // resumes reordering; nothing here persists until a freeze/commit point.
  mode: 'reorder' | 'canvas' | null
  liveOrder: string[] | null
  shiftKey: boolean
}

export function TileCrate() {
  const { activeTileIds, addTile } = useTileStore()
  const { requestMaximize, requestCloseMaximize, flashTile, setDraggingTileId } = useUiStore()
  const crateOrder = useSettingsStore((s) => s.settings.crateOrder)

  // Live-preview order while a reorder drag is in progress — kept out of the
  // persisted store so we're not calling SaveAppSettings on every pointer
  // frame. Committed (see freeze/commit points below) only when the gesture
  // leaves the crate for the canvas, or ends.
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  const utilityIds = useMemo(
    () => new Set(TILE_REGISTRY.filter((t) => !t.maximizable).map((t) => t.id)),
    [],
  )
  const moduleIds = useMemo(
    () => new Set(TILE_REGISTRY.filter((t) => t.maximizable).map((t) => t.id)),
    [],
  )
  const order =
    previewOrder ?? (crateOrder.length > 0 ? crateOrder : TILE_REGISTRY.map((t) => t.id))
  const utilityTiles = useMemo(() => resolveGroup(order, utilityIds), [order, utilityIds])
  const moduleTiles = useMemo(() => resolveGroup(order, moduleIds), [order, moduleIds])

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

  // Insertion index within the dragged tile's group, from the current
  // visual (not persisted) order — so the break below walks siblings
  // top-to-bottom exactly as they're rendered.
  const reorderTo = (p: Press, clientY: number): string[] => {
    const baseOrder = p.liveOrder ?? order
    const siblingIds = baseOrder.filter((id) => p.group.has(id) && id !== p.tile.id)
    let index = 0
    for (const id of siblingIds) {
      const el = itemRefs.current.get(id)
      if (!el) {
        index++
        continue
      }
      const rect = el.getBoundingClientRect()
      if (clientY > rect.top + rect.height / 2) index++
      else break
    }
    return reorderWithinGroup(baseOrder, p.group, p.tile.id, index)
  }

  const onWindowMove = (e: MouseEvent) => {
    const p = press.current
    if (!p || p.shiftKey) return
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <= DRAG_THRESHOLD) return
      p.dragging = true
      p.liveOrder = order
    }
    if (withinCrateBounds(e.clientX, e.clientY)) {
      if (p.mode === 'canvas') setDraggingTileId(null)
      p.mode = 'reorder'
      p.liveOrder = reorderTo(p, e.clientY)
      setPreviewOrder(p.liveOrder)
    } else {
      if (p.mode !== 'canvas') {
        setDraggingTileId(p.tile.id)
        // Freeze whatever reordering happened before the tile left the crate
        // — Dashboard's own listeners take over the canvas-drop from here.
        if (p.liveOrder) persistCrateOrder(p.liveOrder)
      }
      p.mode = 'canvas'
    }
  }

  const onWindowUp = () => {
    window.removeEventListener('mousemove', onWindowMove)
    window.removeEventListener('mouseup', onWindowUp)
    const p = press.current
    press.current = null
    setPreviewOrder(null)
    if (!p) return
    if (!p.dragging) {
      if (p.shiftKey) handleShiftClick(p.tile)
      else handleClick(p.tile)
      return
    }
    if (p.mode === 'reorder' && p.liveOrder) {
      persistCrateOrder(p.liveOrder)
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
      liveOrder: null,
      shiftKey: e.shiftKey,
    }
    window.addEventListener('mousemove', onWindowMove)
    window.addEventListener('mouseup', onWindowUp)
  }

  const renderTile = (tile: TileDefinition, group: ReadonlySet<string>) => {
    const onCanvas = activeTileIds.includes(tile.id)
    return (
      <button
        key={tile.id}
        ref={(el) => {
          if (el) itemRefs.current.set(tile.id, el)
          else itemRefs.current.delete(tile.id)
        }}
        onMouseDown={(e) => onMouseDown(tile, group, e)}
        className={`hover:border-border-subtle border-hairline flex cursor-grab items-center gap-2 rounded-lg border-transparent px-3 py-2 text-left transition-all ${
          onCanvas
            ? 'text-text-primary hover:bg-hover bg-transparent'
            : 'text-text-secondary bg-black/20 hover:bg-black/10'
        }`}
      >
        <span className="w-6 text-center text-base">{tile.icon}</span>
        <span className="flex-1 text-xs font-medium">{tile.label}</span>
      </button>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col">
      <div className="border-border-subtle border-b-hairline flex flex-col gap-1 p-2">
        {utilityTiles.map((t) => renderTile(t, utilityIds))}
      </div>
      <div className="flex flex-col gap-1 p-2">
        {moduleTiles.map((t) => renderTile(t, moduleIds))}
      </div>
    </div>
  )
}
