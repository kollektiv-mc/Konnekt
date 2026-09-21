import { useState } from 'react'
import { StopServer } from '../../../wailsjs/go/main/App'
import { useServerStore } from '../../stores/useServerStore'
import { BackupRunningDialog } from './BackupRunningDialog'
import { useBackups } from './useBackups'
import { fmtBytes, relativeMs } from '../../lib/format'
import { Figure } from '../../components/ui/Figure'
import type { TileLayout } from '../../types'

interface Props {
  serverId: string
  layout?: TileLayout
}

/**
 * The compact face of the Backups tile: when the server was last fully backed
 * up, what that archive weighs and how many are kept, and the one action.
 *
 * The age of the last backup is the figure, its size and the archive count
 * the detail under it, and the button holds the bottom edge: the default
 * layout's shape. World backups are counted in the maximized face; here the
 * question is only whether the whole server is safe. Compact keeps the figure
 * and the button; large sets the figure small and lists the archives kept.
 */
export function BackupsSummary({ serverId, layout = 'default' }: Props) {
  const { status } = useServerStore()
  const { backups, loading, listError, creating, create } = useBackups(serverId)
  const [showRunningDialog, setShowRunningDialog] = useState(false)
  const [stopping, setStopping] = useState(false)

  function handleCreateClick() {
    if (status.running) {
      setShowRunningDialog(true)
    } else {
      create()
    }
  }

  async function stopAndBackUp() {
    setShowRunningDialog(false)
    setStopping(true)
    try {
      await StopServer(serverId)
    } catch {
      /* server may already be stopped */
    }
    setStopping(false)
    await create()
  }

  if (loading) {
    return (
      <div className="text-text-faint flex h-full items-center justify-center font-mono text-xs">
        Loading…
      </div>
    )
  }

  if (listError) {
    return (
      <div className="text-danger flex h-full items-center justify-center px-3 text-center font-mono text-xs">
        {listError}
      </div>
    )
  }

  const serverBackups = backups.filter((b) => b.kind === 'server')
  const latest = serverBackups[0]

  return (
    <div className="relative flex h-full flex-col gap-2 px-3 py-2">
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        {latest ? (
          <>
            <Figure
              size={layout === 'large' ? 'sm' : 'lg'}
              label="Last full backup"
              value={relativeMs(latest.createdAt)}
            />
            {layout !== 'compact' && (
              <span className="text-text-muted text-xs">
                {fmtBytes(latest.sizeBytes)} · {serverBackups.length}{' '}
                {serverBackups.length === 1 ? 'archive' : 'archives'} kept
              </span>
            )}
          </>
        ) : (
          <Figure
            size={layout === 'large' ? 'sm' : 'lg'}
            label="Last full backup"
            value="never"
            valueClass="text-text-faint"
          />
        )}
        {layout === 'large' && serverBackups.length > 0 && (
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
            {serverBackups.map((b) => (
              <div
                key={b.filename}
                className="border-border-subtle border-b-hairline flex items-center gap-2 py-1 last:border-0"
              >
                <span
                  className="text-text-secondary min-w-0 flex-1 truncate font-mono text-xs"
                  title={b.filename}
                >
                  {b.displayName || b.filename}
                </span>
                <span className="text-text-faint text-2xs shrink-0 font-mono">
                  {relativeMs(b.createdAt)}
                </span>
                <span className="text-text-faint shrink-0 font-mono text-xs">
                  {fmtBytes(b.sizeBytes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={handleCreateClick}
        disabled={creating || stopping}
        className="border-accent text-accent mt-auto w-full shrink-0 rounded border bg-transparent py-1 font-mono text-xs transition-colors disabled:opacity-40"
        onMouseEnter={(e) => {
          if (!creating && !stopping) {
            ;(e.currentTarget as HTMLButtonElement).style.background =
              'color-mix(in srgb, var(--accent) 10%, transparent)'
          }
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        }}
      >
        {stopping ? 'Stopping server…' : creating ? 'Backing up…' : 'Back up now'}
      </button>
      {showRunningDialog && (
        <BackupRunningDialog
          onBackUpNow={() => {
            setShowRunningDialog(false)
            create()
          }}
          onStopAndBackUp={stopAndBackUp}
          onCancel={() => setShowRunningDialog(false)}
        />
      )}
    </div>
  )
}
