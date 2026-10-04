import { useMemo } from 'react'
import { encodeQr, QUIET_ZONE } from '../../lib/qr'

/**
 * One path for the whole symbol: each horizontal run of dark modules is a
 * single rectangle, so a version 4 code is a few hundred short commands rather
 * than a thousand `<rect>` nodes. Offset by the quiet zone, in module units.
 */
function pathOf(matrix: readonly (readonly boolean[])[]): string {
  const parts: string[] = []
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < row.length && row[x]) x++
      parts.push(`M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`)
    }
  })
  return parts.join('')
}

interface Props {
  /** What the code says. Drawn here, in the renderer: it is never sent anywhere. */
  text: string
  className?: string
}

/**
 * A scannable QR code for `text`, or nothing if it is too long to encode.
 *
 * It is dark modules on a light backing whatever the theme. A reader looks for
 * dark on light, and some refuse the inverse, so the colours are the palette's
 * `white` and `black`, not the themed tokens: `text-primary` and `canvas` both
 * swap sides with the theme (and a skin can move them again), so no pair of them
 * stays dark-on-light. The quiet zone is part of the light backing, which is
 * what keeps the code readable against a dark pane.
 */
export function QrCode({ text, className = 'size-44' }: Props) {
  const drawing = useMemo(() => {
    try {
      const matrix = encodeQr(text)
      return { path: pathOf(matrix), size: matrix.length + QUIET_ZONE * 2 }
    } catch {
      return null
    }
  }, [text])
  if (!drawing) return null

  return (
    <svg
      role="img"
      aria-label={`QR code for ${text}`}
      viewBox={`0 0 ${drawing.size} ${drawing.size}`}
      shapeRendering="crispEdges"
      className={`shrink-0 rounded ${className}`}
    >
      <rect width={drawing.size} height={drawing.size} className="fill-white" />
      <path d={drawing.path} className="fill-black" />
    </svg>
  )
}
