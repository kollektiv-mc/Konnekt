import { useState } from 'react'
import type { Player } from '../../types'

interface Props {
  player: Player
  onClick: () => void
}

export function PlayerCard({ player, onClick }: Props) {
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
