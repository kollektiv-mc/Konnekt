import { useState } from 'react'
import type { ModProject, ResolvedDependency } from './useMods'
import { isDepsRequiredError } from './useMods'
import { DependencyDialog } from './DependencyDialog'
import { fmtCount, relativeTime } from '../../lib/format'

interface ContentCardProps {
  project: ModProject
  selected?: boolean
  installing?: boolean
  alreadyInstalled?: boolean
  onClick: () => void
  onInstallLatest: (projectId: string) => Promise<void>
  onInstall: (versionIds: string[]) => Promise<void>
}

export function ContentCard({
  project,
  selected,
  installing,
  alreadyInstalled,
  onClick,
  onInstallLatest,
  onInstall,
}: ContentCardProps) {
  const visibleCategories = (project.categories ?? []).slice(0, 3)
  const [quickInstalling, setQuickInstalling] = useState(false)
  const [done, setDone] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [deps, setDeps] = useState<ResolvedDependency[] | null>(null)
  const [pendingVersionId, setPendingVersionId] = useState('')

  const busy = quickInstalling || installing
  // done = just installed → treat same as installed (grey dim +, no checkmark)
  const showGrey = alreadyInstalled || done

  const handleQuickInstall = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy || alreadyInstalled) return
    setQuickInstalling(true)
    try {
      await onInstallLatest(project.id)
      setDone(true)
      setTimeout(() => setDone(false), 2500)
    } catch (err: unknown) {
      if (isDepsRequiredError(err)) {
        setDeps(err.deps)
        setPendingVersionId(err.versionId)
      }
    } finally {
      setQuickInstalling(false)
    }
  }

  const handleDepConfirm = async (versionIds: string[]) => {
    setDeps(null)
    setQuickInstalling(true)
    try {
      await onInstall(versionIds)
      setDone(true)
      setTimeout(() => setDone(false), 2500)
    } finally {
      setQuickInstalling(false)
    }
  }

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
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onClick()
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`relative flex h-full w-full cursor-pointer flex-col rounded-[10px] p-2.5 text-left transition-all outline-none select-none ${
          selected
            ? 'border-hairline border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-surface))]'
            : hovered
              ? 'bg-hover border-border-hover border-hairline'
              : 'bg-surface border-border-subtle border-hairline'
        }`}
      >
        {/* Icon + title row */}
        <div className="mb-1.5 flex items-start gap-2">
          {project.iconUrl ? (
            <img src={project.iconUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
          ) : (
            <div className="bg-border-subtle text-text-faint flex h-9 w-9 shrink-0 items-center justify-center rounded font-mono text-xs">
              &lt;&gt;
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-text-primary truncate text-xs leading-tight font-semibold">
              {project.title}
            </div>
            {project.author && (
              <div className="text-text-faint mt-0.5 truncate text-xs text-[10px]">
                by {project.author}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-text-muted mb-2 line-clamp-2 flex-1 text-xs leading-relaxed">
          {project.description}
        </p>

        {/* Stats row */}
        <div className="mb-1.5 flex items-center gap-2">
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
            <span className="text-text-faint ml-auto font-mono text-xs text-[10px]">
              {relativeTime(project.dateModified)}
            </span>
          )}
        </div>

        {/* Category tags — gradient mask fades them out on the left where the button sits */}
        {visibleCategories.length > 0 && (
          <div className="flex flex-wrap gap-1 [mask-image:linear-gradient(to_left,transparent_32px,black_46px)] [-webkit-mask-image:linear-gradient(to_left,transparent_32px,black_46px)]">
            {visibleCategories.map((cat) => (
              <span
                key={cat}
                className="text-accent border-hairline rounded border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-1.5 py-px font-mono text-xs text-[10px]"
              >
                {cat}
              </span>
            ))}
          </div>
        )}

        {/* Quick-install button — bottom-left, green border, fades when card not hovered */}
        <button
          onClick={handleQuickInstall}
          disabled={busy || alreadyInstalled}
          title={showGrey ? 'Already installed' : done ? 'Installed!' : 'Install latest version'}
          className={`absolute right-2 bottom-2 z-[1] flex h-[22px] w-[22px] items-center justify-center rounded-md bg-transparent pb-px text-[13px] leading-none [transition:opacity_200ms_ease] ${
            showGrey
              ? 'border-border-subtle text-text-faint border-hairline'
              : 'border-accent text-accent border'
          } ${busy || alreadyInstalled ? 'cursor-default' : 'cursor-pointer'} ${hovered ? 'opacity-100' : 'opacity-20'}`}
          onMouseEnter={(e) => {
            if (!showGrey && !busy) {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'var(--accent)'
              el.style.color = 'var(--bg-base)'
            }
          }}
          onMouseLeave={(e) => {
            if (!showGrey) {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = 'var(--accent)'
            }
          }}
        >
          {quickInstalling ? '…' : '+'}
        </button>
      </div>
    </>
  )
}
