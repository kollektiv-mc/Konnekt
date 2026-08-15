import type { Player } from '../../types'
import { PlayerCard } from './PlayerCard'

interface Props {
  players: Player[]
  onSelectPlayer: (player: Player) => void
}

export function PlayerGrid({ players, onSelectPlayer }: Props) {
  if (players.length === 0) {
    return (
      <div className="text-text-faint flex h-full items-center justify-center font-mono text-xs">
        No players online
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
