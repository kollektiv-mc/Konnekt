import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { moveForSlot, slotAt, type Box, type SortableAxis } from '../lib/sortable'

/** How far the pointer travels before a press on the handle becomes a drag. */
const DRAG_THRESHOLD_PX = 4

export interface SortableDrag {
  /** The row being dragged, by index. */
  from: number
  /** Where it would land: an insertion index, 0..count inclusive. */
  slot: number
  /** The pointer's travel since the press, for the lifted row's transform. */
  dx: number
  dy: number
  /** Where every row sat at the press, which is what the others shift between. */
  boxes: Box[]
}

/** A translation, in CSS pixels. */
export interface Offset {
  dx: number
  dy: number
}

interface Session {
  from: number
  boxes: Box[]
  originX: number
  originY: number
  lifted: boolean
}

interface Options {
  count: number
  axis: SortableAxis
  disabled?: boolean
  /** Called once, on release or on an arrow key, with what `arrayMove` takes. */
  onMove: (from: number, to: number) => void
}

/** What the grip handle of row `i` spreads onto itself. */
export interface SortableHandleProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

/**
 * Pointer-driven reordering for a column or a wrapped grid of rows.
 *
 * Pointer events rather than HTML5 drag and drop, which this replaces, for
 * three reasons that all showed up in the Commands tile. A `draggable` row
 * claims mousedown for everything inside it, so text in the row's inputs could
 * not be selected by dragging; the only feedback the browser gives is a
 * translucent copy of the row, with no say over where the drop will land; and
 * drop delivery differs across the three WebViews this app ships on. Capturing
 * the pointer on the grip gives one code path everywhere, keeps the inputs
 * ordinary, and lets the row itself be the thing that moves.
 *
 * The hook holds the drag; the caller draws it. `drag` says which row is lifted
 * and how far it has travelled, `rowRef(i)` measures rows at press time,
 * `shift(i)` says how far every other row moves aside, and `handleProps(i)`
 * goes on the grip. The feedback is the rows making room: the ones between the
 * lifted row's old place and its new one slide by one position, so the gap is
 * always exactly where the drop will land. A marker line was tried first and
 * lost to the lifted row itself, which covers the very edge it points at as
 * soon as the pointer reaches it.
 *
 * Keyboard reordering rides the same handle: an arrow key moves the row one
 * step, so a list that can be dragged can also be rearranged without a pointer.
 */
export function useSortable({ count, axis, disabled = false, onMove }: Options) {
  const [drag, setDrag] = useState<SortableDrag | null>(null)
  const rows = useRef<(HTMLElement | null)[]>([])
  const refs = useRef(new Map<number, (el: HTMLElement | null) => void>())
  const session = useRef<Session | null>(null)

  // Stable per index, or React would detach and reattach every row's ref on
  // every render of the list.
  const rowRef = useCallback((i: number) => {
    let ref = refs.current.get(i)
    if (!ref) {
      ref = (el) => {
        rows.current[i] = el
      }
      refs.current.set(i, ref)
    }
    return ref
  }, [])

  const end = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const s = session.current
      session.current = null
      if (!s) return
      // jsdom has no pointer capture; the real WebViews all do.
      if (typeof e.currentTarget.hasPointerCapture === 'function') {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      }
      setDrag(null)
      if (!s.lifted) return
      const to = moveForSlot(s.from, slotAt(s.boxes, { x: e.clientX, y: e.clientY }, axis))
      if (to !== null) onMove(s.from, to)
    },
    [axis, onMove],
  )

  const handleProps = useCallback(
    (i: number): SortableHandleProps => ({
      onPointerDown: (e) => {
        if (disabled || e.button !== 0) return
        // Keeps the press from selecting text or focusing the row's inputs.
        e.preventDefault()
        // Measured once, at the press: the boxes are where the rows sit before
        // anything lifts, which is the geometry a slot is judged against.
        const boxes = rows.current.slice(0, count).map((el): Box => {
          const r = el?.getBoundingClientRect()
          return r
            ? { x: r.x, y: r.y, width: r.width, height: r.height }
            : { x: 0, y: 0, width: 0, height: 0 }
        })
        session.current = { from: i, boxes, originX: e.clientX, originY: e.clientY, lifted: false }
        if (typeof e.currentTarget.setPointerCapture === 'function') {
          e.currentTarget.setPointerCapture(e.pointerId)
        }
      },
      onPointerMove: (e) => {
        const s = session.current
        if (!s) return
        const dx = e.clientX - s.originX
        const dy = e.clientY - s.originY
        if (!s.lifted && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        s.lifted = true
        setDrag({
          from: s.from,
          slot: slotAt(s.boxes, { x: e.clientX, y: e.clientY }, axis),
          dx,
          dy,
          boxes: s.boxes,
        })
      },
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown: (e) => {
        if (disabled) return
        const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
        const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
        if (!back && !forward) return
        const to = i + (back ? -1 : 1)
        if (to < 0 || to >= count) return
        e.preventDefault()
        onMove(i, to)
      },
    }),
    [axis, count, disabled, end, onMove],
  )

  /**
   * How far row `i` moves aside while another row is dragged, or null when it
   * stays put. A row between the lifted row's old place and its landing slot
   * takes the position of its neighbour on the far side, measured from the
   * boxes captured at the press, so a column and a wrapped grid both come out
   * right: in a grid the neighbour's box may be on another line, and that is
   * exactly where the row goes.
   */
  const shift = useCallback(
    (i: number): Offset | null => {
      if (!drag || i === drag.from) return null
      const to = moveForSlot(drag.from, drag.slot)
      if (to === null) return null
      let takes: number
      if (to > drag.from && i > drag.from && i <= to) takes = i - 1
      else if (to < drag.from && i >= to && i < drag.from) takes = i + 1
      else return null
      const here = drag.boxes[i]
      const there = drag.boxes[takes]
      if (!here || !there) return null
      return { dx: there.x - here.x, dy: there.y - here.y }
    },
    [drag],
  )

  return { drag, rowRef, handleProps, shift }
}
