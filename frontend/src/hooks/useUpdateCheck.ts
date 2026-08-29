import { useEffect, useRef } from 'react'
import { CheckForUpdates, GetAppVersion } from '../../wailsjs/go/main/App'
import { emitNotification } from '../lib/notify'

// A build from the snapshot channel, stamped `<base>-snapshot.<date>.<sha7>`
// by .github/workflows/snapshot.yml. Mirrors backend/services/update.go's
// IsSnapshotVersion.
export function isSnapshotVersion(version: string): boolean {
  return version.includes('-snapshot.')
}

// A local `wails dev` build (no ldflags override baking in a real version) has
// no installable artifact to update to — skip the check entirely rather than
// notify about an "update" the user can't act on. A snapshot is not one of
// these: it is a real checksummed binary that can replace itself. The
// isSnapshotVersion exclusion is belt-and-braces, since the current snapshot
// stamp carries no "-dev" at all, and keeps this honest if that marker ever
// comes back.
export function isDevBuild(version: string): boolean {
  return version.includes('-dev') && !isSnapshotVersion(version)
}

// One-shot startup check, gated by the "check for updates on startup"
// setting. Fires an info notification through the existing notifications
// pipeline (lib/notify.ts's emitNotification) if a newer GitHub release
// exists. Not a poll — runs once per mount, same shape as App.tsx's other
// one-shot startup effects (e.g. auto-start-active-server).
export function useUpdateCheck(enabled: boolean): void {
  const checked = useRef(false)

  useEffect(() => {
    if (!enabled || checked.current) return
    checked.current = true

    void (async () => {
      try {
        const version = await GetAppVersion()
        if (isDevBuild(version)) return
        const info = await CheckForUpdates()
        if (info.updateAvailable) {
          // Name the channel: a snapshot is untested nightly code, and the
          // notification is the only place that is said before the user opens
          // Settings.
          const label =
            info.channel === 'snapshot' ? 'Snapshot update available' : 'Update available'
          emitNotification('info', `${label}: ${info.latestVersion}`)
        }
      } catch {
        /* non-Wails context, offline, or no releases yet — silent background check */
      }
    })()
  }, [enabled])
}
