import { parseMotdLine } from './motd'

/** A line of MOTD source as a client draws it. Placeholder in italics when empty. */
export function MotdPreviewLine({ raw, placeholder }: { raw: string; placeholder?: string }) {
  const segments = parseMotdLine(raw)
  if (!segments.length) {
    return <span className="text-text-faint italic">{placeholder ?? ' '}</span>
  }
  return (
    <>
      {segments.map((seg, i) => {
        const decoration = [seg.underline && 'underline', seg.strike && 'line-through']
          .filter(Boolean)
          .join(' ')
        return (
          <span
            key={i}
            // eslint-disable-next-line no-restricted-syntax -- per-segment styling parsed from Minecraft MOTD formatting codes, continuously variable
            style={{
              color: seg.color ?? 'var(--text-primary)',
              fontWeight: seg.bold ? 'bold' : undefined,
              fontStyle: seg.italic ? 'italic' : undefined,
              textDecoration: decoration || undefined,
              opacity: seg.obfuscated ? 0.6 : undefined,
              letterSpacing: seg.obfuscated ? '0.05em' : undefined,
            }}
          >
            {seg.obfuscated ? seg.text.replace(/\S/g, '?') : seg.text}
          </span>
        )
      })}
    </>
  )
}
