import type { TileProps } from '../../types'
import { PlayerGrid } from './PlayerGrid'
import { usePlayers } from './usePlayers'

/**
 * The registry's `summary` entry for the Players tile: the same `PlayerGrid`
 * the tile renders unmaximized, fetching its own roster.
 *
 * No `PlayerDetailPopup`. Picking a player opens kick/ban controls in a popup
 * sized for a tile, and a roll-up card is not where that belongs — the card's
 * header opens the tile itself, which is where those actions live. So the grid
 * gets a no-op selection handler here.
 */
export function PlayersSummary({ serverId }: TileProps) {
  const { players, reachable } = usePlayers(serverId)

  return (
    <div className="flex h-full flex-col">
      <PlayerGrid players={players} reachable={reachable} onSelectPlayer={() => {}} />
    </div>
  )
}
