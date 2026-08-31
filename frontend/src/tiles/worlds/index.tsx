import { lazy, Suspense, useEffect, useState } from 'react'
import type { TileProps } from '../../types'
import { useWorlds } from './useWorlds'
import { WorldsSummary } from './WorldsSummary'

// Lazy-load the heavy 3D scene so three.js only ships when the tile is maximized.
const WorldsScene = lazy(() =>
  import('./scene/WorldsScene').then((m) => ({ default: m.WorldsScene })),
)

// The WebGL clear colour the scene paints (see scene/WorldsScene.tsx's <Canvas>).
// Deliberately not --bg-base (#05060a): the panel behind and around the Canvas has
// to match the Canvas itself, not the app chrome, or the seam shows during the
// maximize animation. Tracked as a token to add in HEALTH_CHECKLIST.md's backlog.
const SCENE_BG = 'bg-[#050608]'

export function WorldsTile({ maximized }: TileProps) {
  const {
    worlds,
    loading,
    error,
    setActive,
    deleteWorld,
    rename,
    duplicate,
    openFolder,
    backup,
    refresh,
  } = useWorlds()

  // Maximized — 3D scene.
  // Defer mounting the WebGL Canvas until the panel's maximize animation has
  // settled and its CSS transform is stripped (Dashboard.tsx expand animation
  // takes 180ms transition + 200ms cleanup). If Canvas mounts while the panel is
  // still scaled, WebView2 allocates the compositing layer at the wrong size and
  // the scene never fills the panel (gap on right/bottom).
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!maximized) {
      setReady(false)
      return
    }
    const id = setTimeout(() => setReady(true), 220)
    return () => clearTimeout(id)
  }, [maximized])

  if (!maximized) {
    return <WorldsSummary worlds={worlds} loading={loading} error={error} />
  }

  // Dark panel matching the Canvas background — shown while waiting and as
  // the Suspense fallback so there is never a visible "loading" flash.
  const darkPanel = <div className={`absolute inset-0 ${SCENE_BG}`} />

  return (
    <div className={`relative h-full w-full ${SCENE_BG}`}>
      {ready ? (
        <Suspense fallback={darkPanel}>
          <WorldsScene
            worlds={worlds}
            onSetActive={setActive}
            onDelete={deleteWorld}
            onRename={rename}
            onDuplicate={duplicate}
            onOpenFolder={openFolder}
            onBackup={backup}
            onRefresh={refresh}
          />
        </Suspense>
      ) : (
        darkPanel
      )}
    </div>
  )
}
