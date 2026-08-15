import { useState } from 'react'
import type { Player } from '../../types'

interface Props {
  players: Player[]
  onSelectPlayer: (player: Player) => void
}

type SortKey = 'name' | 'opLevel'

function AvatarHead({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false)
  const key = player.uuid || player.name
  if (failed) {
    return (
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm font-mono text-[10px]"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
      >
        {player.name[0]?.toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={`https://mc-heads.net/avatar/${key}/24`}
      alt={player.name}
      width={24}
      height={24}
      className="shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  )
}

export function PlayerRoster({ players, onSelectPlayer }: Props) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('name')

  const filtered = players
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'opLevel') return b.opLevel - a.opLevel
      return a.name.localeCompare(b.name)
    })

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div
        className="flex shrink-0 gap-2 px-3 py-2"
        style={{ borderBottom: '0.5px solid var(--border-subtle)' }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="flex-1 rounded px-2 py-1 font-mono text-xs transition-colors outline-none"
          style={{
            background: 'var(--bg-elevated)',
            border: '0.5px solid var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded px-2 py-1 font-mono text-xs outline-none"
          style={{
            background: 'var(--bg-elevated)',
            border: '0.5px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <option value="name">Name</option>
          <option value="opLevel">OP level</option>
        </select>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div
            className="flex h-full items-center justify-center font-mono text-xs"
            style={{ color: 'var(--text-faint)' }}
          >
            {search ? 'No matches' : 'No players online'}
          </div>
        ) : (
          filtered.map((p) => (
            <button
              key={p.name}
              onClick={() => onSelectPlayer(p)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
              style={{ borderBottom: '0.5px solid var(--border-subtle)' }}
            >
              <AvatarHead player={p} />
              <span
                className="flex-1 truncate font-mono text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {p.name}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {p.opLevel > 0 && (
                  <span className="rounded border border-yellow-400/30 px-1.5 py-0.5 font-mono text-[10px] text-yellow-400/70">
                    OP{p.opLevel}
                  </span>
                )}
                {p.banned && (
                  <span className="rounded border border-red-400/30 px-1.5 py-0.5 font-mono text-[10px] text-red-400/70">
                    BAN
                  </span>
                )}
                {p.whitelisted && (
                  <span className="rounded border border-blue-400/30 px-1.5 py-0.5 font-mono text-[10px] text-blue-400/70">
                    WL
                  </span>
                )}
                <div
                  className="ml-1 h-1.5 w-1.5 rounded-full"
                  style={{ background: p.online ? '#4ade80' : 'var(--text-faint)' }}
                />
              </div>
            </button>
          ))
        )}
      </div>

      {/* footer */}
      <div
        className="shrink-0 px-3 py-1.5 font-mono text-[10px]"
        style={{ borderTop: '0.5px solid var(--border-subtle)', color: 'var(--text-faint)' }}
      >
        {players.length} online
      </div>
    </div>
  )
}
