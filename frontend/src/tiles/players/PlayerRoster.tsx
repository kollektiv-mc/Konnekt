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
      <div className="bg-elevated text-text-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-sm font-mono text-[10px]">
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
      <div className="border-border-subtle flex shrink-0 gap-2 border-b-[0.5px] px-3 py-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="bg-elevated border-border-subtle text-text-primary flex-1 rounded border-[0.5px] px-2 py-1 font-mono text-xs transition-colors outline-none"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="bg-elevated border-border-subtle text-text-secondary rounded border-[0.5px] px-2 py-1 font-mono text-xs outline-none"
        >
          <option value="name">Name</option>
          <option value="opLevel">OP level</option>
        </select>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-text-faint flex h-full items-center justify-center font-mono text-xs">
            {search ? 'No matches' : 'No players online'}
          </div>
        ) : (
          filtered.map((p) => (
            <button
              key={p.name}
              onClick={() => onSelectPlayer(p)}
              className="border-border-subtle flex w-full items-center gap-3 border-b-[0.5px] px-4 py-2.5 text-left transition-colors hover:bg-white/5"
            >
              <AvatarHead player={p} />
              <span className="text-text-secondary flex-1 truncate font-mono text-xs">
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
                  className={`ml-1 h-1.5 w-1.5 rounded-full ${p.online ? 'bg-accent' : 'bg-text-faint'}`}
                />
              </div>
            </button>
          ))
        )}
      </div>

      {/* footer */}
      <div className="border-border-subtle text-text-faint shrink-0 border-t-[0.5px] px-3 py-1.5 font-mono text-[10px]">
        {players.length} online
      </div>
    </div>
  )
}
