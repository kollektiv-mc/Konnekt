import { useState } from 'react'
import { Toggle } from '../../components/ui/Toggle'
import { Popover } from '../../components/ui/Popover'
import { usePopover } from '../../hooks/usePopover'
import { ModPreviewDialog } from './ModPreviewDialog'
import { fmtBytes } from '../../lib/format'
import type {
  InstalledMod,
  InstallProgress,
  ModProject,
  ModVersion,
  ModUpdateInfo,
  ResolvedDependency,
} from './useMods'

interface Props {
  mods: InstalledMod[]
  loading: boolean
  error: string | null
  installProgress: InstallProgress
  installing: boolean
  serverRunning?: boolean
  kind?: 'mods' | 'plugins'
  updates: Record<string, ModUpdateInfo>
  onSetEnabled: (fileName: string, enabled: boolean) => Promise<void>
  onUninstall: (fileName: string) => Promise<void>
  onChangeVersion: (oldFileName: string, newVersionId: string) => Promise<void>
  // For preview dialog — mirrors useMods
  selectedProject: ModProject | null
  projectLoading: boolean
  versions: ModVersion[]
  versionsLoading: boolean
  versionsError?: string | null
  installError: string | null
  onSelectProject: (mod: InstalledMod) => Promise<void>
  onClearProject: () => void
  onGetVersions: (projectId: string) => void
  onGetAllVersions: (projectId: string) => void
  onResolveDeps: (versionId: string) => Promise<ResolvedDependency[]>
  onInstall: (versionIds: string[]) => Promise<void>
  onOpenInBrowser: (mod: InstalledMod) => void
}

type SortKey = 'name' | 'date' | 'size' | 'updated'
type StatusFilter = 'all' | 'enabled' | 'disabled'
type SourceFilter = 'all' | 'modrinth' | 'local'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date', label: 'Date installed' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
]

// ─── Sort dropdown ────────────────────────────────────────────────────────────

