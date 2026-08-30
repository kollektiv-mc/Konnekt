import { useState, useEffect } from 'react'
import type { Backup } from './useBackups'
import type { WorldSystem } from './useBackupWorlds'
import { fmtBytes, fmtDate, extractID } from './format'
import { IconButton } from '../../components/ui/IconButton'
import { CloseIcon } from '../../components/ui/icons'

const KIND_COLOR: Record<string, string> = {
  overworld: '#22c55e',
  nether: '#ef4444',
  the_end: '#a78bfa',
}

const KIND_LABEL: Record<string, string> = {
  overworld: 'Overworld',
  nether: 'Nether',
  the_end: 'The End',
}

interface ServerInfoPanelProps {
  backup: Backup
  worlds: WorldSystem[]
  onClose: () => void
}

export function ServerInfoPanel({ backup, worlds, onClose }: ServerInfoPanelProps) {
  const [visible, setVisible] = useState(false)
  const [worldsOpen, setWorldsOpen] = useState(true)
  const [expandedWorlds, setExpandedWorlds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggleWorld(name: string) {
    setExpandedWorlds((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const displayLabel = backup.displayName || extractID(backup.filename)

  return (
    <div
      className="border-l-border-subtle border-l-hairline absolute top-0 right-0 bottom-0 z-20 flex w-[42%] min-w-[230px] flex-col overflow-y-auto bg-[color-mix(in_srgb,var(--bg-base)_97%,white)]"
      // eslint-disable-next-line no-restricted-syntax -- slide-in animation driven by `visible` mount state
      style={{
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 320ms cubic-bezier(0.34,1.15,0.64,1)',
      }}
    >
      {/* Header */}
      <div className="border-b-border-subtle border-b-hairline flex shrink-0 items-start justify-between gap-2 px-4 pt-5 pb-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-text-primary truncate font-mono text-sm">{displayLabel}</span>
          {backup.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {backup.tags.map((tag) => (
                <TagPill key={tag} tag={tag} />
              ))}
            </div>
          )}
        </div>
        <IconButton onClick={onClose} title="Close" className="mt-0.5">
          <CloseIcon />
        </IconButton>
      </div>

      {/* Meta */}
      <div className="border-b-border-subtle border-b-hairline flex shrink-0 flex-col px-4 py-3">
        <Row label="created" value={fmtDate(backup.createdAt)} />
        <Row label="size" value={fmtBytes(backup.sizeBytes)} />
        <Row label="file" value={backup.filename} mono />
      </div>

      {/* Worlds section */}
      <div className="flex flex-col">
        <button
          className="border-b-border-subtle border-b-hairline flex w-full shrink-0 items-center justify-between px-4 py-3 text-left"
          onClick={() => setWorldsOpen((o) => !o)}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.025)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          <span className="text-text-faint font-mono text-xs">
            worlds{worlds.length > 0 ? ` (${worlds.length})` : ''}
          </span>
          <span
            className={`text-text-faint inline-block font-mono text-xs transition-transform duration-200 ${worldsOpen ? 'rotate-180' : 'rotate-0'}`}
          >
            ▾
          </span>
        </button>

        <div
          className="overflow-hidden"
          // Max-height (not grid-template-rows: 0fr) collapse: some WebKit WebViews (Wails on Linux/macOS)
          // leave a residual sliver visible when a `0fr` grid track collapses instead of reaching true 0.
          // eslint-disable-next-line no-restricted-syntax -- dynamic collapse height driven by `worldsOpen`
          style={{
            maxHeight: worldsOpen ? '2000px' : '0px',
            transition: 'max-height 200ms ease',
          }}
        >
          <div className="flex min-h-0 flex-col overflow-hidden">
            {worlds.length === 0 ? (
              <div className="text-text-faint px-4 py-3 font-mono text-xs">
                No world data found in this backup.
              </div>
            ) : (
              worlds.map((world) => (
                <WorldRow
                  key={world.name}
                  world={world}
                  expanded={expandedWorlds.has(world.name)}
                  onToggle={() => toggleWorld(world.name)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WorldRow({
  world,
  expanded,
  onToggle,
}: {
  world: WorldSystem
  expanded: boolean
  onToggle: () => void
}) {
  const displayName = world.meta?.found && world.meta.levelName ? world.meta.levelName : world.name

  return (
    <div className="border-b-border-subtle border-b-hairline">
      <button
        className="flex w-full items-center justify-between px-4 py-2 text-left"
        onClick={onToggle}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.025)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        }}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-text-secondary truncate font-mono text-xs">{displayName}</span>
          {world.active && <span className="font-mono text-xs text-green-500">active</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-text-faint font-mono text-xs">{fmtBytes(world.totalSize)}</span>
          <span
            className={`text-text-faint inline-block font-mono text-xs transition-transform duration-200 ${expanded ? 'rotate-180' : 'rotate-0'}`}
          >
            ▾
          </span>
        </div>
      </button>

      <div
        className="overflow-hidden"
        // Max-height (not grid-template-rows: 0fr) collapse: some WebKit WebViews (Wails on Linux/macOS)
        // leave a residual sliver visible when a `0fr` grid track collapses instead of reaching true 0.
        // eslint-disable-next-line no-restricted-syntax -- dynamic collapse height driven by `expanded`
        style={{
          maxHeight: expanded ? '600px' : '0px',
          transition: 'max-height 200ms ease',
        }}
      >
        <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden px-5 pt-2 pb-3">
          {world.dimensions && world.dimensions.length > 0 ? (
            world.dimensions.map((dim) => <DimRow key={dim.kind} kind={dim.kind} size={dim.size} />)
          ) : (
            <span className="text-text-faint font-mono text-xs">No dimension data.</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-text-faint shrink-0 font-mono text-xs">{label}</span>
      <span className={`truncate text-right text-xs text-text-secondary${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function DimRow({ kind, size }: { kind: string; size: number }) {
  const color = KIND_COLOR[kind] ?? '#60a5fa'
  return (
    <div className="flex items-center gap-2">
      {/* eslint-disable-next-line no-restricted-syntax -- color keyed by a runtime dimension-kind string, invisible to the Tailwind JIT scanner */}
      <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-text-secondary flex-1 font-mono text-xs">
        {KIND_LABEL[kind] ?? kind}
      </span>
      {size > 0 && <span className="text-text-faint font-mono text-xs">{fmtBytes(size)}</span>}
    </div>
  )
}

function TagPill({ tag }: { tag: string }) {
  return (
    <span className="text-accent border-hairline inline-flex items-center rounded border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-px font-mono text-xs">
      #{tag}
    </span>
  )
}
