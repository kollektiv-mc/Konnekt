import { useState, useEffect, useCallback } from 'react'
import type {
  InstalledMod,
  ModProject,
  ModVersion,
  ModUpdateInfo,
  ResolvedDependency,
} from './useMods'
import { DependencyDialog } from './DependencyDialog'
import { ModAboutBody } from './ModAboutBody'
import { fmtCount, fmtBytes, relativeTime } from '../../lib/format'

interface Props {
  mod: InstalledMod
  updateInfo?: ModUpdateInfo
  // Modrinth data (null while loading / local mods)
  project: ModProject | null
  projectLoading: boolean
  versions: ModVersion[]
  versionsLoading: boolean
  installing: boolean
  installError: string | null
  onClose: () => void
  onGetVersions: (projectId: string) => void
  onGetAllVersions: (projectId: string) => void
  onResolveDeps: (versionId: string) => Promise<ResolvedDependency[]>
  onInstall: (versionIds: string[]) => Promise<void>
  onChangeVersion: (oldFileName: string, newVersionId: string) => Promise<void>
  onOpenInBrowser: () => void
}

type Tab = 'about' | 'versions'

export function ModPreviewDialog({
  mod,
  updateInfo,
  project,
  projectLoading,
  versions,
  versionsLoading,
  installing,
  installError,
  onClose,
  onGetVersions,
  onGetAllVersions,
  onResolveDeps,
  onInstall,
  onChangeVersion,
  onOpenInBrowser,
}: Props) {
  const [tab, setTab] = useState<Tab>('about')
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [deps, setDeps] = useState<ResolvedDependency[] | null>(null)
  const [pendingVersionId, setPendingVersionId] = useState('')
  const [changingVersion, setChangingVersion] = useState(false)

  const isModrinth = mod.source === 'modrinth' && !!mod.projectId

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (tab === 'versions' && isModrinth && versions.length === 0 && !versionsLoading) {
      onGetVersions(mod.projectId)
    }
  }, [tab]) // intentional: only re-run when tab changes

  const handleLoadAllVersions = useCallback(() => {
    setShowAllVersions(true)
    onGetAllVersions(mod.projectId)
  }, [mod.projectId, onGetAllVersions])

  const handleVersionInstall = useCallback(
    async (versionId: string) => {
      try {
        const resolved = await onResolveDeps(versionId)
        const nonTrivial = (resolved ?? []).filter((d) => !d.alreadyInstalled)
        if (nonTrivial.length > 0) {
          setDeps(resolved)
          setPendingVersionId(versionId)
          return
        }
        setChangingVersion(true)
        await onChangeVersion(mod.fileName, versionId)
        onClose()
      } catch {
        // error surfaced via installError prop
      } finally {
        setChangingVersion(false)
      }
    },
    [mod.fileName, onResolveDeps, onChangeVersion, onClose],
  )

  const handleDepConfirm = useCallback(
    async (versionIds: string[]) => {
      setDeps(null)
      setChangingVersion(true)
      try {
        await onInstall(versionIds)
        onClose()
      } finally {
        setChangingVersion(false)
      }
    },
    [onInstall, onClose],
  )

  const icon = mod.iconUrl || project?.iconUrl
  const title = project?.title || mod.displayName
  const author = project?.author
  const description = project?.description || ''
  const body = project?.body || ''

  return (
    <>
      {deps && (
        <DependencyDialog
          primaryVersionId={pendingVersionId}
          dependencies={deps}
          onConfirm={handleDepConfirm}
          onCancel={() => setDeps(null)}
        />
      )}

      {/* Backdrop */}
      <div className="modal-overlay-in fixed inset-0 z-[400] bg-black/65" onClick={onClose} />

      {/* Dialog — fixed height (not just a max-height cap) so the frame
          doesn't resize when Modrinth content/versions finish loading; the
          body's own overflow-y-auto absorbs the difference instead. */}
      <div className="modal-panel-in bg-canvas border-border-subtle border-hairline fixed top-1/2 left-1/2 z-[401] flex h-[560px] max-h-[calc(100vh-80px)] w-[600px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <div className="border-border-subtle border-b-hairline flex shrink-0 items-start gap-3 px-4 pt-4 pb-3">
          {icon ? (
            <img src={icon} alt="" className="h-[44px] w-[44px] shrink-0 rounded object-cover" />
          ) : (
            <div className="bg-border-subtle text-text-faint flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded font-mono text-xs">
              &lt;&gt;
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-text-primary truncate text-sm font-semibold">{title}</div>
            {author && <div className="text-text-muted mt-0.5 text-xs">by {author}</div>}
            {project && (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {project.downloads > 0 && (
                  <span className="text-text-faint font-mono text-xs text-[10px]">
                    ↓ {fmtCount(project.downloads)}
                  </span>
                )}
                {project.follows > 0 && (
                  <span className="text-text-faint font-mono text-xs text-[10px]">
                    ♥ {fmtCount(project.follows)}
                  </span>
                )}
                {mod.versionNumber && (
                  <span className="text-text-faint font-mono text-xs text-[10px]">
                    v{mod.versionNumber}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isModrinth && (
              <button
                onClick={() => {
                  onOpenInBrowser()
                  onClose()
                }}
                className="border-border-subtle text-accent border-hairline rounded bg-transparent px-2 py-1 font-mono text-xs whitespace-nowrap transition-colors"
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background =
                    'color-mix(in srgb, var(--accent) 10%, transparent)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                Open in Browser
              </button>
            )}
            <button
              onClick={onClose}
              className="text-text-muted flex h-6 w-6 items-center justify-center rounded bg-transparent text-xs transition-colors"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'var(--hover-surface)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs (only for Modrinth mods) */}
        {isModrinth && (
          <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-0 px-4">
            {(['about', 'versions'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`border-b-thick -mb-px bg-transparent px-3 py-2 font-mono text-xs capitalize transition-colors ${
                  tab === t ? 'text-accent border-accent' : 'text-text-muted border-transparent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!isModrinth ? (
            // Local mod — simple info card
            <div className="space-y-2 px-4 py-4">
              <div>
                <div className="text-text-muted mb-1 font-mono text-xs">File</div>
                <div className="text-text-primary font-mono text-xs">{mod.fileName}</div>
              </div>
              {mod.modId && (
                <div>
                  <div className="text-text-muted mb-1 font-mono text-xs">Mod ID</div>
                  <div className="text-text-primary font-mono text-xs">{mod.modId}</div>
                </div>
              )}
              {mod.versionNumber && (
                <div>
                  <div className="text-text-muted mb-1 font-mono text-xs">Version</div>
                  <div className="text-text-primary font-mono text-xs">{mod.versionNumber}</div>
                </div>
              )}
              <div>
                <div className="text-text-muted mb-1 font-mono text-xs">Size</div>
                <div className="text-text-primary font-mono text-xs">{fmtBytes(mod.sizeBytes)}</div>
              </div>
            </div>
          ) : tab === 'about' ? (
            <div className="px-4 py-4">
              <ModAboutBody body={body} description={description} loading={projectLoading} />
            </div>
          ) : (
            // Versions tab
            <div>
              {versionsLoading ? (
                <div className="text-text-muted px-4 py-6 text-xs">Loading versions…</div>
              ) : versions.length === 0 ? (
                <div className="text-text-muted px-4 py-6 text-xs">
                  No compatible versions found.
                </div>
              ) : (
                <>
                  {installError && (
                    <div className="text-danger px-4 py-2 text-xs">{installError}</div>
                  )}
                  {versions.map((v) => {
                    const isCurrent = v.id === mod.versionId
                    const isLatestUpdate =
                      updateInfo?.updateAvailable && v.id === updateInfo.latestVersionId
                    const typeColorClass =
                      v.versionType === 'release'
                        ? 'text-accent'
                        : v.versionType === 'beta'
                          ? 'text-warning'
                          : 'text-danger'
                    return (
                      <div
                        key={v.id}
                        className={`border-border-subtle border-b-hairline flex items-center gap-3 px-4 py-2.5 transition-colors ${
                          isCurrent
                            ? 'bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]'
                            : 'bg-transparent'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-text-primary text-xs font-medium">
                              {v.versionNumber}
                            </span>
                            <span
                              className={`shrink-0 font-mono text-xs text-[10px] ${typeColorClass}`}
                            >
                              {v.versionType}
                            </span>
                            {isCurrent && (
                              <span className="text-accent shrink-0 rounded bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1 text-xs text-[10px]">
                                installed
                              </span>
                            )}
                            {isLatestUpdate && !isCurrent && (
                              <span className="text-accent shrink-0 rounded bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1 text-xs text-[10px]">
                                latest
                              </span>
                            )}
                          </div>
                          <div className="text-text-faint mt-0.5 font-mono text-xs text-[10px]">
                            {v.gameVersions.slice(0, 3).join(', ')}
                            {v.gameVersions.length > 3 ? ` +${v.gameVersions.length - 3}` : ''}
                            {v.fileSize ? ` · ${fmtBytes(v.fileSize)}` : ''}
                            {v.datePublished ? ` · ${relativeTime(v.datePublished)}` : ''}
                          </div>
                        </div>
                        {!isCurrent && (
                          <button
                            onClick={() => handleVersionInstall(v.id)}
                            disabled={installing || changingVersion}
                            className={`border-border-subtle text-text-secondary border-hairline shrink-0 rounded px-2 py-0.5 text-xs transition-colors ${
                              installing || changingVersion ? 'opacity-50' : 'opacity-100'
                            }`}
                            onMouseEnter={(e) => {
                              ;(e.currentTarget as HTMLElement).style.background =
                                'var(--hover-surface)'
                            }}
                            onMouseLeave={(e) => {
                              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                            }}
                          >
                            {installing || changingVersion ? '…' : 'Switch'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {!showAllVersions && (
                    <button
                      onClick={handleLoadAllVersions}
                      className="text-text-muted w-full py-2 font-mono text-xs transition-colors"
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
                      }}
                    >
                      Show all versions
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
