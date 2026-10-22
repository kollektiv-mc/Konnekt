/** The row a fly-out belongs to, in viewport coordinates. */
export interface FlyoutAnchor {
  left: number
  right: number
  top: number
}

export interface FlyoutSize {
  w: number
  h: number
}

// Room between a panel and its fly-out, and the margin kept to the window.
const GAP = 4
const EDGE = 8

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi))
}

/**
 * Where a fly-out of `size` goes for `anchor`: `GAP` past its right edge and
 * level with its top, flipped to the left of the anchor when the right has no
 * room, then clamped into the window so a tall one slides up rather than off.
 * `side` is the one it landed on, which is where it grows from.
 */
export function placeFlyout(
  anchor: FlyoutAnchor,
  size: FlyoutSize,
  viewport: FlyoutSize,
): { x: number; y: number; side: 'right' | 'left' } {
  const fitsRight = anchor.right + GAP + size.w <= viewport.w - EDGE
  const side = fitsRight ? 'right' : 'left'
  const x = fitsRight ? anchor.right + GAP : anchor.left - GAP - size.w
  return {
    x: clamp(x, EDGE, viewport.w - size.w - EDGE),
    y: clamp(anchor.top, EDGE, viewport.h - size.h - EDGE),
    side,
  }
}
