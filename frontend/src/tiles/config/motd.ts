/**
 * Minecraft's formatting codes, read for display: the sixteen colours, the
 * five styles, and a line of MOTD source split into styled runs, which
 * `MotdLine.tsx` draws.
 *
 * Its own module because two faces render a MOTD: the maximized editor's
 * builder (`form/widgets.tsx`, behind the editor's lazy chunk) and the canvas
 * face (`ConfigSummary.tsx`, in the entry chunk). Importing it from the
 * widgets would pull the editor's chunk into the entry.
 */

export const MC_COLORS: { code: string; hex: string; label: string }[] = [
  { code: '0', hex: '#000000', label: 'Black' },
  { code: '1', hex: '#0000AA', label: 'Dark Blue' },
  { code: '2', hex: '#00AA00', label: 'Dark Green' },
  { code: '3', hex: '#00AAAA', label: 'Dark Aqua' },
  { code: '4', hex: '#AA0000', label: 'Dark Red' },
  { code: '5', hex: '#AA00AA', label: 'Dark Purple' },
  { code: '6', hex: '#FFAA00', label: 'Gold' },
  { code: '7', hex: '#AAAAAA', label: 'Gray' },
  { code: '8', hex: '#555555', label: 'Dark Gray' },
  { code: '9', hex: '#5555FF', label: 'Blue' },
  { code: 'a', hex: '#55FF55', label: 'Green' },
  { code: 'b', hex: '#55FFFF', label: 'Aqua' },
  { code: 'c', hex: '#FF5555', label: 'Red' },
  { code: 'd', hex: '#FF55FF', label: 'Light Purple' },
  { code: 'e', hex: '#FFFF55', label: 'Yellow' },
  { code: 'f', hex: '#FFFFFF', label: 'White' },
]

const COLOR_MAP: Record<string, string> = Object.fromEntries(
  MC_COLORS.map(({ code, hex }) => [code, hex]),
)

/**
 * server.properties is written by Java's Properties, which stores anything
 * outside printable ASCII as a `\uXXXX` escape, so a section sign arrives as
 * `\u00A7` and a middle dot as `\u00B7`. Every escape is decoded, not only the
 * section sign, or the rest reach the screen as source.
 */
export function decodeEscapes(raw: string): string {
  return raw.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
}

export interface MotdSegment {
  text: string
  color: string | null
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  obfuscated: boolean
}

export function parseMotdLine(raw: string): MotdSegment[] {
  const input = decodeEscapes(raw)
  const segments: MotdSegment[] = []
  let cur: MotdSegment = {
    text: '',
    color: null,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    obfuscated: false,
  }

  let i = 0
  while (i < input.length) {
    if (input[i] === '§' && i + 1 < input.length) {
      if (cur.text) {
        segments.push({ ...cur })
        cur = { ...cur, text: '' }
      }
      const c = input[i + 1].toLowerCase()
      if (COLOR_MAP[c] !== undefined) {
        cur = {
          text: '',
          color: COLOR_MAP[c],
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          obfuscated: false,
        }
      } else if (c === 'l') cur = { ...cur, bold: true, text: '' }
      else if (c === 'o') cur = { ...cur, italic: true, text: '' }
      else if (c === 'n') cur = { ...cur, underline: true, text: '' }
      else if (c === 'm') cur = { ...cur, strike: true, text: '' }
      else if (c === 'k') cur = { ...cur, obfuscated: true, text: '' }
      else if (c === 'r')
        cur = {
          text: '',
          color: null,
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          obfuscated: false,
        }
      i += 2
    } else {
      cur.text += input[i]
      i++
    }
  }
  if (cur.text) segments.push(cur)
  return segments
}
