interface Size {
  w: number
  h: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Keeps the card off the window's own edge, so it never sits flush against it. */
const EDGE_MARGIN_PX = 4

// Where a tooltip sits for an anchor, in viewport CSS pixels. It goes to the
// right of the anchor, vertically centred on it, and flips to the left when the
// right side would run off the window. Both axes are then clamped, so a card
// taller than the room left over, or an anchor at the very edge, still lands
// inside the viewport instead of being cut off. Whole pixels, so the hairline
// border stays crisp.
export function placeTooltip(
  anchor: Rect,
  tip: Size,
  viewport: Size,
  gap: number,
): { left: number; top: number } {
  const maxLeft = Math.max(0, viewport.w - tip.w - EDGE_MARGIN_PX)
  const maxTop = Math.max(EDGE_MARGIN_PX, viewport.h - tip.h - EDGE_MARGIN_PX)

  const fitsRight = anchor.right + gap + tip.w <= viewport.w - EDGE_MARGIN_PX
  const left = fitsRight ? anchor.right + gap : anchor.left - gap - tip.w
  const top = (anchor.top + anchor.bottom) / 2 - tip.h / 2

  return {
    left: Math.round(clamp(left, EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, maxLeft))),
    top: Math.round(clamp(top, EDGE_MARGIN_PX, maxTop)),
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}
