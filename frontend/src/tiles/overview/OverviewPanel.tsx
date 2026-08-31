import { StatusBand } from './StatusBand'
import { PerformanceSection } from './PerformanceSection'
import { PlayersSection } from './PlayersSection'
import { WorldSection } from './WorldSection'
import { BackupsSection } from './BackupsSection'
import { SchedulesSection } from './SchedulesSection'

interface Props {
  serverId: string
}

/**
 * The maximized face of the Overview tile: how this server is doing, in one
 * screen.
 *
 * Six chosen sections rather than a roll-up of every tile's compact view. The
 * roll-up was built first (#211's own approach) and read as a second copy of
 * the canvas: it said what each tile says, in each tile's words, without
 * answering "how is this server doing" any faster than the canvas already did.
 * These six answer it — running state, the three resource curves, who is on,
 * which world, whether backups are current, what is armed.
 *
 * The cost of that is the one architecture rule this tile bends: it imports
 * from four other tile folders, where `agent_docs/CLAUDE.md` says tiles are
 * self-contained. Overview is the documented exception. It reads other tiles'
 * hooks and presentational pieces, never writes through them, and never touches
 * a tile's lazy half — which is why `WorldSection` uses `useWorlds` rather than
 * anything under `worlds/scene/`.
 *
 * Layout: the band and the chart are full width because a time series needs the
 * width and the status needs to be where the eye starts. The four blocks below
 * are `auto-fit`, so they go 4 across, then 2x2, then a single column, without
 * a breakpoint anywhere.
 */
export function OverviewPanel({ serverId }: Props) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <StatusBand />

      <div className="h-56 shrink-0">
        <PerformanceSection serverId={serverId} />
      </div>

      <div className="grid shrink-0 auto-rows-[168px] grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <PlayersSection serverId={serverId} />
        <WorldSection />
        <BackupsSection serverId={serverId} />
        <SchedulesSection />
      </div>
    </div>
  )
}
