import type { Player, TileLayout } from '../../types'
import { useServerStore } from '../../stores/useServerStore'
import { Headline } from '../../components/ui/Figure'
import { PlayerList } from './PlayerList'

interface Props {
  players: Player[]
  /** False once a roster fetch has failed — see usePlayers. */
  reachable: boolean
  onSelectPlayer: (player: Player) => void
  layout?: TileLayout
}

/**
 * The compact face of the Players tile: how many are on, out of how many the
 * server admits, then who they are.
 *
 * The count is the figure and the roster is the detail, in that order, which
 * is the default layout's shape. Compact keeps the count alone; large sets it
 * small and gives the rows every tag and a last-seen time. `maxPlayers` comes
 * from the server status the app hydrates once (`hooks/useServerStatus.ts`),
 * the same store `Vitals` reads it from; the roster itself is the tile's own
 * hook.
 */
export function PlayerSummary({ players, reachable, onSelectPlayer, layout = 'default' }: Props) {
  const maxPlayers = useServerStore((s) => s.status.maxPlayers)
  const online = players.filter((p) => p.online).length

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-2">
      <Headline
        size={layout === 'large' ? 'sm' : 'lg'}
        value={String(online)}
        unit={`of ${maxPlayers} online`}
      />
      {layout !== 'compact' && (
        <PlayerList
          players={players}
          reachable={reachable}
          onSelectPlayer={onSelectPlayer}
          detailed={layout === 'large'}
        />
      )}
    </div>
  )
}
