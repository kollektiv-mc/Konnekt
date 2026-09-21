import { useState } from 'react'
import type { TileProps, Player } from '../../types'
import { PlayerSummary } from './PlayerSummary'
import { PlayerRoster } from './PlayerRoster'
import { PlayerDetailPopup } from './PlayerDetailPopup'
import { usePlayers } from './usePlayers'

export function PlayersTile({ serverId, maximized }: TileProps) {
  const [selected, setSelected] = useState<Player | null>(null)
  const { players, reachable, refresh } = usePlayers(serverId)

  return (
    <div className="flex h-full flex-col">
      {maximized ? (
        <PlayerRoster players={players} reachable={reachable} onSelectPlayer={setSelected} />
      ) : (
        <PlayerSummary players={players} reachable={reachable} onSelectPlayer={setSelected} />
      )}

      {selected && (
        <PlayerDetailPopup
          player={selected}
          serverId={serverId}
          onClose={() => setSelected(null)}
          onMutated={refresh}
        />
      )}
    </div>
  )
}
