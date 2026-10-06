export interface Size {
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface Placement {
  primaryLeft: number
  primaryTop: number
  flyoutLeft: number
}

// Where the quick-add panels sit for a cursor at `pos`, in viewport CSS pixels.
// `panel` is the primary panel's measured size, and the fly-out shares its width.
// Flip at the right and bottom edges, clamp to the left and top so a flipped
// panel can never leave the viewport, and land on whole pixels so a fractional
// cursor position cannot blur the 2px category border or the icon column.
export function placeQuickAdd(pos: Point, panel: Size, viewport: Size): Placement {
  const maxLeft = Math.max(0, viewport.w - panel.w)
  const maxTop = Math.max(0, viewport.h - panel.h)

  const fitsRight = pos.x + panel.w <= viewport.w
  const primaryLeft = clamp(Math.round(fitsRight ? pos.x : pos.x - panel.w), 0, maxLeft)
  const primaryTop = clamp(
    Math.round(pos.y + panel.h > viewport.h ? pos.y - panel.h : pos.y),
    0,
    maxTop,
  )

  const flyoutFitsRight = primaryLeft + panel.w * 2 <= viewport.w
  const flyoutLeft = clamp(
    flyoutFitsRight ? primaryLeft + panel.w : primaryLeft - panel.w,
    0,
    maxLeft,
  )

  return { primaryLeft, primaryTop, flyoutLeft }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}
