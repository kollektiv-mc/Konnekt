import { lazy, Suspense, useEffect, useState } from 'react'
import type { TileProps } from '../../types'
import { useWorlds } from './useWorlds'

// Lazy-load the heavy 3D scene so three.js only ships when the tile is maximized.
const WorldsScene = lazy(() =>
  import('./scene/WorldsScene').then((m) => ({ default: m.WorldsScene })),
)

// The WebGL clear colour the scene paints (see scene/WorldsScene.tsx's <Canvas>).
// Deliberately not --bg-base (#05060a): the panel behind and around the Canvas has
// to match the Canvas itself, not the app chrome, or the seam shows during the
// maximize animation. Tracked as a token to add in HEALTH_CHECKLIST.md's backlog.
const SCENE_BG = 'bg-[#050608]'

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

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
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Stats row */}
        <div className="flex items-center justify-center gap-4 py-2">
          <div className="flex flex-col items-center">
            <span className="text-accent font-mono text-xl">{worlds.length}</span>
            <span className="text-text-faint font-mono text-xs">worlds</span>
          </div>
          <div className="bg-border-subtle h-7 w-[0.5px]" />
          <div className="flex flex-col items-center">
            <span className="text-success font-mono text-xl">
              {worlds.find((w) => w.active)?.name ?? '—'}
            </span>
            <span className="text-text-faint font-mono text-xs">active</span>
          </div>
        </div>

        {/* World list */}
        <div className="flex-1 overflow-y-auto px-2 pb-1">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <span className="text-text-faint font-mono text-xs">loading…</span>
            </div>
          )}
          {error && <div className="px-1 font-mono text-xs text-[#ef4444]">{error}</div>}
          {!loading && worlds.length === 0 && !error && (
            <div className="flex h-full items-center justify-center">
              <span className="text-text-faint font-mono text-xs">maximize to explore worlds</span>
            </div>
          )}
          {worlds.slice(0, 8).map((w) => (
            <div key={w.name} className="flex items-center gap-1.5 py-0.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  w.active ? 'bg-success' : 'bg-border-subtle'
                }`}
              />
              <span
                className={`flex-1 truncate font-mono text-xs ${
                  w.active ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {w.name}
              </span>
              <span className="text-text-faint shrink-0 font-mono text-xs">
                {fmtBytes(w.totalSize)}
              </span>
            </div>
          ))}
          {worlds.length > 8 && (
            <span className="text-text-faint font-mono text-xs">+{worlds.length - 8} more</span>
          )}
        </div>

        <div className="px-2 pb-1">
          <span className="text-text-faint font-mono text-xs">maximize to explore</span>
        </div>
      </div>
    )
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
