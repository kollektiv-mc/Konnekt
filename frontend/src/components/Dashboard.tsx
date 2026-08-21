import { useEffect, useMemo, useCallback, useRef, useState, Fragment, useLayoutEffect } from 'react'
import { GridLayout, useContainerWidth, bottom } from 'react-grid-layout'
import type { LayoutItem } from 'react-grid-layout'
import {
  calcXY,
  calcGridColWidth,
  calcGridItemWHPx,
  type PositionParams,
} from 'react-grid-layout/core'
import 'react-grid-layout/css/styles.css'
import { useTileStore } from '../stores/useTileStore'
import { useLayoutStore } from '../stores/useLayoutStore'
import { useServerConfigStore } from '../stores/useServerConfigStore'
import { useUiStore } from '../stores/useUiStore'
import { TILE_REGISTRY } from '../tiles/registry'
import { TileWrapper } from '../tiles/TileWrapper'
import { COLS, ROW_HEIGHT } from '../lib/constants'
import { GRID_COMPACTOR, TILE_SIZE, TILE_MIN, TILE_MAX, withGhost } from '../lib/gridSizing'

const ANIM_MS = 120
const GRID_MARGIN: readonly [number, number] = [12, 12]
const GRID_CONTAINER_PADDING: readonly [number, number] = [12, 12]
const GHOST_ID = '__ghost__'

// Flip animation transform relative to the canvas container, not the viewport.
function flipTransform(rect: DOMRect, containerRect: DOMRect, padding: number) {
  const fullW = containerRect.width - padding * 2
  const fullH = containerRect.height - padding * 2
  const sx = rect.width / fullW
  const sy = rect.height / fullH
  const tx = rect.left + rect.width / 2 - (containerRect.left + containerRect.width / 2)
  const ty = rect.top + rect.height / 2 - (containerRect.top + containerRect.height / 2)
  return `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`
}

// Pixel box a w x h item would occupy centered on (clientX, clientY),
// translated into the grid cell it lands on. Measures against the RGL grid
// container's own rect (not the scrollable viewport around it) — the grid
// container's top moves with scroll exactly like RGL's own handleDragOver
// does, so no manual scrollTop arithmetic is needed.
function cellAt(
  pp: PositionParams,
  gridRect: DOMRect,
  clientX: number,
  clientY: number,
  w: number,
  h: number,
) {
  const colWidth = calcGridColWidth(pp)
  const itemPxW = calcGridItemWHPx(w, colWidth, GRID_MARGIN[0])
  const itemPxH = calcGridItemWHPx(h, ROW_HEIGHT, GRID_MARGIN[1])
  const left = clientX - gridRect.left - itemPxW / 2
  const top = clientY - gridRect.top - itemPxH / 2
  return calcXY(pp, top, left, w, h)
}

