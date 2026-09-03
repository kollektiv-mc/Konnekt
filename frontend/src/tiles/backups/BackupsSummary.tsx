import { useState } from 'react'
import { StopServer } from '../../../wailsjs/go/main/App'
import { useServerStore } from '../../stores/useServerStore'
import { BackupRunningDialog } from './BackupRunningDialog'
import { useBackups } from './useBackups'
import { fmtBytes, relativeMs } from '../../lib/format'

interface Props {
  serverId: string
}

export function BackupsSummary({ serverId }: Props) {
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
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1">
        {latest ? (
          <>
            <div className="text-text-faint font-mono text-xs">Last full backup</div>
            <div className="text-text-secondary font-mono text-sm">
              {relativeMs(latest.createdAt)}
            </div>
            <div className="text-text-faint font-mono text-xs">
              {fmtBytes(latest.sizeBytes)} · {serverBackups.length} total
            </div>
          </>
        ) : (
          <div className="text-text-faint font-mono text-xs">No full-server backups yet</div>
        )}
      </div>
      <button
        onClick={handleCreateClick}
        disabled={creating || stopping}
        className="border-accent text-accent w-full rounded border bg-transparent py-1 font-mono text-xs transition-colors disabled:opacity-40"
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
