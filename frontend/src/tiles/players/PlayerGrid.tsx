import type { Player } from '../../types'
import { PlayerCard } from './PlayerCard'

interface Props {
  players: Player[]
  onSelectPlayer: (player: Player) => void
}

export function PlayerGrid({ players, onSelectPlayer }: Props) {
  if (players.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center font-mono text-xs"
        style={{ color: 'var(--text-faint)' }}
      >
        No players online
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
      >
        {players.map((p) => (
          <PlayerCard key={p.name} player={p} onClick={() => onSelectPlayer(p)} />
        ))}
      </div>
    </div>
  )
}