export function Dashboard() {
  const { activeTileIds, loadTiles, removeTile } = useTileStore()
  const { currentLayout, updateLayout, loadPresets } = useLayoutStore()
  const { activeId: serverId } = useServerConfigStore()
  const { maximizeRequest, clearMaximizeRequest, closeRequest, draggingTileId, flashTileId } =
    useUiStore()

  // containerRef: the positioned root used to anchor the absolute overlay
  const containerRef = useRef<HTMLDivElement>(null)
  // canvasRef: the scrollable viewport — used only to hit-test whether the
  // pointer is over the visible canvas (it clips via overflow, so bounds
  // here correctly exclude the scrolled-off part of a tall grid).
  // gridRef: the actual .react-grid-layout container — used for the pixel
  // math, since its own rect moves with scroll exactly like RGL's internal
  // handleDragOver measures it, with no manual scrollTop needed.
  const { width: canvasWidth, containerRef: canvasRef } = useContainerWidth({ initialWidth: 800 })
  const gridRef = useRef<HTMLDivElement>(null)
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const originRectRef = useRef<DOMRect | null>(null)
  const pendingOpenRef = useRef<{ id: string; rect: DOMRect | null } | null>(null)
  const prevCloseReqRef = useRef(closeRequest)
  // Live pointer position (viewport coords) while dragging a tile from the navbar.
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null)

  const positionParams: PositionParams = useMemo(
    () => ({
      margin: GRID_MARGIN,
      containerPadding: GRID_CONTAINER_PADDING,
      containerWidth: canvasWidth,
      cols: COLS,
      rowHeight: ROW_HEIGHT,
      maxRows: Infinity,
    }),
    [canvasWidth],
  )
  const colWidth = useMemo(() => calcGridColWidth(positionParams), [positionParams])
  const colStep = colWidth + GRID_MARGIN[0]
  const rowStep = ROW_HEIGHT + GRID_MARGIN[1]

  const openMaximize = useCallback((id: string, originRect?: DOMRect | null) => {
    if (originRect !== undefined) {
      originRectRef.current = originRect
    } else {
      const el = document.querySelector(`[data-tile-id="${id}"]`)
      originRectRef.current = el ? el.getBoundingClientRect() : null
    }
    setClosing(false)
    setMaximizedId(id)
  }, [])

  const closeMaximize = useCallback(() => {
    const guard = useUiStore.getState().closeGuard
    if (guard && guard()) {
      // Guard is handling the close itself (e.g. showing a confirm dialog) —
      // drop any queued tile-switch so a later cancel doesn't jump to it.
      pendingOpenRef.current = null
      return
    }
    setClosing(true)
  }, [])

  const toggleMaximize = useCallback(
    (id: string) => {
      if (maximizedId) closeMaximize()
      else openMaximize(id)
    },
    [maximizedId, openMaximize, closeMaximize],
  )

  // Consume maximize requests raised by the navbar
  useEffect(() => {
    if (!maximizeRequest) return
    if (maximizedId && maximizeRequest.id === maximizedId) {
      // Same tile: toggle closed
      pendingOpenRef.current = null
      closeMaximize()
    } else if (maximizedId) {
      // Different tile while one is open: close first, then open the new one
      pendingOpenRef.current = { id: maximizeRequest.id, rect: maximizeRequest.rect }
      if (!closing) closeMaximize()
    } else {
      openMaximize(maximizeRequest.id, maximizeRequest.rect)
    }
    clearMaximizeRequest()
  }, [maximizeRequest, maximizedId, closing, openMaximize, closeMaximize, clearMaximizeRequest])

  // Consume close requests raised by the navbar (utility-tile click)
  useEffect(() => {
    if (closeRequest === prevCloseReqRef.current) return
    prevCloseReqRef.current = closeRequest
    closeMaximize()
  }, [closeRequest, closeMaximize])

  // Unmount overlay after close animation finishes; open pending tile if one was queued
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => {
      setMaximizedId(null)
      setClosing(false)
      originRectRef.current = null
      const pending = pendingOpenRef.current
      if (pending) {
        pendingOpenRef.current = null
        openMaximize(pending.id, pending.rect)
      }
    }, ANIM_MS + 20)
    return () => clearTimeout(timer)
  }, [closing, openMaximize])

  // Expand animation — runs synchronously after the overlay mounts
  useLayoutEffect(() => {
    if (!maximizedId) return
    const rect = originRectRef.current
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return
    const padding = 24 // p-6

    if (backdropRef.current) {
      const el = backdropRef.current
      el.style.transition = 'none'
      el.style.backgroundColor = 'rgba(0,0,0,0)'
      void el.offsetHeight
      el.style.transition = `background-color ${ANIM_MS}ms ease`
      el.style.backgroundColor = 'rgba(0,0,0,0.6)'
    }

    let cleanupId: ReturnType<typeof setTimeout> | undefined

    if (panelRef.current && rect) {
      const panel = panelRef.current
      panel.style.transition = 'none'
      panel.style.transformOrigin = 'center'
      panel.style.opacity = '0'
      panel.style.transform = flipTransform(rect, containerRect, padding)
      void panel.offsetHeight
      panel.style.transition = `transform 180ms cubic-bezier(0.34, 1.15, 0.64, 1), opacity 140ms ease-out`
      panel.style.opacity = '1'
      panel.style.transform = 'translate(0px, 0px) scale(1, 1)'
      // After the animation lands, strip the inline transform so the panel has no
      // CSS transform at all. Leaving even an identity transform (scale(1,1)) causes
      // WebView2/Chromium to allocate the WebGL compositing layer at the tile's
      // initial visual size (the small flip-start scale), producing a canvas that
      // doesn't fill the maximized panel.
      cleanupId = setTimeout(() => {
        if (panelRef.current) {
          panelRef.current.style.transform = ''
          panelRef.current.style.transition = ''
        }
      }, 200)
    } else if (panelRef.current) {
      const panel = panelRef.current
      panel.style.transition = 'none'
      panel.style.transformOrigin = 'center'
      panel.style.opacity = '0'
      panel.style.transform = 'scale(0.93)'
      void panel.offsetHeight
      panel.style.transition = `transform 180ms cubic-bezier(0.34, 1.15, 0.64, 1), opacity 140ms ease-out`
      panel.style.opacity = '1'
      panel.style.transform = 'scale(1)'
    }

    return () => clearTimeout(cleanupId)
  }, [maximizedId]) // intentionally excludes `closing` — only fires on open

  // Collapse animation — runs when closing becomes true
  useLayoutEffect(() => {
    if (!closing) return
    const rect = originRectRef.current
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return
    const padding = 24

    if (backdropRef.current) {
      backdropRef.current.style.transition = `background-color ${ANIM_MS}ms ease`
      backdropRef.current.style.backgroundColor = 'rgba(0,0,0,0)'
    }

    if (panelRef.current && rect) {
      const panel = panelRef.current
      panel.style.transition = `transform 130ms cubic-bezier(0.4, 0, 1, 0.6), opacity 120ms ease-in`
      panel.style.opacity = '0'
      panel.style.transform = flipTransform(rect, containerRect, padding)
    } else if (panelRef.current) {
      const panel = panelRef.current
      panel.style.transition = `transform 130ms cubic-bezier(0.4, 0, 1, 0.6), opacity 120ms ease-in`
      panel.style.opacity = '0'
      panel.style.transform = 'scale(0.93)'
    }
  }, [closing])

  useEffect(() => {
    Promise.all([loadTiles(), loadPresets()]).catch(console.error)
  }, [loadTiles, loadPresets])

  useEffect(() => {
    if (!maximizedId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMaximize()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [maximizedId, closeMaximize])

  const tilesOnCanvas = useMemo(
    () =>
      activeTileIds
        .map((id) => TILE_REGISTRY.find((t) => t.id === id))
        .filter((t): t is (typeof TILE_REGISTRY)[number] => t !== undefined),
    [activeTileIds],
  )

  // Real tiles only. A newly-active tile with no saved position (click-add,
  // shift-click) goes in at the bottom — react-grid-layout's own convention
  // for "no layout entry yet" — and the compactor below pulls it into the
  // best gap. The whole array is run through the compactor before being
  // returned, so mergedLayout is always the true resting state, never a raw
  // pre-compaction shape that only looks right after react-grid-layout's own
  // internal sync effect quietly fixes it up.
  const mergedLayout = useMemo(() => {
    const activeIds = new Set(tilesOnCanvas.map((t) => t.id))
    const savedItems = currentLayout.filter((l) => isFinite(l.y) && activeIds.has(l.i))
    const placed: LayoutItem[] = [...savedItems]
    const result: LayoutItem[] = []

    for (const tile of tilesOnCanvas) {
      const saved = savedItems.find((l) => l.i === tile.id)
      const constraints = { minW: TILE_MIN.w, minH: TILE_MIN.h, maxW: TILE_MAX.w, maxH: TILE_MAX.h }
      if (saved) {
        result.push({ ...saved, ...constraints })
      } else {
        const item: LayoutItem = {
          i: tile.id,
          x: 0,
          y: bottom(placed),
          w: TILE_SIZE.w,
          h: TILE_SIZE.h,
          ...constraints,
        }
        result.push(item)
        placed.push(item)
      }
    }

    return [...GRID_COMPACTOR.compact(result, COLS)]
  }, [tilesOnCanvas, currentLayout])

  // Persist exactly what's rendered — minW/minH/maxW/maxH are re-derived from
  // the shared constants on every render (see mergedLayout above) and must
  // never be the persisted source of truth.
  const persistLayout = useCallback(
    (layout: readonly LayoutItem[]) => {
      const stripped = layout
        .filter((l) => l.i !== GHOST_ID)
        .map(({ minW: _mw, minH: _mh, maxW: _xw, maxH: _xh, ...rest }) => rest as LayoutItem)
      updateLayout(stripped)
    },
    [updateLayout],
  )

  // Removing a tile only ever touches activeTileIds; re-run the compactor on
  // what's left so the persisted layout doesn't lag a render behind what's
  // on screen (react-grid-layout's own internal state already reflects the
  // gap closing — this just keeps our copy in sync with it).
  // The layout write only happens once the tile write has landed: persisting a
  // recompacted layout for a tile that is still active would close a gap the
  // canvas still fills.
  const handleRemoveTile = useCallback(
    (id: string) => {
      const remaining = mergedLayout.filter((l) => l.i !== id)
      removeTile(id)
        .then(() => persistLayout(GRID_COMPACTOR.compact(remaining, COLS)))
        .catch(() => {})
    },
    [removeTile, mergedLayout, persistLayout],
  )

  // Tile being dragged from the navbar, if it isn't already on canvas
  const draggingTile =
    draggingTileId && !activeTileIds.includes(draggingTileId)
      ? TILE_REGISTRY.find((t) => t.id === draggingTileId)
      : undefined

  // Map a viewport point to the grid cell the dragged tile would land at.
  // Every tile is the same size, so this is a single calculation — no more
  // per-tile bucket-fitting. Returns null when the pointer is outside the
  // visible canvas. A plain function (not memoized): it's only ever called
  // synchronously during render for `dropCell` below, so it just closes over
  // the current render's `positionParams` directly.
  function pointerToCell(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid) return null
    const viewport = canvas.getBoundingClientRect()
    if (
      clientX < viewport.left ||
      clientX > viewport.right ||
      clientY < viewport.top ||
      clientY > viewport.bottom
    ) {
      return null
    }
    const gridRect = grid.getBoundingClientRect()
    const cell = cellAt(positionParams, gridRect, clientX, clientY, TILE_SIZE.w, TILE_SIZE.h)
    return { x: cell.x, y: cell.y, w: TILE_SIZE.w, h: TILE_SIZE.h }
  }

  const dropCell = dragPointer && draggingTile ? pointerToCell(dragPointer.x, dragPointer.y) : null

  // Full preview of the board with the ghost placed at dropCell, run through
  // the same compactor the grid itself uses — computed here (not left to
  // react-grid-layout's own internal, invisible-to-us sync effect) so the
  // ref below can mirror the *actual* positions for the on-drop commit.
  // Compacting an already-compacted array is idempotent, so react-grid-layout
  // compacting this again internally for display produces the same result.
  const previewLayout = useMemo(() => {
    if (!dropCell) return mergedLayout
    return withGhost(mergedLayout, { i: GHOST_ID, ...dropCell }, COLS)
  }, [mergedLayout, dropCell])

  const previewRef = useRef<{ cell: typeof dropCell; layout: LayoutItem[] }>({
    cell: null,
    layout: mergedLayout,
  })
  previewRef.current = { cell: dropCell, layout: previewLayout }

  // Mounted once: track the pointer while dragging and perform the drop on
  // release, committing the ref-mirrored preview above rather than
  // recomputing pointerToCell from the mouseup event.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!useUiStore.getState().draggingTileId) return
      setDragPointer({ x: e.clientX, y: e.clientY })
    }
    const onUp = () => {
      const id = useUiStore.getState().draggingTileId
      setDragPointer(null)
      if (!id) return
      useUiStore.getState().setDraggingTileId(null)
      if (useTileStore.getState().activeTileIds.includes(id)) return
      const { cell, layout } = previewRef.current
      if (!cell) return // released outside the canvas → cancel
      // Same ordering as handleRemoveTile: claim the grid slot only once the
      // tile is actually active, or the persisted layout keeps a slot for a
      // tile that never landed.
      useTileStore
        .getState()
        .addTile(id)
        .then(() => persistLayout(layout.map((l) => (l.i === GHOST_ID ? { ...l, i: id } : l))))
        .catch(() => {})
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [persistLayout])

  // Cursor-following wireframe, alongside the in-layout ghost/placeholder —
  // matching native RGL's own pairing of "item under your hand" + "snapped
  // landing spot". Every tile is the same size, so this never changes shape
  // mid-drag.
  const wireframeRect = useMemo(() => {
    if (!dragPointer || !dropCell) return null
    const itemPxW = calcGridItemWHPx(dropCell.w, colWidth, GRID_MARGIN[0])
    const itemPxH = calcGridItemWHPx(dropCell.h, ROW_HEIGHT, GRID_MARGIN[1])
    return {
      left: dragPointer.x - itemPxW / 2,
      top: dragPointer.y - itemPxH / 2,
      width: itemPxW,
      height: itemPxH,
    }
  }, [dragPointer, dropCell, colWidth])

  return (
    // containerRef is the positioned root for the absolute overlay — it covers
    // only the canvas area, so the navbar stays visible during fullscreen.
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <div
        ref={canvasRef}
        className="bg-canvas h-full w-full overflow-y-auto bg-local"
        // eslint-disable-next-line no-restricted-syntax -- background-size/position track the live grid col/row step (canvasWidth-dependent), not static
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: `${colStep}px ${rowStep}px`,
          backgroundPosition: `${GRID_CONTAINER_PADDING[0]}px ${GRID_CONTAINER_PADDING[1]}px`,
        }}
      >
        <GridLayout
          innerRef={gridRef}
          width={canvasWidth}
          layout={previewLayout}
          compactor={GRID_COMPACTOR}
          gridConfig={{
            cols: COLS,
            rowHeight: ROW_HEIGHT,
            margin: GRID_MARGIN,
            containerPadding: GRID_CONTAINER_PADDING,
          }}
          dragConfig={{ handle: '.drag-handle' }}
          resizeConfig={{ handles: ['se'] }}
          onDragStop={persistLayout}
          onResizeStop={persistLayout}
        >
          {tilesOnCanvas.map((tile) => {
            const TileComponent = tile.component
            return (
              <div key={tile.id} data-tile-id={tile.id}>
                <TileWrapper
                  id={tile.id}
                  label={tile.label}
                  icon={tile.icon}
                  onRemove={handleRemoveTile}
                  maximizable={tile.maximizable}
                  onToggleMaximize={toggleMaximize}
                  flash={flashTileId === tile.id}
                >
                  <TileComponent serverId={serverId} />
                </TileWrapper>
              </div>
            )
          })}
          {dropCell && (
            <div
              key={GHOST_ID}
              className="bg-hover border-border-subtle border-hairline pointer-events-none h-full w-full rounded-[10px]"
            />
          )}
        </GridLayout>
      </div>

      {/* Cursor-following wireframe while dragging from the crate — pairs
          with the snapped ghost/placeholder above exactly like native RGL
          pairs a dragged item with its landing-spot placeholder. Positioned
          against the viewport (fixed), not the scrollable canvas. */}
      {wireframeRect && (
        <div
          className="border-accent bg-accent/6 pointer-events-none fixed z-[60] rounded-[10px] border-2"
          // eslint-disable-next-line no-restricted-syntax -- cursor-following wireframe position, computed per drag frame
          style={{
            left: wireframeRect.left,
            top: wireframeRect.top,
            width: wireframeRect.width,
            height: wireframeRect.height,
          }}
        />
      )}

      {maximizedId &&
        (() => {
          const tile = TILE_REGISTRY.find((t) => t.id === maximizedId)
          if (!tile) return null
          const TileComponent = tile.component
          return (
            <Fragment>
              {/* Backdrop — animated separately from panel so only the bg fades */}
              <div
                ref={backdropRef}
                className="absolute inset-0 z-50"
                onClick={!closing ? closeMaximize : undefined}
              />
              {/* Panel — pointer-events-none on container so backdrop receives clicks */}
              <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-6">
                <div
                  ref={panelRef}
                  className="pointer-events-auto h-full w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <TileWrapper
                    id={tile.id}
                    label={tile.label}
                    icon={tile.icon}
                    onRemove={handleRemoveTile}
                    maximizable
                    maximized
                    onToggleMaximize={toggleMaximize}
                  >
                    <TileComponent serverId={serverId} maximized />
                  </TileWrapper>
                </div>
              </div>
            </Fragment>
          )
        })()}
    </div>
  )
}
