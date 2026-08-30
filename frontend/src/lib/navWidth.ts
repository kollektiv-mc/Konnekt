/**
 * The left navbar's width, and the rules a stored one has to survive.
 *
 * Kept here rather than in `useNavWidth` because two of the three callers are
 * not the drag: the store clamps what comes off disk during `load`, and a
 * window resize re-clamps without any pointer being involved.
 */

/** Tailwind's `w-48`, which is what the navbar was before it could be resized. */
export const NAV_WIDTH_DEFAULT = 192

/**
 * Below this the server names and preset names truncate to nothing useful, and
 * the crate rows lose their labels entirely.
 */
export const NAV_WIDTH_MIN = 176

/**
 * The navbar may never take more than this share of the window. The canvas is
 * the app; a navbar that can eat half of it is a navbar that will.
 */
export const NAV_WIDTH_MAX_FRACTION = 0.3

/** The widest the navbar may be in a window this wide. */
export function navWidthMax(windowWidth: number): number {
  return Math.round(windowWidth * NAV_WIDTH_MAX_FRACTION)
}

/**
 * `width` brought inside the floor and the 30% ceiling for a window this wide.
 *
 * The ceiling wins a conflict with the floor. It cannot happen in the app —
 * `main.go` sets a 1024px minimum window, where 30% is 307px — but a caller
 * reading `window.innerWidth` mid-teardown, or a test, can hand this anything,
 * and "never wider than 30%" is the invariant with a reason behind it.
 *
 * A width of 0 is the settings file that predates this field: it means "never
 * set", not "collapsed", so it resolves to the default like any other
 * unusable value.
 */
export function clampNavWidth(width: number, windowWidth: number): number {
  const wanted = Number.isFinite(width) && width > 0 ? width : NAV_WIDTH_DEFAULT
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) {
    return Math.round(Math.max(NAV_WIDTH_MIN, wanted))
  }
  return Math.round(Math.min(navWidthMax(windowWidth), Math.max(NAV_WIDTH_MIN, wanted)))
}
