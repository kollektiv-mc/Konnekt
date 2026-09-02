// The overlay layering scale: one value per layer, in one place, so "above the
// thing that opened me" is a name rather than a number guessed against whatever
// happened to be on screen when the component was written.
//
// Production reads it as Tailwind classes, `z-overlay` through `z-splash`. They
// exist because style.css declares the same numbers in a `@theme` block as
// `--z-index-<name>`, the namespace Tailwind v4's `z-*` utility resolves. This
// module is the documented source; layers.test.ts pins the CSS to it, and the
// tests resolve a class back to its value through LAYER rather than parsing
// digits off a className. The scale is consumed as classes rather than as a
// number because the inline-style lint rule makes `style={{ zIndex }}` an error
// everywhere.
//
// | layer   | for                                                             |
// |---------|-----------------------------------------------------------------|
// | overlay | the maximized-tile backdrop and panel (Dashboard)               |
// | modal   | a backdropped surface that replaces what is under it:           |
// |         | SettingsModal, ServerManager, EulaModal, ModPreviewDialog,      |
// |         | PlayerDetailPopup                                               |
// | dialog  | a confirm or progress box that opens on top of a modal:         |
// |         | DisconnectConfirm, ServerInstallModal, LoaderUpdateDialog,      |
// |         | DependencyDialog, CloseConfirmDialog, the command confirms      |
// | popover | an anchored transient with no modal backdrop: Popover,          |
// |         | ServerTooltip, QuickAddMenu, the presets dropdown, the config   |
// |         | select panel, the crate drag preview                            |
// | splash  | the startup splash, and nothing else                            |
//
// Rule of thumb: if it opens another surface it is a modal, and the surface it
// opens is a dialog. A popover sits above both because it is transient and
// pointer-attached, never a backdrop the user has to dismiss to get on.
//
// Two things the scale does not do, and why.
//
// A value only orders things that share a stacking context. The maximized-tile
// overlay is one (it is positioned and carries a z-index), so a surface rendered
// inside a tile is clamped inside it whatever number it carries; the values that
// used to sit at 400, 500 and 9999 inside tiles never escaped it either, and the
// grid copy of a tile is transformed by react-grid-layout, which clamps a
// `fixed` descendant the same way. Rendering from App, after <main>, is still
// what puts a surface above the grid, and the two portals (QuickAddMenu, the
// presets dropdown) escape their tile the same way. What the scale settles is
// the order among surfaces that do share a context, which used to be decided by
// document order, and lost twice.
//
// The scale is for surfaces that compete app-wide. A tile's own sibling order
// (the backups tile's z-[1] to z-[9], the in-tile scrims and side panels at
// z-10 and z-20, the computed carousel index and the z-[150] arrows over it)
// stays on bare numbers: those compare only with each other, inside one tile, and a
// named layer would claim something false about what they are above.
//
// `z-overlay` shares a word with the colour token `bg-overlay`. Different
// Tailwind namespaces (--z-index-* against --color-*), so no collision, only a
// homonym.
//
// Konnekt-only, so not a design token: tokens.source.json is vendored from
// kollektiv and a value that exists in one product is reverted on the next
// sync. The same reason gridSizing.ts holds the grid's constants beside this.

export const LAYER = {
  overlay: 100,
  modal: 200,
  dialog: 300,
  popover: 400,
  splash: 500,
} as const

export type Layer = keyof typeof LAYER

/** The layer a class list declares, or null when it declares none. */
export function declaredLayer(className: string): Layer | null {
  for (const cls of className.split(/\s+/)) {
    if (!cls.startsWith('z-')) continue
    const name = cls.slice(2)
    if (Object.hasOwn(LAYER, name)) return name as Layer
  }
  return null
}
