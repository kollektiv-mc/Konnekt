/**
 * The navbar's control icons, as inline SVG.
 *
 * These were Unicode glyphs — ⚙ ⤢ ✎ × — and could not be made to line up. A
 * text glyph is positioned by its font's metrics, and these four come from
 * different blocks with different ink heights, different advance widths and
 * different vertical centring inside the em box. Some of them resolve to an
 * emoji font on one platform and a symbol font on another. Centring the *line
 * box* in a square button, which is all CSS can do, leaves the ink itself
 * sitting wherever the font put it, so a column of them reads as skewed no
 * matter what padding it is given.
 *
 * Drawn on the same 16x16 grid instead, each one's ink is centred by
 * construction and identical on every platform. They take their colour from
 * `currentColor`, so a button's hover rule still drives them.
 *
 * `aria-hidden` on all of them: every one is inside a labelled control (see
 * `IconButton`), so announcing the graphic as well would say it twice.
 */

const BOX = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  'aria-hidden': true,
  focusable: false,
} as const

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Settings. An eight-tooth gear, generated on the 16x16 grid. */
export function GearIcon() {
  return (
    <svg {...BOX}>
      <path
        {...STROKE}
        d="M8.65 1.43 L9.92 1.68 L10.31 3.68 L11.11 4.21 L13.10 3.81 L13.82 4.89 L12.69 6.58 L12.88 7.52 L14.57 8.65 L14.32 9.92 L12.32 10.31 L11.79 11.11 L12.19 13.10 L11.11 13.82 L9.42 12.69 L8.48 12.88 L7.35 14.57 L6.08 14.32 L5.69 12.32 L4.89 11.79 L2.90 12.19 L2.18 11.11 L3.31 9.42 L3.12 8.48 L1.43 7.35 L1.68 6.08 L3.68 5.69 L4.21 4.89 L3.81 2.90 L4.89 2.18 L6.58 3.31 L7.52 3.12 Z"
      />
      <circle {...STROKE} cx="8" cy="8" r="2.3" />
    </svg>
  )
}

/** Open the full view of something the navbar only summarises. */
export function ExpandIcon() {
  return (
    <svg {...BOX}>
      <path {...STROKE} d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
    </svg>
  )
}

/** Edit. */
export function PencilIcon() {
  return (
    <svg {...BOX}>
      <path {...STROKE} d="M10.9 2.6 13.4 5.1 5.6 12.9 2.6 13.4 3.1 10.4Z" />
      <path {...STROKE} d="M9.5 4 12 6.5" />
    </svg>
  )
}

/** Close, dismiss, remove. */
export function CloseIcon() {
  return (
    <svg {...BOX}>
      <path {...STROKE} d="M4 4 12 12M12 4 4 12" />
    </svg>
  )
}
