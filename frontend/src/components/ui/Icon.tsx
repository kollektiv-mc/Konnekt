import type { LucideIcon } from '../../lib/icons'

/**
 * Rendered stroke weight, in real screen pixels.
 *
 * A px value rather than one of lucide's own `strokeWidth` numbers, which are
 * in viewBox units and therefore scale with the box: lucide's native 2 on its
 * 24-unit grid draws 1.33px at 16px and 1.17px at 14px, so a single number
 * there is a different weight at every size in this UI. `absoluteStrokeWidth`
 * below is what holds it to one screen value, which lands between the two
 * border tokens the design language is built from (--border-hairline 0.5px,
 * --border-thick 1.5px) at every size rather than only at one.
 *
 * Not a design token: `tokens.source.json` is vendored from kollektiv and
 * shared with Kommands, so a Konnekt-only icon value added there is reverted by
 * the next sync. Per-call override lives on the `strokePx` prop below.
 */
export const ICON_STROKE_PX = 1.25

/**
 * Icons size through Tailwind's spacing scale, which `tokens.css` deliberately
 * does not redeclare (its own comment says so: Tailwind's --spacing already
 * matches the shared scale). So `size-4` is 16px from the same source the
 * padding utilities read, not an arbitrary literal.
 *
 * Both halves of each entry reach the SVG and they cannot drift, because they
 * are one entry: the class is what paints (a CSS rule beats the width/height
 * attributes), and the number is what lucide divides by to turn `strokePx`
 * into viewBox units under `absoluteStrokeWidth`.
 */
const SIZE = {
  xs: { cls: 'size-3', px: 12 }, // inline with 1xs/2xs text
  sm: { cls: 'size-3.5', px: 14 }, // tile headers, sidebar chrome
  md: { cls: 'size-4', px: 16 }, // crate rows, default
  lg: { cls: 'size-5', px: 20 }, // emphasis
} as const

export type IconSize = keyof typeof SIZE

interface IconProps {
  /** A component from `lib/icons.ts`. Never import lucide-react directly. */
  icon: LucideIcon
  size?: IconSize
  /** Rendered stroke weight in screen px. Overrides ICON_STROKE_PX. */
  strokePx?: number
  /**
   * Extra classes — colour, opacity, transforms. Colour is what this is mostly
   * for: lucide strokes `currentColor`, so a `text-*` token on the icon or any
   * ancestor themes it, including through applySkin()'s runtime retheme. Do not
   * pass a `size-*` here; two same-specificity rules resolve by stylesheet
   * order, not by which came last in the string, and it would leave the painted
   * box disagreeing with the size the stroke was computed against. Use `size`.
   */
  className?: string
  /**
   * Set only when the icon is the sole carrier of its meaning — a status glyph
   * with no adjacent text. An icon inside a labelled button stays decorative:
   * label the button, not this.
   */
  label?: string
}

/**
 * The single render path for every icon in the app. Call sites pass the glyph
 * as a component so nothing downstream is coupled to lucide, and so the icon
 * set can be swapped from `lib/icons.ts` alone.
 */
export function Icon({
  icon: Glyph,
  size = 'md',
  strokePx = ICON_STROKE_PX,
  className,
  label,
}: IconProps) {
  return (
    <Glyph
      size={SIZE[size].px}
      absoluteStrokeWidth
      strokeWidth={strokePx}
      className={`${SIZE[size].cls} shrink-0${className ? ` ${className}` : ''}`}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
    />
  )
}
