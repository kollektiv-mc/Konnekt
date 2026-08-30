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
  onLink: (item: CommandButton, saved: KommandsSavedCommand) => void
}

/**
 * The Kommands side of the library: what the other application has saved, and
 * which buttons here follow it.
 *
 * Kommands (kollektiv-mc/Kommands) owns the canonical copy and Konnekt only
 * ever reads it. That asymmetry is the whole design: with one writer there is
 * nothing to merge and no way for the two to disagree.
 *
 * Kommands cannot write the file yet — it has no persistence at all — so the
 * common state here is "nothing found", and it is written as a plain fact
 * rather than as an error. Dropping a hand-written saved-commands.json into the
 * directory named below exercises this whole surface today.
 */
export function KommandsPanel({ status, saved, items, onLink }: KommandsPanelProps) {
  const refreshKommands = useCommandsStore((s) => s.refreshKommands)
  const linkedIds = new Set(items.map((it) => it.link?.id).filter(Boolean))
  // Only plain commands can follow a link: Go refuses one on a lifecycle or
  // dialog button, so offering it here would be an action that silently no-ops.
  const linkable = items.filter((it) => it.kind === 'cmd' && !it.link)

  return (
    <div className="border-border-subtle flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary text-xs font-semibold">Kommands</span>
        <button
          onClick={() => void refreshKommands().catch(console.error)}
          className="text-text-muted hover:text-text-primary text-2xs transition-colors"
        >
          Check now
        </button>
      </div>

      {!status?.installed ? (
        <p className="text-text-faint text-2xs leading-relaxed">
          Kommands has not saved any commands on this machine yet. When it does, its commands appear
          here and a command in this list can follow one, so an edit there reaches this server
          without retyping it.
        </p>
      ) : status.unsupported ? (
        <p className="text-warning text-2xs leading-relaxed">
          Kommands wrote a file in a newer format (version {status.version || 'unknown'}) than this
          build understands. Update Konnekt to use linked commands.
        </p>
      ) : status.error ? (
        <p className="text-danger text-2xs leading-relaxed">{status.error}</p>
      ) : (
        <>
          <div className="text-text-faint text-2xs">
            {status.savedCount} saved · {status.linkedCount} linked
            {status.rejected > 0 && ` · ${status.rejected} skipped as malformed`}
          </div>
          <div className="flex flex-col gap-1">
            {saved.map((sc) => {
              const already = linkedIds.has(sc.id)
              return (
                <div
                  key={sc.id}
                  className="border-border-subtle flex flex-col gap-1 rounded border px-2 py-1.5"
                >
                  <span className="text-text-secondary truncate text-xs">{sc.label}</span>
                  <span className="text-text-faint text-2xs truncate font-mono" title={sc.command}>
                    {sc.command}
                  </span>
                  {already ? (
                    <span className="text-text-faint text-2xs">Already linked</span>
                  ) : linkable.length === 0 ? (
                    <span className="text-text-faint text-2xs">
                      Add a command above to link it to this
                    </span>
                  ) : (
                    <select
                      value=""
                      onChange={(e) => {
                        const target = linkable.find((it) => it.id === e.target.value)
                        if (target) onLink(target, sc)
                      }}
                      className="border-border-subtle bg-hover text-text-secondary text-2xs rounded border px-1 py-0.5 outline-none"
                    >
                      <option value="">Link a command to this…</option>
                      {linkable.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {status?.path && (
        <p className="text-text-faint text-2xs break-all" title={status.path}>
          {status.path}
        </p>
      )}
    </div>
  )
}
