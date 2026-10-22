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

// Where the fly-out's top edge goes: level with the category row the pointer is
// on, so moving straight right lands on its first entry instead of crossing the
// rows below it (#672). `rowOffset` is the row's top measured from the primary
// panel's top, not a viewport coordinate, so it stays right if the primary panel
// moves (flipped up, then resized by a search) after the row was measured. A list
// too tall for the room below the row slides up to stay inside the window, and
// one taller than the window pins to the top edge, like the primary panel does.
export function placeFlyoutTop(
  primaryTop: number,
  rowOffset: number,
  flyoutHeight: number,
  viewportHeight: number,
): number {
  return clamp(Math.round(primaryTop + rowOffset), 0, Math.max(0, viewportHeight - flyoutHeight))
}

// Where a group's own panel goes, beside the fly-out it opened from. It keeps
// going the way the fly-out went (right of a right-hand fly-out, left of a
// left-hand one); when that side has no room it takes the far side of the
// primary panel instead, which is free whichever way the fly-out went, so it
// never lands on top of the panel the pointer came from.
export function placeGroupPanelLeft(
  primaryLeft: number,
  flyoutLeft: number,
  panelWidth: number,
  viewportWidth: number,
): number {
  const maxLeft = Math.max(0, viewportWidth - panelWidth)
  const goesRight = flyoutLeft >= primaryLeft
  const onward = goesRight ? flyoutLeft + panelWidth : flyoutLeft - panelWidth
  if (onward >= 0 && onward <= maxLeft) return onward
  const farSide = goesRight ? primaryLeft - panelWidth : primaryLeft + panelWidth
  return clamp(farSide, 0, maxLeft)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}
