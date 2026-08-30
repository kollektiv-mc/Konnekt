/**
 * How many pixels a scrollbar takes out of a scroll container's content box.
 *
 * Specifically, what a `.scroll-stable` container reserves — which is not the
 * same question as what the platform's default scrollbar takes. Styling
 * ::-webkit-scrollbar makes a bar classic even where the platform's own are
 * overlay ones, and `scrollbar-gutter: stable` then reserves for it. So this
 * measures the class rather than the platform, and it cannot be a constant
 * because the answer still differs between them.
 *
 * `.scroll-stable` subtracts it from its right padding so a reserved gutter
 * does not make one side of a container's contents sit further from the edge
 * than the other. That is the whole job, and it is why this can be wrong
 * without anything breaking: a bad number here mis-pads by a few pixels. An
 * earlier version fed a negative margin instead, to pull content back under
 * the bar and fake an overlay, and there a bad number put the content under
 * the scrollbar or short of it — worse than the gutter it was hiding.
 */
export function measureScrollbarWidth(): number {
  const probe = document.createElement('div')
  // Wearing the class it is measuring for, not an approximation of it. A probe
  // that only set `overflow-y: scroll` measured zero on a platform whose
  // default bars are overlay ones, while the real containers — which also
  // carry `scrollbar-gutter: stable`, and whose bars ::-webkit-scrollbar has
  // made classic — reserved four pixels. Everything downstream was then off by
  // exactly the gutter it was meant to account for. Borrowing the class makes
  // that class of mistake impossible: whatever `.scroll-stable` reserves, this
  // reserves.
  //
  // Its own padding does not interfere. clientWidth includes padding, so this
  // difference is borders and the scrollbar, and the probe has no border.
  probe.className = 'scroll-stable'
  probe.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:50px;height:50px'
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
 * is nothing to keep in sync afterwards. `style.css` falls back to `0px`, which
 * leaves a container padded as though nothing were reserved: a slightly wide
 * right margin, which is what this should cost when it does not run at all.
 */
export function applyScrollbarWidth(): void {
  document.documentElement.style.setProperty('--scrollbar-gutter', `${measureScrollbarWidth()}px`)
}
