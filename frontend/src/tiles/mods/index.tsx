import { useState } from 'react'
import type { TileProps } from '../../types'
import { useMods } from './useMods'
import type { InstalledMod } from './useMods'
import { InstalledPanel } from './InstalledPanel'
import { BrowsePanel } from './BrowsePanel'
import { useServerStore } from '../../stores/useServerStore'
import { useProcessesStore } from '../../stores/useProcessesStore'
import { ModsSummary } from './ModsSummary'
import { useServerKind } from './useServerKind'
import { modToProject } from './modToProject'

export function ModsTile({ serverId, maximized }: TileProps) {
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
      />
    )
  }

  return <ModsExpanded serverId={serverId} mods={mods} running={running} kind={kind} />
}

// --- Maximized (full) view ---

type ModsView = 'library' | 'browse'

function ModsExpanded({
  serverId,
  mods,
  running,
  kind,
}: {
  serverId: string
  mods: ReturnType<typeof useMods>
  running: boolean
  kind: 'mods' | 'plugins'
}) {
  const [view, setView] = useState<ModsView>('library')
  const [refreshing, setRefreshing] = useState(false)
  const noun = kind === 'plugins' ? 'Plugin' : 'Mod'
  const modProcess = useProcessesStore((s) => s.processes['mod:' + serverId])

  function openBrowse() {
    setView('browse')
    mods.clearProject()
  }

  function openLibrary() {
    setView('library')
    mods.clearProject()
  }

  async function handleAddFiles() {
    await mods.installLocal()
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await mods.refreshInstalled()
      await mods.checkUpdates()
    } finally {
      setRefreshing(false)
    }
  }

  function openInBrowser(mod: InstalledMod) {
    if (!mod.projectId) return
    // Switch to browse, then select the project to open the detail panel.
    setView('browse')
    mods.selectProject(modToProject(mod))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-2 px-3 py-2">
        {view === 'browse' ? (
          <>
            <button
              onClick={openLibrary}
              className="text-text-muted font-mono text-xs transition-colors"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
              }}
            >
              ← Library
            </button>
            <span className="text-text-secondary flex-1 text-xs font-semibold">Add {noun}</span>
          </>
        ) : (
          <>
            <span className="text-text-secondary flex-1 text-xs font-semibold">
              {mods.installed.length}{' '}
              {mods.installed.length === 1
                ? noun.toLowerCase()
                : kind === 'plugins'
                  ? 'plugins'
                  : 'mods'}
            </span>
            {running && (
              <span className="text-text-muted shrink-0 text-xs text-[10px]">
                restart needed for changes
              </span>
            )}
            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`text-text-muted border-border-subtle border-hairline shrink-0 rounded bg-transparent px-2 py-1 font-mono text-xs transition-colors ${
                refreshing ? 'opacity-50' : 'opacity-100'
              }`}
              title="Refresh"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              {refreshing ? '…' : '↺'}
            </button>
            {/* Add Files button */}
            <button
              onClick={handleAddFiles}
              className="text-text-secondary border-border-subtle border-hairline shrink-0 rounded bg-transparent px-3 py-1 text-xs font-semibold transition-colors"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              Add Files
            </button>
            {/* Add Content button */}
            <button
              onClick={openBrowse}
              className="bg-accent text-canvas shrink-0 rounded px-3 py-1 text-xs font-semibold transition-colors"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.85'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
              }}
            >
              Add Content
            </button>
          </>
        )}
      </div>

      {/* Download progress bar */}
      {modProcess?.status === 'running' && (
        <div className="bg-border-subtle h-0.5 w-full shrink-0">
          <div
            className="bg-accent h-full transition-all duration-300"
            // eslint-disable-next-line no-restricted-syntax -- width is a live download-progress percent
            style={{ width: `${modProcess.percent}%` }}
          />
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'library' ? (
          <InstalledPanel
            mods={mods.installed}
            loading={mods.installedLoading}
            error={mods.installedError}
            installProgress={mods.installProgress}
            installing={mods.installing}
            serverRunning={running}
            kind={kind}
            updates={mods.updates}
            onSetEnabled={mods.setEnabled}
            onUninstall={mods.uninstall}
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
            onOpenInBrowser={openInBrowser}
          />
        ) : (
          <BrowsePanel
            results={mods.searchResults}
            total={mods.searchTotal}
            offset={mods.searchOffset}
            loading={mods.searchLoading}
            error={mods.searchError}
            categories={mods.categories}
            selectedProject={mods.selectedProject}
            projectLoading={mods.projectLoading}
            versions={mods.versions}
            versionsLoading={mods.versionsLoading}
            installing={mods.installing}
            installError={mods.installError}
            onSearch={mods.search}
            onSelectProject={mods.selectProject}
            onClearProject={mods.clearProject}
            onGetVersions={mods.getVersions}
            onGetAllVersions={mods.getAllVersions}
            onResolveDeps={mods.resolveDeps}
            onInstall={mods.install}
            onInstallLatest={mods.installLatest}
            moreByAuthor={mods.moreByAuthor}
            installedProjectIds={new Set(mods.installed.map((m) => m.projectId).filter(Boolean))}
          />
        )}
      </div>
    </div>
  )
}
