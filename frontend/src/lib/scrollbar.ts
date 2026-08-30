/**
 * How many pixels a scrollbar takes out of a scroll container's content box.
 *
 * Zero on a platform with overlay scrollbars (macOS set to "show when
 * scrolling", GTK's overlay bars, and Chromium's headless mode), the styled
 * width from `style.css` on one with classic bars. The number cannot be written
 * as a constant because it is the difference between those two worlds, and
 * `.scroll-overlay` in `style.css` reclaims exactly this much back for its
 * children — reclaiming 4px where the platform reserved 0 pushes them out
 * through the container's padding instead.
 */
export function measureScrollbarWidth(): number {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;top:-9999px;left:-9999px;width:50px;height:50px;overflow-y:scroll'
  document.body.appendChild(probe)
  const width = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return Number.isFinite(width) && width > 0 ? width : 0
}

/**
 * Publishes that measurement as `--scrollbar-gutter` for `style.css` to read.
 *
 * Called once before React mounts. The value cannot change while the app runs —
 * it is a property of the platform's widget theme, not of the window — so there
 * is nothing to keep in sync afterwards. `style.css` declares the property as
 * `0px`, which is the safe way to be wrong: no reclaim costs a scroll container
 * a few pixels of width, while a reclaim that is too large puts its contents
 * outside it.
 */
export function applyScrollbarWidth(): void {
  document.documentElement.style.setProperty('--scrollbar-gutter', `${measureScrollbarWidth()}px`)
}
