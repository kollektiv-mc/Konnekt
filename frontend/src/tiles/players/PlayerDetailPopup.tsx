import { useEffect, useRef, useState } from 'react'
import { GetPlayerDetail, KickPlayer, BanPlayer, PardonPlayer } from '../../../wailsjs/go/main/App'
import type { Player } from '../../types'

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
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded font-mono text-lg"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
      >
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
      <span
        className="w-20 shrink-0 font-mono text-[10px] tracking-wider uppercase"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </span>
      <span
        className="font-mono text-xs break-all"
        style={{ color: dim ? 'var(--text-muted)' : 'var(--text-secondary)' }}
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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex w-88 flex-col gap-4 rounded-xl p-5 font-mono"
        style={{
          width: '22rem',
          background: 'var(--bg-base)',
          border: '0.5px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* header */}
        <div className="flex items-start gap-3">
          <AvatarLarge player={player} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {player.name}
              </span>
              <div
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: player.online ? '#4ade80' : 'var(--text-faint)' }}
              />
            </div>
            {player.uuid && (
              <span
                className="mt-0.5 block truncate font-mono text-[9px]"
                style={{ color: 'var(--text-faint)' }}
              >
                {player.uuid}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-lg leading-none transition-colors"
            style={{ color: 'var(--text-faint)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
          >
            ×
          </button>
        </div>

        {/* info */}
        <div
          className="flex flex-col gap-0.5"
          style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: '1rem' }}
        >
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
        <div
          className="flex flex-col gap-2"
          style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: '1rem' }}
        >
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
                className="rounded px-2 py-1.5 font-mono text-xs transition-colors outline-none"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '0.5px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={submitAction}
                  className="flex-1 rounded border py-1.5 font-mono text-xs transition-colors"
                  style={{
                    borderColor:
                      pending.action === 'kick' ? 'rgba(250,204,21,0.3)' : 'rgba(248,113,113,0.3)',
                    color:
                      pending.action === 'kick' ? 'rgba(250,204,21,0.8)' : 'rgba(248,113,113,0.8)',
                  }}
                >
                  Confirm {pending.action}
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="px-3 py-1.5 font-mono text-xs transition-colors"
                  style={{ color: 'var(--text-faint)' }}
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
                    className="flex-1 rounded border py-1.5 font-mono text-xs transition-colors"
                    style={{ borderColor: 'rgba(250,204,21,0.25)', color: 'rgba(250,204,21,0.6)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(250,204,21,0.5)'
                      e.currentTarget.style.color = 'rgba(250,204,21,0.9)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(250,204,21,0.25)'
                      e.currentTarget.style.color = 'rgba(250,204,21,0.6)'
                    }}
                  >
                    kick
                  </button>
                  <button
                    onClick={() => setPending({ action: 'ban', reason: '' })}
                    className="flex-1 rounded border py-1.5 font-mono text-xs transition-colors"
                    style={{
                      borderColor: 'rgba(248,113,113,0.25)',
                      color: 'rgba(248,113,113,0.6)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(248,113,113,0.5)'
                      e.currentTarget.style.color = 'rgba(248,113,113,0.9)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(248,113,113,0.25)'
                      e.currentTarget.style.color = 'rgba(248,113,113,0.6)'
                    }}
                  >
                    ban
                  </button>
                </>
              )}
              {player.banned && (
                <button
                  onClick={handlePardon}
                  className="flex-1 rounded border py-1.5 font-mono text-xs transition-colors"
                  style={{ borderColor: 'rgba(74,222,128,0.25)', color: 'rgba(74,222,128,0.6)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(74,222,128,0.5)'
                    e.currentTarget.style.color = 'rgba(74,222,128,0.9)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(74,222,128,0.25)'
                    e.currentTarget.style.color = 'rgba(74,222,128,0.6)'
                  }}
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
