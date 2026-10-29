// aislop-ignore-file code-quality/duplicate-block -- #313
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { TileLayout, TileProps } from '../../types'
import { useMods } from './useMods'
import { ModsGlance } from './ModsGlance'
import { useServerStore } from '../../stores/useServerStore'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useProcessesStore } from '../../stores/useProcessesStore'
import { DetectServerLoader } from '../../../wailsjs/go/main/App'
import { PLUGIN_LOADERS } from '../../lib/constants'
import { isRemoteBrowser, readOr } from '../../lib/ipc'
import { Headline } from '../../components/ui/Figure'
import { useSettingsStore } from '../../stores/useSettingsStore'

// Same specifier `lib/prefetch.ts` warms. The library, the browser and their
// dialogs are most of this tile's code and only the maximized face shows them.
const ModsLibrary = lazy(() => import('./ModsLibrary').then((m) => ({ default: m.ModsLibrary })))

const ClassicModsSummary = lazy(() =>
  import('../classicFaces').then((m) => ({ default: m.ClassicModsSummary })),
)

function useServerKind(serverId: string): { kind: 'mods' | 'plugins'; detecting: boolean } {
  const config = useServerConfigStore((s) => s.configs.find((c) => c.id === serverId))
  const saveConfig = useServerConfigStore((s) => s.saveConfig)
  const [detecting, setDetecting] = useState(false)
  const detected = useRef(false)

  // Asked once per mount, not once per lifetime. The old gate skipped this
  // whenever a loader was stored, so a server described wrongly once stayed
  // that way: nothing re-derived it, and the two fields are what every Modrinth
  // query is filtered by.
  //
  // The backend decides what is worth keeping — it fills gaps, drops a stored
  // pair whose Minecraft version is not one, and clears a jar path pointing at
  // an installer. Validating any of that here would mean a second copy of those
  // rules on this side of the bridge, free to drift from the copy that counts.
  // So the answer is simply compared with what is stored, and written only when
  // it differs.
  useEffect(() => {
    if (detected.current) return
    if (!config) return
    // A NeoForge/Forge install has no jar path — detection falls back to the
    // working dir, so gate on having neither rather than on the jar.
    if (!config.jarPath && !config.workingDir) return

    detected.current = true
    setDetecting(true)
    readOr(() => DetectServerLoader(serverId), null)
      .then(async (cfg) => {
        if (!cfg) return
        const unchanged =
          cfg.loader === config.loader &&
          cfg.mcVersion === config.mcVersion &&
          cfg.jarPath === config.jarPath
        // SaveServerConfig is admin tier: remotely it would raise an approval prompt nobody asked for.
        if (unchanged || isRemoteBrowser()) return
        try {
          await saveConfig(cfg)
        } catch {
          // Deliberately not surfaced here: nobody clicked anything, so a banner
          // would blame the user for a sync they did not start. The store has
          // already recorded the message in its `error` before rethrowing (the
          // server manager shows it), and dropping the rethrow loses nothing:
          // the write only refreshes a value derived from the files on disk, so
          // a refused one leaves the stored config as it was and the next mount
          // asks again. detected stays true, so this mount does not retry.
        }
      })
      .finally(() => setDetecting(false))
  }, [serverId, config, saveConfig])

  const kind = (PLUGIN_LOADERS as readonly string[]).includes(config?.loader ?? '')
    ? 'plugins'
    : 'mods'
  return { kind, detecting }
}

export function ModsTile({ serverId, maximized, layout = 'default' }: TileProps) {
  const mods = useMods(serverId)
  const running = useServerStore((s) => s.status.running)
  const { kind, detecting } = useServerKind(serverId)

  if (!maximized) {
    return (
      <ModsSummary
        serverId={serverId}
        mods={mods}
        running={running}
        kind={kind}
        detecting={detecting}
        layout={layout}
      />
    )
  }

  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <ModsLibrary serverId={serverId} mods={mods} running={running} kind={kind} />
    </Suspense>
  )
}

// --- Canvas (non-maximized) face ---

function ModsSummary({
  serverId,
  mods,
  running,
  kind,
  detecting,
  layout,
}: {
  serverId: string
  mods: ReturnType<typeof useMods>
  running: boolean
  kind: 'mods' | 'plugins'
  detecting: boolean
  layout: TileLayout
}) {
  const classic = useSettingsStore((s) => s.settings.classicTileFaces)
  const { installed, installedLoading, updates } = mods
  const noun = kind === 'plugins' ? 'plugin' : 'mod'
  const nounPlural = kind === 'plugins' ? 'plugins' : 'mods'
  const modProcess = useProcessesStore((s) => s.processes['mod:' + serverId])
  const enabledCount = installed.filter((m) => m.enabled).length
  const updateCount = installed.filter((m) => updates[m.fileName]?.updateAvailable).length

  if (classic) {
    return (
      <Suspense fallback={<div className="h-full w-full" />}>
        <ClassicModsSummary
          serverId={serverId}
          mods={mods}
          running={running}
          kind={kind}
          detecting={detecting}
        />
      </Suspense>
    )
  }

  // The installed count is the figure and the cells under it are the detail,
  // the default layout's shape; "N on" beside it is the number a running
  // server actually reflects, since a toggle waits for a restart. Toggling
  // and the rest of managing them is the maximized face's.
  return (
    <div className={`flex h-full min-h-0 flex-col ${layout === 'compact' ? 'justify-center' : ''}`}>
      <div className="shrink-0 px-3 pt-2 pb-1">
        <Headline
          size={layout === 'detailed' ? 'sm' : 'lg'}
          value={detecting ? '…' : String(installed.length)}
          unit={
            detecting
              ? 'detecting server type…'
              : `${installed.length === 1 ? noun : nounPlural} installed · ${enabledCount} on${
                  updateCount > 0
                    ? ` · ${updateCount} ${updateCount === 1 ? 'update' : 'updates'} available`
                    : ''
                }`
          }
          aside={running ? 'restart needed for changes' : undefined}
        />
      </div>
      {modProcess?.status === 'running' && (
        <div className="bg-border-subtle h-0.5 w-full shrink-0">
          <div
            className="bg-accent h-full transition-all duration-300"
            // eslint-disable-next-line no-restricted-syntax -- width is a live download-progress percent
            style={{ width: `${modProcess.percent}%` }}
          />
        </div>
      )}
      {layout !== 'compact' && (
        <ModsGlance
          mods={installed}
          updates={updates}
          loading={installedLoading}
          error={mods.installedError}
          kind={kind}
          layout={layout}
        />
      )}
    </div>
  )
}
