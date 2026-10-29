// aislop-ignore-file code-quality/duplicate-block -- #313
import { useState } from 'react'
import type { useMods, InstalledMod } from './useMods'
import { InstalledPanel } from './InstalledPanel'
import { BrowsePanel } from './BrowsePanel'
import { modToProject } from './modToProject'
import { useProcessesStore } from '../../stores/useProcessesStore'
import { errMsg, isRemoteBrowser } from '../../lib/ipc'

// The Plugins tile's maximized face: the library and the Modrinth browser.
// Behind `lazy()` in `index.tsx`, with everything it pulls in, because the
// canvas face no longer needs any of it; warmed by `lib/prefetch.ts`.

type ModsView = 'library' | 'browse'

export function ModsLibrary({
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
  const [addError, setAddError] = useState<string | null>(null)
  const noun = kind === 'plugins' ? 'Plugin' : 'Mod'
  const modProcess = useProcessesStore((s) => s.processes['mod:' + serverId])

  function openBrowse() {
    setAddError(null)
    setView('browse')
    mods.clearProject()
  }

  function openLibrary() {
    setView('library')
    mods.clearProject()
  }

  // Not mods.installError: that is the browse flow's, and it renders only in the
  // panels, so a failed Add Files would be on screen nowhere. This sits under
  // the header the button is in.
  async function handleAddFiles() {
    setAddError(null)
    try {
      await mods.installLocal()
    } catch (e: unknown) {
      setAddError(errMsg(e))
    }
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
              <span className="text-text-muted text-2xs shrink-0 text-xs">
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
              aria-label="Refresh"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              {refreshing ? '…' : '↺'}
            </button>
            {/* Add Files: ModInstallLocal is a native file dialog, not callable from a remote browser. */}
            {!isRemoteBrowser() && (
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
            )}
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

      {view === 'library' && addError && (
        <div
          role="alert"
          className="text-danger border-border-subtle border-b-hairline shrink-0 px-3 py-1.5 text-xs"
        >
          {addError}
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
            versionsError={mods.versionsError}
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
            versionsError={mods.versionsError}
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
