import type { TileProps } from '../../types'
import { useMods } from './useMods'
import { InstalledPanel } from './InstalledPanel'
import { useServerStore } from '../../stores/useServerStore'
import { useProcessesStore } from '../../stores/useProcessesStore'
import { useServerKind } from './useServerKind'
import { modToProject } from './modToProject'

/**
 * The compact face of the Mods tile: how many are installed, whether a restart
 * is pending, and the installed list with its enable/uninstall/version
 * controls.
 *
 * Presentational — `useMods` is instantiated by whoever renders this, so the
 * tile root and the Overview roll-up each bring their own. That does mean a
 * maximized Overview holds a second copy while it is open, including the two
 * Modrinth round trips `useMods` makes on mount; #212 hoists the other
 * summaries' fetches into stores but scopes `useMods` out, so this one is
 * recorded in HEALTH_CHECKLIST.md's backlog rather than fixed here.
 */
export function ModsSummary({
  serverId,
  mods,
  running,
  kind,
  detecting,
}: {
  serverId: string
  mods: ReturnType<typeof useMods>
  running: boolean
  kind: 'mods' | 'plugins'
  detecting: boolean
}) {
  const { installed, installedLoading, installProgress, setEnabled, uninstall, updates } = mods
  const noun = kind === 'plugins' ? 'plugin' : 'mod'
  const nounPlural = kind === 'plugins' ? 'plugins' : 'mods'
  const modProcess = useProcessesStore((s) => s.processes['mod:' + serverId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-text-secondary text-xs font-semibold">
          {detecting
            ? 'Detecting server type…'
            : `${installed.length} ${installed.length !== 1 ? nounPlural : noun}`}
        </span>
        {running && (
          <span className="text-text-muted text-xs text-[10px]">restart needed for changes</span>
        )}
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InstalledPanel
          mods={installed}
          loading={installedLoading}
          error={mods.installedError}
          installProgress={installProgress}
          installing={mods.installing}
          serverRunning={running}
          kind={kind}
          updates={updates}
          onSetEnabled={setEnabled}
          onUninstall={uninstall}
          onChangeVersion={mods.changeVersion}
          selectedProject={mods.selectedProject}
          projectLoading={mods.projectLoading}
          versions={mods.versions}
          versionsLoading={mods.versionsLoading}
          installError={mods.installError}
          onSelectProject={(mod) => mods.selectProject(modToProject(mod))}
          onClearProject={mods.clearProject}
          onGetVersions={mods.getVersions}
          onGetAllVersions={mods.getAllVersions}
          onResolveDeps={mods.resolveDeps}
          onInstall={mods.install}
          onOpenInBrowser={() => {
            /* no-op in compact view */
          }}
        />
      </div>
    </div>
  )
}

/** The registry's `summary` entry: the same view, wiring up its own data. */
export function ModsSummaryCard({ serverId }: TileProps) {
  const mods = useMods(serverId)
  const running = useServerStore((s) => s.status.running)
  const { kind, detecting } = useServerKind(serverId)

  return (
    <ModsSummary
      serverId={serverId}
      mods={mods}
      running={running}
      kind={kind}
      detecting={detecting}
    />
  )
}
