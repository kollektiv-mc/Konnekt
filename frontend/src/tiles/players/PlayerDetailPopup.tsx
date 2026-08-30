import { useEffect, useRef, useState } from 'react'
import { GetPlayerDetail, KickPlayer, BanPlayer, PardonPlayer } from '../../../wailsjs/go/main/App'
import type { Player } from '../../types'
import { IconButton } from '../../components/ui/IconButton'
import { X } from '../../lib/icons'
import { Icon } from '../../components/ui/Icon'

interface Props {
  player: Player
  serverId: string
  onClose: () => void
  /**
   * Refresh the roster after a mutation. A kick also produces a player:left
   * the roster hook already listens for, but banning an offline player and
   * pardoning only rewrite banned-players.json — no event covers those.
   */
  onMutated: () => void
}

type PendingAction = { action: 'kick' | 'ban'; reason: string }

function AvatarLarge({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false)
  const key = player.uuid || player.name
  if (failed) {
    return (
      <div className="bg-elevated text-text-muted flex h-12 w-12 shrink-0 items-center justify-center rounded font-mono text-lg">
        {player.name[0]?.toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={`https://mc-heads.net/avatar/${key}/48`}
      alt={player.name}
      width={48}
      height={48}
      className="shrink-0 rounded"
      onError={() => setFailed(true)}
    />
  )
}

function InfoRow({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-text-faint w-20 shrink-0 font-mono text-[10px] tracking-wider uppercase">
        {label}
      </span>
      <span
        className={`font-mono text-xs break-all ${dim ? 'text-text-muted' : 'text-text-secondary'}`}
      >
        {value}
      </span>
    </div>
  )
}

function formatDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return (
    d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

export function PlayerDetailPopup({ player: initial, serverId, onClose, onMutated }: Props) {
  const [player, setPlayer] = useState<Player>(initial)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const reasonRef = useRef<HTMLInputElement>(null)

  // fetch fresh detail on open
  useEffect(() => {
    GetPlayerDetail(serverId, initial.name)
      .then((p) => setPlayer(p))
      .catch(() => {})
  }, [serverId, initial.name])

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pending) setPending(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pending, onClose])

  // focus reason input when pending action opens
  useEffect(() => {
    if (pending) reasonRef.current?.focus()
  }, [pending])

  const submitAction = async () => {
    if (!pending) return
    const fn = pending.action === 'kick' ? KickPlayer : BanPlayer
    await fn(serverId, player.name, pending.reason).catch(console.error)
    setPending(null)
    onMutated()
    onClose()
  }

  const handlePardon = async () => {
    await PardonPlayer(serverId, player.name).catch(console.error)
    const fresh = await GetPlayerDetail(serverId, player.name).catch(() => player)
    setPlayer(fresh)
    onMutated()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* w-88 is 22rem — the same width the inline style used to restate. */}
      <div className="bg-canvas border-hairline flex w-88 flex-col gap-4 rounded-xl border-white/10 p-5 font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        {/* header */}
        <div className="flex items-start gap-3">
          <AvatarLarge player={player} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-text-primary truncate text-sm font-semibold">
                {player.name}
              </span>
              <div
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${player.online ? 'bg-accent' : 'bg-text-faint'}`}
              />
            </div>
            {player.uuid && (
              <span className="text-text-faint mt-0.5 block truncate font-mono text-[9px]">
                {player.uuid}
              </span>
            )}
          </div>
          <IconButton onClick={onClose} title="Close">
            <Icon icon={X} />
          </IconButton>
        </div>

        {/* info */}
        <div className="border-border-subtle border-t-hairline flex flex-col gap-0.5 pt-4">
          {player.ip && <InfoRow label="IP" value={player.ip} />}
          <InfoRow
            label="Status"
            value={
              player.online
                ? 'Online'
                : player.lastOnline
                  ? `Last seen ${formatDate(player.lastOnline)}`
                  : 'Offline'
            }
          />
          <InfoRow
            label="OP level"
            value={player.opLevel > 0 ? `Level ${player.opLevel}` : 'None'}
            dim={player.opLevel === 0}
          />
          <InfoRow
            label="Whitelist"
            value={player.whitelisted ? 'Yes' : 'No'}
            dim={!player.whitelisted}
          />
          {player.banned && (
            <InfoRow label="Banned" value={player.banReason || 'No reason given'} />
          )}
          {player.primaryGroup && <InfoRow label="Role" value={player.primaryGroup} />}
        </div>

        {/* actions */}
        <div className="border-border-subtle border-t-hairline flex flex-col gap-2 pt-4">
          {pending ? (
            <>
              <input
                ref={reasonRef}
                type="text"
                value={pending.reason}
                onChange={(e) => setPending((p) => p && { ...p, reason: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAction()
                }}
                placeholder="Reason (optional)"
                className="bg-elevated border-border-subtle text-text-primary border-hairline rounded px-2 py-1.5 font-mono text-xs transition-colors outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitAction}
                  className={`flex-1 rounded border py-1.5 font-mono text-xs transition-colors ${
                    pending.action === 'kick'
                      ? 'border-yellow-400/30 text-yellow-400/80'
                      : 'border-danger/30 text-danger/80'
                  }`}
                >
                  Confirm {pending.action}
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="text-text-faint px-3 py-1.5 font-mono text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              {player.online && (
                <>
                  <button
                    onClick={() => setPending({ action: 'kick', reason: '' })}
                    className="flex-1 rounded border border-yellow-400/25 py-1.5 font-mono text-xs text-yellow-400/60 transition-colors hover:border-yellow-400/50 hover:text-yellow-400/90"
                  >
                    kick
                  </button>
                  <button
                    onClick={() => setPending({ action: 'ban', reason: '' })}
                    className="border-danger/25 text-danger/60 hover:border-danger/50 hover:text-danger/90 flex-1 rounded border py-1.5 font-mono text-xs transition-colors"
                  >
                    ban
                  </button>
                </>
              )}
              {player.banned && (
                <button
                  onClick={handlePardon}
                  className="border-accent/25 text-accent/60 hover:border-accent/50 hover:text-accent/90 flex-1 rounded border py-1.5 font-mono text-xs transition-colors"
                >
                  pardon
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
