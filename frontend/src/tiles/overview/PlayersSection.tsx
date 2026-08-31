import { UsersRound } from '../../lib/icons'
import { usePlayers } from '../players/usePlayers'
import { PlayerGrid } from '../players/PlayerGrid'
import { Section } from './Section'

/**
 * Who is on the server right now.
 *
 * Reuses the tile's own `PlayerGrid`, which already draws the avatars and
 * already tells "nobody is online" apart from "the server did not answer" — a
 * distinction the roster hook maintains and which this panel would otherwise
 * get wrong in exactly the way HEALTH_LOG records for 2026-08-20.
 *
 * Selection is a no-op: picking a player opens kick/ban controls, and those
 * belong in the tile the header opens, not in a dashboard block.
 */
export function PlayersSection({ serverId }: { serverId: string }) {
  const { players, reachable } = usePlayers(serverId)

  return (
    <Section tileId="players" icon={UsersRound} label="Players" meta={players.length || undefined}>
      <PlayerGrid players={players} reachable={reachable} onSelectPlayer={() => {}} />
    </Section>
  )
}
