import { useCommandsStore } from '../../../stores/useCommandsStore'
import type {
  CommandButton,
  KommandsSavedCommand,
  KommandsStatus,
} from '../../../stores/useCommandsStore'

interface KommandsPanelProps {
  status: KommandsStatus | null
  saved: KommandsSavedCommand[]
  items: CommandButton[]
  onAdd: (saved: KommandsSavedCommand) => void
}

const NOTE = 'text-text-faint text-2xs leading-relaxed'

/**
 * The Kommands side of the library: what the other application has linked,
 * and an Add on each one that is not a button here yet.
 *
 * Kommands (kollektiv-mc/Kommands) owns the canonical copy and Konnekt only
 * ever reads it. That asymmetry is the whole design: with one writer there is
 * nothing to merge and no way for the two to disagree. Linking there makes a
 * command visible here and nothing more; adding it is the decision taken on
 * this side, and the button it makes then follows its original.
 *
 * Not having Kommands is the common state, and it is written as a plain fact
 * rather than as an error. The file's path is on the heading's tooltip rather
 * than in the panel: it is for the one time someone goes looking for it.
 */
export function KommandsPanel({ status, saved, items, onAdd }: KommandsPanelProps) {
  const refreshKommands = useCommandsStore((s) => s.refreshKommands)
  const added = new Set(items.map((it) => it.link?.id).filter(Boolean))

  return (
    <div className="border-border-subtle flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <span className="text-text-secondary text-xs font-semibold" title={status?.path}>
          Kommands
        </span>
        {status?.installed && !status.unsupported && !status.error && (
          <span className="text-text-faint text-2xs">{status.savedCount} linked</span>
        )}
        <button
          onClick={() => void refreshKommands().catch(console.error)}
          className="text-text-muted hover:text-text-primary text-2xs ml-auto transition-colors"
        >
          Refresh
        </button>
      </div>

      {!status?.installed ? (
        <>
          <p className={NOTE}>
            Nothing linked yet. Link a saved command in Kommands to see it here.
          </p>
          {status && status.brokenCount > 0 && (
            <p className="text-warning text-2xs leading-relaxed">
              The file Kommands shares is gone. The commands that followed it are marked in the list
              and still run their last text.
            </p>
          )}
        </>
      ) : status.unsupported ? (
        <p className="text-warning text-2xs leading-relaxed">
          Kommands wrote a newer format (version {status.version || 'unknown'}) than this build
          understands. Update Konnekt to use linked commands.
        </p>
      ) : status.error ? (
        <p className="text-danger text-2xs leading-relaxed">{status.error}</p>
      ) : saved.length === 0 ? (
        <p className={NOTE}>Nothing linked yet. Link a saved command in Kommands to see it here.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {saved.map((sc) => {
            const has = added.has(sc.id)
            return (
              <div
                key={sc.id}
                className="border-border-subtle flex items-center gap-2 rounded border px-2 py-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-text-secondary truncate text-xs">{sc.label}</div>
                  <div className="text-text-faint text-2xs truncate font-mono" title={sc.command}>
                    {sc.command}
                  </div>
                </div>
                <button
                  onClick={() => onAdd(sc)}
                  disabled={has}
                  aria-label={has ? `${sc.label} is added` : `Add ${sc.label}`}
                  title={has ? 'Already a command here' : 'Add as a command that follows this'}
                  className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary disabled:hover:border-border-subtle h-6 w-14 shrink-0 rounded border text-xs transition-all disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {has ? 'Added' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {status?.installed && status.rejected > 0 && (
        <p className={NOTE}>{status.rejected} skipped as malformed</p>
      )}
    </div>
  )
}
