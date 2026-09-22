import { useState } from 'react'
import type { Player } from '../../types'

interface Props {
  players: Player[]
  /** False once a roster fetch has failed — see usePlayers. */
  reachable: boolean
  onSelectPlayer: (player: Player) => void
}

/**
 * The classic face: the compact face this tile had before the figure-first
 * one, kept verbatim behind Settings › Appearance › "Classic tile faces" for
 * anyone who preferred it. It ignores the per-tile layout. Change the
 * figure-first face for new work; this one only follows if a hook it shares
 * changes shape.
 */
export function ClassicPlayerGrid({ players, reachable, onSelectPlayer }: Props) {
  if (players.length === 0) {
    return (
      <div className="text-text-faint flex h-full items-center justify-center font-mono text-xs">
        {reachable ? 'No players online' : 'Server unreachable'}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1.5">
        {players.map((p) => (
          <PlayerCard key={p.name} player={p} onClick={() => onSelectPlayer(p)} />
        ))}
      </div>
    </div>
  )
}

function PlayerCard({ player, onClick }: { player: Player; onClick: () => void }) {
  const [imgFailed, setImgFailed] = useState(false)
  const avatarKey = player.uuid || player.name

  return (
    <button
      onClick={onClick}
      className="border-border-subtle border-hairline flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors hover:bg-white/5 active:bg-white/10"
    >
      <div className="relative">
        {imgFailed ? (
          <div className="bg-elevated text-text-muted flex h-8 w-8 items-center justify-center rounded-sm font-mono text-xs">
            {player.name[0]?.toUpperCase()}
          </div>
        ) : (
          <img
            src={`https://mc-heads.net/avatar/${avatarKey}/32`}
            alt={player.name}
            width={32}
            height={32}
            className="rounded-sm"
            onError={() => setImgFailed(true)}
          />
        )}
        <div
          className={`border-canvas border-thick absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ${player.online ? 'bg-accent' : 'bg-text-faint'}`}
        />
      </div>
      <span className="text-text-secondary w-full truncate font-mono text-xs">{player.name}</span>
    </button>
  )
}
