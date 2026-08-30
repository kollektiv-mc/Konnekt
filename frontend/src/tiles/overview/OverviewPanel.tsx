// `../registry` imports this file's tile back, so this is a module cycle. It is
// safe and deliberate: nothing here touches `TILE_REGISTRY` at module-evaluation
// time, only inside the component body, by which point both modules have
// finished evaluating. Reading the registry is the whole point of the panel —
// see the note on `summary` in `types/index.ts` — so the alternative is a
// hand-kept roster here that a new tile would silently fall out of.
import { TILE_REGISTRY } from '../registry'
import type { FC } from 'react'
import type { TileProps } from '../../types'
import { SquareActivity } from '../../lib/icons'
import { Vitals } from './Vitals'
import { SummaryCard } from './SummaryCard'

interface Props {
  serverId: string
}

/**
 * The maximized face of the Overview tile: every tile's compact summary at once.
 *
 * Deliberately driven by `TILE_REGISTRY` rather than `useTileStore`'s
 * `activeTileIds`. A card therefore appears for a tile that is not on the
 * canvas at all, which is most of this panel's value — it is the one place
 * that shows the state of a tile the user has put away, and each card's header
 * is the way back into it.
 *
 * Each summary is the owning tile's own component, mounted as it renders
 * itself, actions included. Nothing here reimplements a summary; a tile that
 * has nothing worth rolling up simply omits `summary` from its registry entry
 * (the console's live log and the command button grid are the two).
 */
export function OverviewPanel({ serverId }: Props) {
  // The predicate narrows the type as well as the list, so the render below
  // reads `tile.summary` as a component rather than a maybe-component.
  const summaries = TILE_REGISTRY.filter(
    (t): t is (typeof TILE_REGISTRY)[number] & { summary: FC<TileProps> } =>
      t.summary !== undefined,
  )

  return (
    <div className="h-full overflow-y-auto p-3">
      {/* Sized to the largest thing a summary puts inside a card, not to the
          smallest that would read: BackupsSummary opens BackupRunningDialog
          over its own card, and that dialog's three stacked buttons need about
          200px of height and 250px of width to stay whole. */}
      <div className="grid auto-rows-[260px] grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {/* The vitals lead, and carry no maximize control: this *is* the tile
            you are looking at. */}
        <SummaryCard label="Server" icon={SquareActivity}>
          <Vitals />
        </SummaryCard>

        {summaries.map((tile) => {
          const Summary = tile.summary
          return (
            <SummaryCard key={tile.id} tileId={tile.id} label={tile.label} icon={tile.icon}>
              <Summary serverId={serverId} />
            </SummaryCard>
          )
        })}
      </div>
    </div>
  )
}
