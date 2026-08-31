import { useState, useEffect, useRef, useCallback } from 'react'
import type { ModProject, ModVersion, ResolvedDependency } from './useMods'
import { ContentCard } from './ContentCard'
import { ContentDetailPanel } from './ContentDetailPanel'
import { Pagination } from './Pagination'
import { Popover } from '../../components/ui/Popover'
import { usePopover } from '../../hooks/usePopover'
import { useGridPageAnimation, getTileStyle } from './useGridPageAnimation'

interface Props {
  results: ModProject[]
  total: number
  offset: number
  loading: boolean
  error: string | null
  categories: string[]
  selectedProject: ModProject | null
  projectLoading: boolean
  versions: ModVersion[]
  versionsLoading: boolean
  versionsError?: string | null
  installing: boolean
  installError: string | null
  onSearch: (query: string, categories: string[], offset?: number, sort?: string) => void
  onSelectProject: (project: ModProject) => void
  onClearProject: () => void
  onGetVersions: (projectId: string) => void
  onGetAllVersions: (projectId: string) => void
  onResolveDeps: (versionId: string) => Promise<ResolvedDependency[]>
  onInstall: (versionIds: string[]) => Promise<void>
  onInstallLatest: (projectId: string) => Promise<void>
  moreByAuthor: (username: string, excludeProjectId: string) => Promise<ModProject[]>
  installedProjectIds?: Set<string>
}

const DEFAULT_PANEL_WIDTH = 440
const MIN_PANEL_WIDTH = 300 // narrowest the detail panel can get
const MIN_GRID_WIDTH = 232 // narrowest the grid can get: 1 card (200px) + padding (24px) + gap (8px)

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Relevance' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'follows', label: 'Popularity' },
  { value: 'newest', label: 'Date published' },
  { value: 'updated', label: 'Updated' },
]

// ─── Sort dropdown ─────────────────────────────────────────────────────────────

interface SortMenuProps {
  sort: string
  onSort: (v: string) => void
}