function SortMenu({ sort, onSort }: { sort: SortKey; onSort: (v: SortKey) => void }) {
  const { open, toggle, close } = usePopover()
  const label = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Sort'

  return (
    <div className="relative shrink-0">
      <button
        onClick={toggle}
        className={`border-border-subtle text-text-muted border-hairline flex items-center gap-1 rounded px-2 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
          open ? 'bg-hover' : 'bg-transparent'
        }`}
      >
        <span className="text-text-faint text-[10px]">↕</span>
        {label}
      </button>
      <Popover open={open} onClose={close}>
        {SORT_OPTIONS.map((opt) => {
          const active = opt.value === sort
          return (
            <button
              key={opt.value}
              onClick={() => {
                onSort(opt.value)
                close()
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors ${
                active
                  ? 'text-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                  : 'text-text-primary bg-transparent'
              }`}
              onMouseEnter={(e) => {
                if (!active)
                  (e.currentTarget as HTMLElement).style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <span className={`text-accent w-3 ${active ? 'opacity-100' : 'opacity-0'}`}>✓</span>
              {opt.label}
            </button>
          )
        })}
      </Popover>
    </div>
  )
}

// ─── Filter dropdown ──────────────────────────────────────────────────────────

interface FilterMenuProps {
  statusFilter: StatusFilter
  sourceFilter: SourceFilter
  onStatusFilter: (v: StatusFilter) => void
  onSourceFilter: (v: SourceFilter) => void
}

function FilterMenu({
  statusFilter,
  sourceFilter,
  onStatusFilter,
  onSourceFilter,
}: FilterMenuProps) {
  const { open, toggle, close } = usePopover()
  const active = statusFilter !== 'all' || sourceFilter !== 'all'

  return (
    <div className="relative shrink-0">
      <button
        onClick={toggle}
        className={`border-border-subtle border-hairline flex items-center gap-1 rounded px-2 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
          open ? 'bg-hover' : 'bg-transparent'
        } ${active ? 'text-accent' : 'text-text-muted'}`}
      >
        <span className="text-text-faint text-[10px]">☰</span>
        Filter{active ? ' ·' : ''}
      </button>
      <Popover open={open} onClose={close}>
        <div className="text-text-faint border-border-subtle border-b-hairline px-3 py-1.5 font-mono text-xs text-[10px]">
          Status
        </div>
        {(['all', 'enabled', 'disabled'] as StatusFilter[]).map((v) => {
          const isActive = statusFilter === v
          const label = v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)
          return (
            <button
              key={v}
              onClick={() => onStatusFilter(v)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors ${
                isActive
                  ? 'text-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                  : 'text-text-primary bg-transparent'
              }`}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <span className={`text-accent w-3 ${isActive ? 'opacity-100' : 'opacity-0'}`}>✓</span>
              {label}
            </button>
          )
        })}
        <div className="text-text-faint border-border-subtle border-t-hairline border-b-hairline px-3 py-1.5 font-mono text-xs text-[10px]">
          Source
        </div>
        {(['all', 'modrinth', 'local'] as SourceFilter[]).map((v) => {
          const isActive = sourceFilter === v
          const label = v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)
          return (
            <button
              key={v}
              onClick={() => onSourceFilter(v)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors ${
                isActive
                  ? 'text-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                  : 'text-text-primary bg-transparent'
              }`}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <span className={`text-accent w-3 ${isActive ? 'opacity-100' : 'opacity-0'}`}>✓</span>
              {label}
            </button>
          )
        })}
      </Popover>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function InstalledPanel({
  mods,
  loading,
  error,
  installProgress,
  installing,
  serverRunning,
  kind = 'mods',
  updates,
  onSetEnabled,
  onUninstall,
  onChangeVersion,
  selectedProject,
  projectLoading,
  versions,
  versionsLoading,
  versionsError,
  installError,
  onSelectProject,
  onClearProject,
  onGetVersions,
  onGetAllVersions,
  onResolveDeps,
  onInstall,
  onOpenInBrowser,
}: Props) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [togglingFile, setTogglingFile] = useState<string | null>(null)
  const [uninstallingFile, setUninstallingFile] = useState<string | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null)
  const [previewMod, setPreviewMod] = useState<InstalledMod | null>(null)
  const [numCols, setNumCols] = useState(1)

  // Filter + sort
  const filtered = mods
    .filter((m) => {
      if (statusFilter === 'enabled' && !m.enabled) return false
      if (statusFilter === 'disabled' && m.enabled) return false
      if (sourceFilter !== 'all' && m.source !== sourceFilter) return false
      const q = search.toLowerCase()
      return !q || m.displayName.toLowerCase().includes(q) || m.fileName.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (sortKey === 'name') return a.displayName.localeCompare(b.displayName)
      if (sortKey === 'size') return b.sizeBytes - a.sizeBytes
      // date: newest first; unknowns (0) sink to bottom
      if (a.installedAt === 0 && b.installedAt === 0) return 0
      if (a.installedAt === 0) return 1
      if (b.installedAt === 0) return -1
      return b.installedAt - a.installedAt
    })

  const handleToggle = async (fileName: string, enabled: boolean) => {
    setTogglingFile(fileName)
    try {
      await onSetEnabled(fileName, enabled)
    } finally {
      setTogglingFile(null)
    }
  }

  const handleUninstall = async (fileName: string) => {
    setUninstallingFile(fileName)
    try {
      await onUninstall(fileName)
    } finally {
      setUninstallingFile(null)
      setConfirmUninstall(null)
    }
  }

  const openPreview = async (mod: InstalledMod) => {
    setPreviewMod(mod)
    if (mod.source === 'modrinth' && mod.projectId) {
      await onSelectProject(mod)
    }
  }

  const closePreview = () => {
    setPreviewMod(null)
    onClearProject()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="border-border-subtle border-b-hairline flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-text-muted text-[11px]">⌕</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter…"
          className="text-text-primary min-w-[60px] flex-1 bg-transparent font-mono text-xs outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-text-muted text-[11px]">
            ✕
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <FilterMenu
            statusFilter={statusFilter}
            sourceFilter={sourceFilter}
            onStatusFilter={setStatusFilter}
            onSourceFilter={setSourceFilter}
          />
          <SortMenu sort={sortKey} onSort={setSortKey} />
          {/* Column picker */}
          <div className="border-border-subtle border-hairline flex shrink-0 items-center overflow-hidden rounded">
            {([1, 2, 3, 4] as const).map((n) => (
              <button
                key={n}
                onClick={() => setNumCols(n)}
                className={`flex h-6 w-[22px] items-center justify-center font-mono text-xs transition-colors ${
                  numCols === n ? 'bg-hover text-accent' : 'text-text-faint bg-transparent'
                } ${n < 4 ? 'border-border-subtle border-r-hairline' : 'border-r-hairline border-transparent'}`}
                title={`${n} column${n > 1 ? 's' : ''}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Server-running hint */}
      {serverRunning && (
        <div className="bg-warning/[0.08] text-warning border-border-subtle border-b-hairline shrink-0 px-3 py-1.5 text-xs">
          Changes take effect after server restart
        </div>
      )}

      {/* List */}
      <div
        className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2"
        // eslint-disable-next-line no-restricted-syntax -- gridTemplateColumns is the live user-picked column count
        style={{ gridTemplateColumns: `repeat(${numCols}, 1fr)` }}
      >
        {loading && <div className="text-text-muted px-3 py-4 text-xs">Loading…</div>}
        {error && <div className="text-danger px-3 py-2 text-xs">{error}</div>}
        {!loading && filtered.length === 0 && (
          <div className="text-text-muted px-3 py-4 text-xs">
            {mods.length === 0
              ? `No ${kind} found in this server's ${kind}/ directory.`
              : 'No results match your filter.'}
          </div>
        )}

        {filtered.map((mod) => {
          const bareName = mod.fileName.replace(/\.disabled$/, '')
          const isInstalling = !!installProgress[bareName] || !!installProgress[mod.fileName]
          const pct = installProgress[bareName] ?? installProgress[mod.fileName] ?? 0
          const isToggling = togglingFile === mod.fileName
          const isUninstalling = uninstallingFile === mod.fileName
          const updateInfo = updates[mod.fileName]
          const hasUpdate = updateInfo?.updateAvailable

          return (
            <div
              key={mod.fileName}
              className={`bg-surface border-border-subtle group border-hairline flex items-center gap-3 rounded-[10px] p-[10px_12px] transition-colors ${
                mod.enabled ? 'opacity-100' : 'opacity-55'
              }`}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.background = 'var(--hover-surface)'
                el.style.borderColor = 'var(--border-hover)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.background = 'var(--bg-surface)'
                el.style.borderColor = 'var(--border-subtle)'
              }}
            >
              {/* Icon */}
              <div className="h-10 w-10 shrink-0">
                {mod.iconUrl ? (
                  <img src={mod.iconUrl} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="bg-border-subtle text-text-faint flex h-full w-full items-center justify-center rounded font-mono text-xs">
                    &lt;&gt;
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    onClick={() => openPreview(mod)}
                    className="text-text-primary truncate bg-transparent p-0 text-left text-xs font-semibold hover:underline"
                  >
                    {mod.displayName}
                  </button>
                  {numCols === 1 && mod.versionNumber && (
                    <span className="text-text-muted shrink-0 font-mono text-xs text-[10px]">
                      v{mod.versionNumber}
                    </span>
                  )}
                  {numCols === 1 && (
                    <span
                      className={`shrink-0 rounded px-1 text-xs text-[10px] ${
                        mod.source === 'modrinth'
                          ? 'bg-accent/[0.12] text-accent'
                          : 'text-text-muted bg-white/[0.06]'
                      }`}
                    >
                      {mod.source}
                    </span>
                  )}
                </div>
                {numCols === 1 && (
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-text-faint truncate font-mono text-xs text-[10px]">
                      {mod.fileName}
                    </span>
                    <span className="text-text-faint shrink-0 text-xs text-[10px]">
                      {fmtBytes(mod.sizeBytes)}
                    </span>
                  </div>
                )}
                {isInstalling && (
                  <div className="bg-border-subtle mt-1 h-1 overflow-hidden rounded-full">
                    <div
                      className="bg-accent h-full rounded-full transition-all"
                      // eslint-disable-next-line no-restricted-syntax -- width is a live install-progress percent
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1.5">
                {/* Change version button. versionId, not just projectId: a
                    file identified by its hash as a *secondary* file of a
                    version (EssentialsX ships its modules that way) knows its
                    project but is not itself a version, so there is nothing to
                    switch between. */}
                {mod.source === 'modrinth' && mod.projectId && mod.versionId && (
                  <button
                    onClick={() => openPreview(mod)}
                    className="border-border-subtle text-text-muted border-hairline relative flex h-[26px] w-[26px] items-center justify-center rounded bg-transparent text-xs transition-colors"
                    title={
                      hasUpdate
                        ? `Update available: v${updateInfo.latestVersionNumber}`
                        : 'Change version'
                    }
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLElement).style.background = 'var(--hover-surface)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                    }}
                  >
                    ◎
                    {hasUpdate && (
                      <span className="bg-accent border-canvas border-thick absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full" />
                    )}
                  </button>
                )}

                {/* Enable/disable toggle */}
                <Toggle
                  checked={mod.enabled}
                  onChange={(v) => handleToggle(mod.fileName, v)}
                  disabled={isToggling || installing}
                />

                {/* Delete */}
                {confirmUninstall === mod.fileName ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleUninstall(mod.fileName)}
                      disabled={isUninstalling}
                      className={`bg-danger rounded px-2 py-0.5 text-xs text-white ${
                        isUninstalling ? 'opacity-50' : 'opacity-100'
                      }`}
                    >
                      {isUninstalling ? '…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmUninstall(null)}
                      className="bg-surface text-text-secondary rounded px-2 py-0.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmUninstall(mod.fileName)}
                    className="border-border-subtle text-text-muted border-hairline flex h-[26px] w-[26px] items-center justify-center rounded bg-transparent text-xs opacity-0 transition-colors group-hover:opacity-100"
                    title="Uninstall"
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLElement).style.background =
                        'color-mix(in srgb, var(--danger) 12%, transparent)'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--danger)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Preview dialog */}
      {previewMod && (
        <ModPreviewDialog
          mod={previewMod}
          updateInfo={updates[previewMod.fileName]}
          project={selectedProject}
          projectLoading={projectLoading}
          versions={versions}
          versionsLoading={versionsLoading}
          versionsError={versionsError}
          installing={installing}
          installError={installError}
          onClose={closePreview}
          onGetVersions={onGetVersions}
          onGetAllVersions={onGetAllVersions}
          onResolveDeps={onResolveDeps}
          onInstall={onInstall}
          onChangeVersion={onChangeVersion}
          onOpenInBrowser={() => {
            onOpenInBrowser(previewMod)
            closePreview()
          }}
        />
      )}
    </div>
  )
}
