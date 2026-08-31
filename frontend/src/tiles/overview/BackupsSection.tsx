import type { ReactNode } from 'react'
import { Database } from '../../lib/icons'
import { fmtBytes, relativeMs } from '../../lib/format'
import { fmtDate } from '../backups/format'
import { useBackups } from '../backups/useBackups'
import type { Backup } from '../backups/useBackups'
import { Section, SectionEmpty } from './Section'

// The latest gets its own two-line header; these are the ones behind it, enough
// to see whether backups are still running on schedule, which one number does
// not tell you.
const OLDER_SHOWN = 3

/**
 * What a backup covers.
 *
 * `models.Backup.Kind` is "server" or "world", and a world backup carries the
 * world it came from. Both already exist — the Worlds tile's per-world Backup
 * action writes `kind: "world"` (backend/services/backup.go) — so this is a
 * real distinction from the first render, not a placeholder for one.
 */
function KindTag({ backup }: { backup: Backup }) {
  const label = backup.kind === 'world' ? (backup.world ?? 'world') : 'server'
  return (
    <span
      className="border-border-subtle text-text-faint border-hairline shrink-0 truncate rounded px-1 font-mono text-[10px]"
      title={backup.kind === 'world' ? `World backup: ${label}` : 'Full server backup'}
    >
      {label}
    </span>
  )
}

/** Fixed two lines, so one backup and four make the same shape. */
function Latest({ backup }: { backup: Backup }) {
  return (
    <div className="border-border-subtle border-b-hairline flex shrink-0 flex-col gap-0.5 pb-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-text-primary font-mono text-sm">{fmtBytes(backup.sizeBytes)}</span>
        <KindTag backup={backup} />
      </div>
      <div className="text-text-faint truncate font-mono text-xs" title={fmtDate(backup.createdAt)}>
        {relativeMs(backup.createdAt)} · {fmtDate(backup.createdAt)}
      </div>
    </div>
  )
}

function Row({ backup }: { backup: Backup }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-muted flex-1 truncate font-mono text-xs">
        {relativeMs(backup.createdAt)}
      </span>
      <span className="text-text-faint shrink-0 font-mono text-xs">
        {fmtBytes(backup.sizeBytes)}
      </span>
      <KindTag backup={backup} />
    </div>
  )
}

export function BackupsSection({ serverId }: { serverId: string }) {
  const { backups, loading, listError } = useBackups(serverId)

  // Every kind, not just full-server ones. Filtering to `kind === 'server'` hid
  // per-world backups under a heading that says "Backups", which is the wrong
  // answer to "when was this server last backed up".
  //
  // Go's ListBackups already sorts newest-first
  // (backend/services/backup.go), so this is a slice rather than a sort.
  const [latest, ...older] = backups

  let body: ReactNode
  if (!latest) {
    body = (
      <SectionEmpty>
        {loading ? 'loading…' : listError ? 'backups unavailable' : 'no backups yet'}
      </SectionEmpty>
    )
  } else {
    body = (
      <div className="flex h-full flex-col gap-1.5 overflow-y-auto px-3 py-2">
        <Latest backup={latest} />
        <div className="flex flex-col gap-0.5">
          {older.slice(0, OLDER_SHOWN).map((b) => (
            <Row key={b.filename} backup={b} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <Section tileId="backups" icon={Database} label="Backups" meta={backups.length || undefined}>
      {body}
    </Section>
  )
}
