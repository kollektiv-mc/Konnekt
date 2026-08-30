import { useCallback, useState } from 'react'
import {
  ForceStopServer,
  RestartServer,
  StartServer,
  StopServer,
} from '../../../wailsjs/go/main/App'
import { errMsg } from '../../lib/ipc'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { ConfirmableAction } from './presets'

/**
 * The start / stop / restart / force-stop half of the Commands tile.
 *
 * Extracted so the compact grid and the maximized library drive power actions
 * through one implementation. These bypass SendCommand entirely: they are
 * lifecycle calls on the App struct, not text written to a server's stdin.
 */
export function useLifecycle(serverId: string) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmableAction | null>(null)
  const confirmBeforeStop = useSettingsStore((s) => s.settings.confirmBeforeStop)

  // A rejected power action used to vanish into `.catch(console.error)`, so a
  // double-clicked button looked identical to an accepted one. The backend
  // serializes power actions and rejects the loser with a message meant to be
  // shown verbatim ("another power action is in progress"); `busy` is only the
  // fast path that spares the round trip for clicks in this panel.
  const exec = useCallback(
    (action: string) => {
      if (busy) return
      const fns: Record<string, () => Promise<void>> = {
        start: () => StartServer(serverId),
        stop: () => StopServer(serverId),
        restart: () => RestartServer(serverId),
      }
      const fn = fns[action]
      if (!fn) return
      setBusy(action)
      setError(null)
      fn()
        .catch((err: unknown) => setError(errMsg(err)))
        .finally(() => setBusy(null))
    },
    [serverId, busy],
  )

  // Force stop is exempt from `busy` on purpose: its reason to exist is a
  // graceful stop still in flight (which holds `busy` for the whole grace
  // window), and the backend call is idempotent. It always confirms, whatever
  // confirmBeforeStop says — it discards unsaved world data.
  const execForceStop = useCallback(() => {
    setError(null)
    ForceStopServer(serverId).catch((err: unknown) => setError(errMsg(err)))
  }, [serverId])

  const request = useCallback(
    (action: string) => {
      if (action === 'force-stop') {
        setConfirmAction('force-stop')
        return
      }
      if (confirmBeforeStop && (action === 'stop' || action === 'restart')) {
        setConfirmAction(action as 'stop' | 'restart')
        return
      }
      exec(action)
    },
    [confirmBeforeStop, exec],
  )

  const runConfirmed = useCallback(() => {
    if (!confirmAction) return
    if (confirmAction === 'force-stop') execForceStop()
    else exec(confirmAction)
    setConfirmAction(null)
  }, [confirmAction, exec, execForceStop])

  return {
    busy,
    error,
    confirmAction,
    setConfirmAction,
    /** Fire a lifecycle action, putting a confirmation in front where required. */
    request,
    runConfirmed,
  }
}