function SortMenu({ sort, onSort }: SortMenuProps) {
  const { open, toggle, close } = usePopover()
  const activeLabel = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Relevance'

  return (
    <div className="relative shrink-0">
      <button
        onClick={toggle}
        className={`border-border-subtle border-hairline flex shrink-0 items-center gap-1 rounded px-2 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
          open ? 'bg-hover' : 'bg-transparent'
        } ${sort ? 'text-accent' : 'text-text-muted'}`}
      >
        <span className="text-text-faint text-[10px]">↕</span>
        {activeLabel}
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

// ─── Categories dropdown ───────────────────────────────────────────────────────

interface CategoriesMenuProps {
  categories: string[]
  selectedCats: string[]
  onToggle: (cat: string) => void
  onClear: () => void
}

function CategoriesMenu({ categories, selectedCats, onToggle, onClear }: CategoriesMenuProps) {
  const { open, toggle, close } = usePopover()
  const count = selectedCats.length
  const disabled = categories.length === 0

  return (
    <div className="relative shrink-0">
      <button
        onClick={disabled ? undefined : toggle}
        className={`border-border-subtle border-hairline flex shrink-0 items-center gap-1 rounded px-2 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
          open ? 'bg-hover' : 'bg-transparent'
        } ${disabled ? 'text-text-faint cursor-default opacity-50' : count > 0 ? 'text-accent cursor-pointer opacity-100' : 'text-text-muted cursor-pointer opacity-100'}`}
      >
        <span className="text-text-faint text-[10px]">☰</span>
        Categories{count > 0 ? ` · ${count}` : ''}
      </button>

      <Popover open={open} onClose={close} width={200} maxHeight={300}>
        <button
          onClick={onClear}
          className={`border-border-subtle border-b-hairline flex w-full items-center gap-2 bg-transparent px-3 py-1.5 text-left font-mono text-xs transition-colors ${
            count === 0 ? 'text-accent' : 'text-text-muted'
          }`}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.background = 'var(--hover-surface)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          <span className={`text-accent w-3 ${count === 0 ? 'opacity-100' : 'opacity-0'}`}>✓</span>
          All
        </button>
        {categories.map((cat) => {
          const active = selectedCats.includes(cat)
          return (
            <button
              key={cat}
              onClick={() => onToggle(cat)}
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
              {cat}
            </button>
          )
        })}
      </Popover>
    </div>
  )
}

// ─── BrowsePanel ───────────────────────────────────────────────────────────────

export function BrowsePanel({
  results,
  total,
  offset,
  loading,
  error,
  categories,
  selectedProject,
  projectLoading,
  versions,
  versionsLoading,
  versionsError,
  installing,
  installError,
  onSearch,
  onSelectProject,
  onClearProject,
  onGetVersions,
  onGetAllVersions,
  onResolveDeps,
  onInstall,
  onInstallLatest,
  moreByAuthor,
  installedProjectIds,
}: Props) {
  const [query, setQuery] = useState('')
  const [selectedCats, setSelectedCats] = useState<string[]>([])
  const [sortBy, setSortBy] = useState('')
  const [moreProjects, setMoreProjects] = useState<ModProject[]>([])

  // ── Detail panel width (resizable) ──────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [resizeActive, setResizeActive] = useState(false)
  const [resizeHover, setResizeHover] = useState(false)
  const mainRowRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = panelWidth
      setResizeActive(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX // drag left → panel grows
        const totalWidth = mainRowRef.current?.offsetWidth ?? 800
        const maxWidth = totalWidth - MIN_GRID_WIDTH
        setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(startWidth + delta, maxWidth)))
      }
      const onMouseUp = () => {
        setResizeActive(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [panelWidth],
  )

  // ── Animation ──────────────────────────────────────────────────────────────
  const panelOpen = !!selectedProject
  const {
    displayResults,
    displayTotal,
    numCols,
    gridVisible,
    layoutOpen,
    pagePhase,
    pageDirection,
    getTileDelay,
    handlePage,
  } = useGridPageAnimation({
    results,
    total,
    loading,
    panelOpen,
    containerRef,
    onSearch: (offset) => onSearch(query, selectedCats, offset, sortBy),
  })

  // Keep last project so the detail panel content doesn't blank during close animation
  const lastProjectRef = useRef<ModProject | null>(null)
  if (selectedProject) lastProjectRef.current = selectedProject
  const displayProject = selectedProject ?? lastProjectRef.current

  const gridCols = `repeat(${numCols}, 1fr)`

  // ── Debounced search — query / categories / sort changes ─────────────────────
  useEffect(() => {
    const t = setTimeout(() => onSearch(query, selectedCats, 0, sortBy), 300)
    return () => clearTimeout(t)
  }, [query, selectedCats, sortBy]) // intentionally omit onSearch

  // ── More by author ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedProject?.author) {
      setMoreProjects([])
      return
    }
    let cancelled = false
    moreByAuthor(selectedProject.author, selectedProject.id)
      .then((ps) => {
        if (!cancelled) setMoreProjects(ps)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedProject?.id, selectedProject?.author]) // intentionally omit moreByAuthor

  const toggleCat = useCallback((cat: string) => {
    setSelectedCats((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]))
  }, [])

  const clearCats = useCallback(() => setSelectedCats([]), [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Search bar + Sort + Categories controls */}
      <div className="border-border-subtle border-b-hairline flex shrink-0 items-center gap-2 px-3 py-2">
        <div
          className="border-border-subtle bg-canvas border-hairline flex flex-1 items-center gap-2 rounded px-2 py-1"
          onFocusCapture={(e) => {
            ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)'
          }}
          onBlurCapture={(e) => {
            ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'
          }}
        >
          <span className="text-text-faint shrink-0 text-xs select-none">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Modrinth…"
            className="text-text-primary caret-accent min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-text-faint shrink-0 text-xs transition-colors"
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
              }}
            >
              ×
            </button>
          )}
        </div>

        <SortMenu sort={sortBy} onSort={setSortBy} />
        <CategoriesMenu
          categories={categories}
          selectedCats={selectedCats}
          onToggle={toggleCat}
          onClear={clearCats}
        />
      </div>

      {/* Active category chips — only shown when filters are active */}
      {selectedCats.length > 0 && (
        <div className="border-border-subtle border-b-hairline flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2">
          {selectedCats.map((cat) => (
            <button
              key={cat}
              onClick={() => toggleCat(cat)}
              className="text-accent border-hairline flex shrink-0 items-center gap-1 rounded border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-2 py-0.5 font-mono text-xs font-semibold transition-colors"
            >
              {cat}
              <span className="text-[10px] opacity-70">×</span>
            </button>
          ))}
          <button
            onClick={clearCats}
            className="text-text-faint border-hairline shrink-0 rounded border-transparent px-2 py-0.5 font-mono text-xs transition-colors"
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-faint)'
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {error && <div className="text-danger shrink-0 px-3 py-1.5 text-xs">{error}</div>}

      {/* Main area: grid (left) + detail panel (right) */}
      <div ref={mainRowRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && displayResults.length === 0 && (
              <div className="text-text-muted animate-pulse py-4 text-center text-xs">
                Searching…
              </div>
            )}
            {!loading && !error && displayResults.length === 0 && (
              <div className="text-text-muted py-4 text-center text-xs">
                {query || selectedCats.length > 0
                  ? 'No results. Try different keywords or categories.'
                  : 'Search Modrinth for mods and plugins.'}
              </div>
            )}

            {displayResults.length > 0 && (
              // eslint-disable-next-line no-restricted-syntax -- gridCols is a live numCols-derived template value
              <div className="grid gap-2" style={{ gridTemplateColumns: gridCols }}>
                {displayResults.map((project, index) => (
                  <div
                    key={project.id}
                    className="min-w-0"
                    // eslint-disable-next-line no-restricted-syntax -- computed per-tile page animation (delay/transform)
                    style={getTileStyle(
                      getTileDelay(project.id),
                      index % numCols,
                      numCols,
                      pagePhase,
                      gridVisible,
                      pageDirection,
                    )}
                  >
                    <ContentCard
                      project={project}
                      selected={selectedProject?.id === project.id}
                      installing={installing}
                      alreadyInstalled={installedProjectIds?.has(project.id)}
                      onClick={() => onSelectProject(project)}
                      onInstallLatest={onInstallLatest}
                      onInstall={onInstall}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <Pagination total={displayTotal} offset={offset} onPage={handlePage} />
        </div>

        {/* Detail panel wrapper — width is user-resizable */}
        <div
          className={`relative min-w-0 shrink-0 overflow-hidden ${
            layoutOpen
              ? 'border-border-subtle border-l-hairline'
              : 'border-l-hairline border-transparent'
          }`}
          // eslint-disable-next-line no-restricted-syntax -- panelWidth is the live user-resized width
          style={{ width: layoutOpen ? panelWidth : 0 }}
        >
          {/* Drag handle — sits on top of the left border */}
          {layoutOpen && (
            <div
              onMouseDown={handleResizeMouseDown}
              onMouseEnter={() => setResizeHover(true)}
              onMouseLeave={() => setResizeHover(false)}
              className={`absolute top-0 bottom-0 -left-[3px] z-10 w-1.5 cursor-col-resize border-l-2 [transition:border-color_var(--duration-fast)_ease] ${
                resizeHover || resizeActive ? 'border-accent' : 'border-transparent'
              }`}
            />
          )}

          <div
            className="duration-panel h-full transition-transform ease-in-out will-change-transform"
            // eslint-disable-next-line no-restricted-syntax -- width/transform depend on the live panelWidth
            style={{
              width: panelWidth,
              transform: panelOpen ? 'translateX(0)' : `translateX(${panelWidth}px)`,
            }}
          >
            {layoutOpen && displayProject && (
              <ContentDetailPanel
                project={displayProject}
                projectLoading={projectLoading}
                versions={versions}
                versionsLoading={versionsLoading}
                versionsError={versionsError}
                installing={installing}
                installError={installError}
                moreByAuthorProjects={moreProjects}
                onGetVersions={onGetVersions}
                onGetAllVersions={onGetAllVersions}
                onResolveDeps={onResolveDeps}
                onInstall={onInstall}
                onInstallLatest={onInstallLatest}
                onClose={onClearProject}
                onSelectProject={onSelectProject}
                installedProjectIds={installedProjectIds}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
