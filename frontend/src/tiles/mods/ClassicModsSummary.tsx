import type { useMods } from './useMods'
import { InstalledPanel } from './InstalledPanel'
import { modToProject } from './modToProject'
import { useProcessesStore } from '../../stores/useProcessesStore'

interface Props {
  serverId: string
  mods: ReturnType<typeof useMods>
  running: boolean
  kind: 'mods' | 'plugins'
  detecting: boolean
}

/**
 * The Plugins tile's classic canvas face, behind Settings › Appearance ›
 * "Classic tile faces": a count, then every installed one as a full row with
 * its switch. Reached through `tiles/classicFaces.ts`, so the rows stay off
 * the entry chunk.
 */
export function ClassicModsSummary({ serverId, mods, running, kind, detecting }: Props) {
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
        {running && <span className="text-text-muted text-2xs">restart needed for changes</span>}
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
          versionsError={mods.versionsError}
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
