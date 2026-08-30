import { useState, useEffect } from 'react'
import type { ModProject, ModVersion, ResolvedDependency } from './useMods'
import { isDepsRequiredError } from './useMods'
import { DependencyDialog } from './DependencyDialog'
import { ContentCard } from './ContentCard'
import { ModAboutBody } from './ModAboutBody'
import { fmtCount, fmtBytes, relativeTime } from '../../lib/format'
import { IconButton } from '../../components/ui/IconButton'
import { CloseIcon } from '../../components/ui/icons'

interface Props {
  project: ModProject
  projectLoading: boolean
  versions: ModVersion[]
  versionsLoading: boolean
  installing: boolean
  installError: string | null
  moreByAuthorProjects: ModProject[]
  onGetVersions: (projectId: string) => void
  onGetAllVersions: (projectId: string) => void
  onResolveDeps: (versionId: string) => Promise<ResolvedDependency[]>
  onInstall: (versionIds: string[]) => Promise<void>
  onInstallLatest: (projectId: string) => Promise<void>
  onClose: () => void
  onSelectProject: (project: ModProject) => void
  installedProjectIds?: Set<string>
}

type DetailTab = 'about' | 'gallery' | 'versions'

export function ContentDetailPanel({
  project,
  projectLoading,
  versions,
  versionsLoading,
  installing,
  installError,
  moreByAuthorProjects,
  // onResolveDeps is unused here: dependency resolution now surfaces via the
  // isDepsRequiredError thrown from onInstall/onInstallLatest below. Left in
  // Props for caller compatibility.
  onGetVersions,
  onGetAllVersions,
  onResolveDeps: _onResolveDeps,
  onInstall,
  onInstallLatest,
  onClose,
  onSelectProject,
  installedProjectIds,
}: Props) {
  const [tab, setTab] = useState<DetailTab>('about')
  const [galleryIdx, setGalleryIdx] = useState(0)
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [deps, setDeps] = useState<ResolvedDependency[] | null>(null)
  const [pendingVersionId, setPendingVersionId] = useState('')
  const [installing2, setInstalling2] = useState(false)

  useEffect(() => {
    setTab('about')
    setGalleryIdx(0)
    setShowAllVersions(false)
    setDeps(null)
  }, [project.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load compatible versions when tab switches to versions
  useEffect(() => {
    if (tab === 'versions' && versions.length === 0 && !versionsLoading) {
      onGetVersions(project.id)
    }
  }, [tab]) // intentionally omit stable refs

  const handleInstallClick = async () => {
    setInstalling2(true)
    try {
      await onInstallLatest(project.id)
    } catch (e: unknown) {
      if (isDepsRequiredError(e)) {
        setDeps(e.deps)
        setPendingVersionId(e.versionId)
      }
    } finally {
      setInstalling2(false)
    }
  }

  const handleDepConfirm = async (versionIds: string[]) => {
    setDeps(null)
    await onInstall(versionIds)
  }

  const isInstalling = installing || installing2

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

      <div className="flex h-full w-full flex-col overflow-hidden bg-[color-mix(in_srgb,var(--bg-base)_97%,white)]">
        {/* Header */}
        <div className="border-border-subtle border-b-hairline flex shrink-0 items-start gap-2.5 px-4 pt-4 pb-3">
          {project.iconUrl ? (
            <img
              src={project.iconUrl}
              alt=""
              className="h-[42px] w-[42px] shrink-0 rounded object-cover"
            />
          ) : (
            <div className="bg-border-subtle text-text-faint flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded font-mono text-xs">
              &lt;&gt;
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-text-primary truncate text-sm font-semibold">{project.title}</div>
            {project.author && (
              <div className="text-text-muted mt-0.5 truncate text-xs">by {project.author}</div>
            )}
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
              {project.dateModified && (
                <span className="text-text-faint font-mono text-xs text-[10px]">
                  {relativeTime(project.dateModified)}
                </span>
              )}
            </div>
          </div>

          <IconButton onClick={onClose} title="Close">
            <CloseIcon />
          </IconButton>
        </div>

        {/* Install button */}
        <div className="border-border-subtle border-b-hairline shrink-0 px-4 py-2.5">
          <button
            onClick={handleInstallClick}
            disabled={isInstalling}
            className={`bg-accent text-canvas w-full rounded py-1.5 text-xs font-semibold transition-opacity ${
              isInstalling ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {isInstalling ? 'Installing…' : 'Install'}
          </button>
          {installError && <div className="text-danger mt-1.5 text-xs">{installError}</div>}
        </div>

        {/* Sub-tabs */}
        <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-1 px-3 py-1.5">
          {(['about', 'gallery', 'versions'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
                tab === t
                  ? 'text-accent bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] font-semibold'
                  : 'text-text-muted bg-transparent font-normal'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* About */}
          {tab === 'about' && (
            <div className="px-4 py-3">
              <ModAboutBody
                body={project.body}
                description={project.description}
                loading={projectLoading}
              />
            </div>
          )}

          {/* Gallery */}
          {tab === 'gallery' && (
            <div className="px-4 py-3">
              {project.gallery && project.gallery.length > 0 ? (
                <>
                  <img
                    src={project.gallery[galleryIdx]?.url}
                    alt={project.gallery[galleryIdx]?.title ?? ''}
                    className="mb-3 max-h-[220px] w-full rounded-lg object-contain"
                  />
                  {project.gallery.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      {project.gallery.map((img, i) => (
                        <button
                          key={i}
                          onClick={() => setGalleryIdx(i)}
                          className={`h-[44px] w-[44px] overflow-hidden rounded outline-offset-1 ${
                            i === galleryIdx ? 'outline-accent outline-2' : 'outline-none'
                          }`}
                        >
                          <img src={img.url} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-text-muted text-xs">No gallery images.</div>
              )}
            </div>
          )}

          {/* Versions */}
          {tab === 'versions' && (
            <div>
              {versionsLoading && (
                <div className="text-text-muted animate-pulse px-4 py-3 text-xs">
                  Loading versions…
                </div>
              )}
              {!versionsLoading && versions.length === 0 && (
                <div className="text-text-muted px-4 py-3 text-xs">
                  No compatible versions found.
                </div>
              )}
              {versions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  onInstall={() => onInstall([v.id])}
                  installing={isInstalling}
                />
              ))}
              {!showAllVersions && versions.length > 0 && (
                <button
                  onClick={() => {
                    setShowAllVersions(true)
                    onGetAllVersions(project.id)
                  }}
                  className="text-text-muted border-border-subtle border-t-hairline w-full py-2 text-center font-mono text-xs transition-colors"
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
                  }}
                >
                  Show all versions
                </button>
              )}
            </div>
          )}

          {/* More by author */}
          {tab === 'about' && moreByAuthorProjects.length > 0 && (
            <div className="px-4 pb-4">
              <div className="text-text-secondary border-border-subtle border-t-hairline mb-3 pt-3 text-xs font-semibold">
                More by {project.author}
              </div>
              <div className="flex flex-col gap-2">
                {moreByAuthorProjects.map((p) => (
                  <ContentCard
                    key={p.id}
                    project={p}
                    installing={isInstalling}
                    alreadyInstalled={installedProjectIds?.has(p.id)}
                    onClick={() => onSelectProject(p)}
                    onInstallLatest={onInstallLatest}
                    onInstall={onInstall}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function VersionRow({
  version,
  onInstall,
  installing,
}: {
  version: ModVersion
  onInstall: () => void
  installing: boolean
}) {
  const typeColorClass =
    version.versionType === 'release'
      ? 'text-accent'
      : version.versionType === 'beta'
        ? 'text-warning'
        : version.versionType === 'alpha'
          ? 'text-danger'
          : 'text-text-muted'

  return (
    <div className="border-border-subtle border-b-hairline flex items-start gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-primary text-xs font-medium">{version.versionNumber}</span>
          <span
            className={`rounded bg-white/[0.06] px-1.5 py-px font-mono text-xs text-[10px] ${typeColorClass}`}
          >
            {version.versionType}
          </span>
        </div>
        <div className="text-text-faint mt-0.5 font-mono text-xs text-[10px]">
          {version.gameVersions?.slice(0, 3).join(', ')}
          {(version.gameVersions?.length ?? 0) > 3 ? '…' : ''}
          {version.fileSize ? ' · ' + fmtBytes(version.fileSize) : ''}
        </div>
        {version.datePublished && (
          <div className="text-text-faint mt-0.5 font-mono text-xs text-[10px]">
            {relativeTime(version.datePublished)}
          </div>
        )}
      </div>
      <button
        onClick={onInstall}
        disabled={installing}
        className={`text-accent border-hairline shrink-0 rounded border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-2.5 py-1 text-xs font-medium transition-opacity ${
          installing ? 'opacity-50' : 'opacity-100'
        }`}
      >
        Install
      </button>
    </div>
  )
}
