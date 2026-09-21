import { lazy, Suspense, useState } from 'react'
import type { TileProps, Player } from '../../types'
import { PlayerSummary } from './PlayerSummary'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { PlayerRoster } from './PlayerRoster'
import { PlayerDetailPopup } from './PlayerDetailPopup'
import { usePlayers } from './usePlayers'

// Behind the "Classic tile faces" setting, so it loads only when asked for.
// The specifier matches `lib/prefetch.ts`'s warm list and every other tile's.
const ClassicPlayerGrid = lazy(() =>
  import('../classicFaces').then((m) => ({ default: m.ClassicPlayerGrid })),
)

export function PlayersTile({ serverId, maximized, layout }: TileProps) {
  const [selected, setSelected] = useState<Player | null>(null)
  const classic = useSettingsStore((s) => s.settings.classicTileFaces)
  const { players, reachable, refresh } = usePlayers(serverId)

  return (
    <div className="flex h-full flex-col">
      {maximized ? (
        <PlayerRoster players={players} reachable={reachable} onSelectPlayer={setSelected} />
      ) : classic ? (
        <Suspense fallback={<div className="h-full w-full" />}>
          <ClassicPlayerGrid players={players} reachable={reachable} onSelectPlayer={setSelected} />
        </Suspense>
      ) : (
        <PlayerSummary
          players={players}
          reachable={reachable}
          onSelectPlayer={setSelected}
          layout={layout}
        />
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
