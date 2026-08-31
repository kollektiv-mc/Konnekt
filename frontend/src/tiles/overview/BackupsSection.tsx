import { Database } from '../../lib/icons'
import { fmtBytes, relativeMs } from '../../lib/format'
import { useBackups } from '../backups/useBackups'
import { Section, SectionEmpty } from './Section'

// The most recent full-server backup plus the three behind it — enough to see
// at a glance whether backups are actually still running on schedule, which one
// number alone does not tell you.
const SHOWN = 4

export function BackupsSection({ serverId }: { serverId: string }) {
  const { backups, loading, listError } = useBackups(serverId)

  // Go's ListBackups already sorts newest-first (backend/services/backup.go),
  // so this is a slice rather than a sort.
  const recent = backups.filter((b) => b.kind === 'server').slice(0, SHOWN)

  return (
    <Section tileId="backups" icon={Database} label="Backups">
      {recent.length === 0 ? (
        <SectionEmpty>
          {loading ? 'loading…' : listError ? 'backups unavailable' : 'no backups yet'}
        </SectionEmpty>
      ) : (
        <div className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 py-2">
          {recent.map((b, i) => (
            <div key={b.filename} className="flex items-baseline gap-2">
              <span
                className={`flex-1 truncate font-mono text-xs ${
                  i === 0 ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {relativeMs(b.createdAt)}
              </span>
              <span className="text-text-faint shrink-0 font-mono text-xs">
                {fmtBytes(b.sizeBytes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
