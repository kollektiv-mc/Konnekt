/**
 * The pure half of drag-to-reorder: where a dragged row lands, from the rows'
 * boxes and the pointer, with no DOM in sight so it can be tested as a function.
 *
 * `hooks/useSortable.ts` owns the pointer capture and the React state; this
 * file owns the two decisions the HTML5 drag-and-drop it replaces was making
 * implicitly, and wrongly. That implementation dropped *onto* a row and moved
 * the dragged one to that row's index, so a drop over the lower half of a row
 * landed one slot short of where the pointer was, and there was no way to drop
 * past the last row at all.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/**
 * How the rows are laid out, which decides what "before" means.
 *
 * - `y`: one column. Before a row is above its vertical midpoint.
 * - `grid`: rows wrap into columns in reading order. Before a cell is left of
 *   its midpoint when the pointer is on the cell's own line, above it otherwise.
 */
export type SortableAxis = 'y' | 'grid'

/**
 * The slot the pointer is over: the index the dragged row would be inserted
 * *before*, from 0 to `boxes.length` inclusive. The last value is "after
 * everything", which is the drop the old implementation could not express.
 */
export function slotAt(boxes: readonly Box[], point: Point, axis: SortableAxis): number {
  if (boxes.length === 0) return 0
  if (axis === 'y') {
    const i = boxes.findIndex((b) => point.y < b.y + b.height / 2)
    return i === -1 ? boxes.length : i
  }
  let nearest = 0
  let best = Infinity
  boxes.forEach((b, i) => {
    const dx = point.x - (b.x + b.width / 2)
    const dy = point.y - (b.y + b.height / 2)
    const d = dx * dx + dy * dy
    if (d < best) {
      best = d
      nearest = i
    }
  })
  const b = boxes[nearest]
  const onLine = point.y >= b.y && point.y < b.y + b.height
  const before = onLine ? point.x < b.x + b.width / 2 : point.y < b.y + b.height / 2
  return before ? nearest : nearest + 1
}

/**
 * The `to` index an `arrayMove(from, to)` needs to land `from` in `slot`, or
 * null when the slot is where the row already is. Taking the row out first
 * shifts everything after it up by one, which is the off-by-one this exists to
 * hold in one place.
 */
export function moveForSlot(from: number, slot: number): number | null {
  if (slot === from || slot === from + 1) return null
  return slot > from ? slot - 1 : slot
}
