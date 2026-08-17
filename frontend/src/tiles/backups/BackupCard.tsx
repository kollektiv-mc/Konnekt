import type { Backup } from './useBackups'
import { fmtBytes, fmtDate, extractID } from './format'

function TagPillReadOnly({ tag }: { tag: string }) {
  return (
    <span className="text-accent border-hairline inline-flex items-center rounded border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-px font-mono text-xs">
      #{tag}
    </span>
  )
}

interface BackupCardProps {
  backup: Backup
  focused: boolean
  inProgress: boolean
  serverRunning: boolean
  onRequestRestore: () => void
  onRequestDelete: () => void
}

export function BackupCard({
  backup,
  focused,
  inProgress,
  serverRunning,
  onRequestRestore,
  onRequestDelete,
}: BackupCardProps) {
  const displayLabel = backup.displayName || extractID(backup.filename)

  return (
    <div
      className={`flex flex-col gap-2 rounded-[10px] px-5 py-3 select-none ${
        focused
          ? 'border-hairline min-h-[140px] w-[360px] border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_6%,var(--bg-surface))]'
          : 'border-border-subtle bg-surface border-hairline min-h-[96px] w-[260px]'
      }`}
      // eslint-disable-next-line no-restricted-syntax -- mixed per-property durations/easings (width/min-height at 260ms bezier, padding/border-color/background at 200ms ease) can't be expressed as one Tailwind transition utility
      style={{
        transition:
          'width 260ms cubic-bezier(0.34,1.15,0.64,1), min-height 260ms cubic-bezier(0.34,1.15,0.64,1), padding 200ms ease, border-color 200ms ease, background 200ms ease',
      }}
    >
      <div className="flex flex-col gap-1.5">
        <div
          className={`text-text-primary truncate font-mono transition-[font-size] duration-200 ease-[ease] ${focused ? 'text-[0.9rem]' : 'text-xs'}`}
        >
          {displayLabel}
        </div>
        {backup.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {backup.tags.map((tag) => (
              <TagPillReadOnly key={tag} tag={tag} />
            ))}
          </div>
        )}
      </div>

      {inProgress ? (
        <div className="text-accent flex animate-pulse flex-col gap-0.5 font-mono text-xs">
          <div>backing up…</div>
        </div>
      ) : (
        <div className="text-text-faint flex flex-col gap-0.5 font-mono text-xs">
          <div>{fmtDate(backup.createdAt)}</div>
          <div>{fmtBytes(backup.sizeBytes)}</div>
        </div>
      )}

      {focused && !inProgress && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRequestRestore()
            }}
            disabled={serverRunning}
            className="text-accent border-hairline flex-1 cursor-pointer rounded-md border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] py-1.5 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-30"
            title={serverRunning ? 'Stop the server before restoring' : 'Restore this backup'}
            onMouseEnter={(e) => {
              if (!serverRunning) (e.currentTarget as HTMLButtonElement).style.opacity = '0.75'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
            }}
          >
            restore
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRequestDelete()
            }}
            className="text-danger border-hairline flex-1 cursor-pointer rounded-md border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] py-1.5 font-mono text-xs opacity-75"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.75'
            }}
          >
            delete
          </button>
        </div>
      )}
    </div>
  )
}
