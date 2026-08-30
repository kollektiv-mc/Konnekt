import { Suspense, lazy } from 'react'
import { QuickCommandsPanel } from '../../components/QuickCommandsPanel'
import type { TileProps } from '../../types'

// The management half of the tile — grouping, inline editing and the whole
// Kommands link surface — only renders when the tile is maximized, so it loads
// on demand rather than on every launch. Warmed during idle by lib/prefetch.ts,
// which names this exact specifier.
const CommandLibrary = lazy(() =>
  import('./library/CommandLibrary').then((m) => ({ default: m.CommandLibrary })),
)

export function QuickCommandsTile({ serverId, maximized }: TileProps) {
  if (!maximized) return <QuickCommandsPanel serverId={serverId} />
  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <CommandLibrary serverId={serverId} />
    </Suspense>
  )
}
