import { useCommandsStore } from '../../../stores/useCommandsStore'
import type { KommandsStatus } from '../../../stores/useCommandsStore'

interface KommandsPanelProps {
  status: KommandsStatus | null
}

/**
 * The Kommands side of the library: whether the other application is here, and
 * how many of its commands it has linked into this list.
 *
 * Kommands (kollektiv-mc/Kommands) owns the canonical copy and Konnekt only
 * ever reads it. That asymmetry is the whole design: with one writer there is
 * nothing to merge and no way for the two to disagree. It also decides *which*
 * commands cross: a command saved there stays there until it is linked, and a
 * linked one is turned into a row of this list by Go as the shared file
 * changes. So this panel lists nothing and offers no "link this to that": the
 * commands are already in the list to the left, badged with where they came
 * from, and this only says how the link is doing.
 *
 * Not having Kommands is the common state, and it is written as a plain fact
 * rather than as an error.
 */
export function KommandsPanel({ status }: KommandsPanelProps) {
  const refreshKommands = useCommandsStore((s) => s.refreshKommands)

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
        <>
          <p className="text-text-faint text-2xs leading-relaxed">
            Nothing is linked from Kommands yet. In Kommands, press the link on a saved command and
            it appears in this list, following the original whenever it changes there.
          </p>
          {status && status.brokenCount > 0 && (
            <p className="text-warning text-2xs leading-relaxed">
              The file Kommands shares is not there any more. The commands that followed it are
              marked in the list and still run their last text.
            </p>
          )}
        </>
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
            {status.savedCount} linked in Kommands
            {status.rejected > 0 && ` · ${status.rejected} skipped as malformed`}
          </div>
          <p className="text-text-faint text-2xs leading-relaxed">
            A linked command follows its original: an edit in Kommands lands here and is marked
            until you have seen it, and unlinking it there removes it here.
          </p>
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
