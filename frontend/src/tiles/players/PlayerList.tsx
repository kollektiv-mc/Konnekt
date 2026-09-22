import type { Player } from '../../types'
import { Tag } from '../../components/ui/Tag'
import { relativeMs } from '../../lib/format'

interface Props {
  players: Player[]
  /** False once a roster fetch has failed — see usePlayers. */
  reachable: boolean
  onSelectPlayer: (player: Player) => void
  /**
   * The large layout's rows: every tag the roster knows (OP, whitelist, ban)
   * and when an offline player was last seen, with a hairline between rows.
   */
  detailed?: boolean
}

/**
 * The roster as rows: a presence dot, the name, and an OP tag where earned.
 *
 * This is the detail half of the Players tile's compact face, below the
 * `Headline` in `PlayerSummary`; the Overview panel's players section mounts
 * it on its own under its own header. It replaced a grid of avatar cards,
 * which spent most of a tile on 32px heads and fitted four names where a list
 * fits ten. The maximized `PlayerRoster` keeps the avatars, where there is
 * room for them.
 *
 * It tells "nobody is online" apart from "the server did not answer", a
 * distinction the roster hook maintains (`emptyStates.test.tsx`).
 */
export function PlayerList({ players, reachable, onSelectPlayer, detailed }: Props) {
  if (players.length === 0) {
    return (
      <div className="text-text-faint flex h-full items-center justify-center font-mono text-xs">
        {reachable ? 'No players online' : 'Server unreachable'}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {players.map((p) => (
        <button
          key={p.name}
          onClick={() => onSelectPlayer(p)}
          className={`hover:bg-hover flex w-full shrink-0 items-center gap-2 rounded px-1 text-left transition-colors ${
            detailed ? 'border-border-subtle border-b-hairline py-1 last:border-0' : 'py-0.5'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.online ? 'bg-accent' : 'bg-text-faint'}`}
          />
          <span className="text-text-secondary min-w-0 flex-1 truncate font-mono text-xs">
            {p.name}
          </span>
          {detailed && !p.online && (
            <span className="text-text-faint text-2xs shrink-0 font-mono">
              {relativeMs(p.lastOnline)}
            </span>
          )}
          {p.opLevel > 0 && <Tag title={`Operator level ${p.opLevel}`}>OP{p.opLevel}</Tag>}
          {detailed && p.whitelisted && <Tag title="Whitelisted">WL</Tag>}
          {detailed && p.banned && (
            <Tag tone="danger" title={p.banReason || 'Banned'}>
              BAN
            </Tag>
          )}
        </button>
      ))}
    </div>
  )
}
