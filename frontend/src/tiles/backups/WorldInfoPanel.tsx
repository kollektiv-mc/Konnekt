import { useState, useEffect } from 'react'
import type { WorldSystem } from './useBackupWorlds'
import { fmtBytes, fmtDate } from './format'
import { IconButton } from '../../components/ui/IconButton'
import { X } from '../../lib/icons'
import { Icon } from '../../components/ui/Icon'

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

interface WorldInfoPanelProps {
  world: WorldSystem
  onClose: () => void
}

export function WorldInfoPanel({ world, onClose }: WorldInfoPanelProps) {
  const [visible, setVisible] = useState(false)

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

  const meta = world.meta
  const hasMeta = meta?.found

  const overworld = (world.dimensions ?? []).find((d) => d.kind === 'overworld')
  const otherDims = (world.dimensions ?? []).filter((d) => d.kind !== 'overworld')

  const displayName = hasMeta && meta.levelName ? meta.levelName : world.name
  const showFolder = hasMeta && meta.levelName && meta.levelName !== world.name

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
          <span className="text-text-primary truncate font-mono text-sm">{displayName}</span>
          {showFolder && (
            <span className="text-text-faint truncate font-mono text-xs">/{world.name}</span>
          )}
          {(world.active || (hasMeta && meta.hardcore)) && (
            <div className="flex items-center gap-1.5">
              {world.active && <Badge label="active" color="#22c55e" />}
              {hasMeta && meta.hardcore && <Badge label="hardcore" color="#ef4444" />}
            </div>
          )}
        </div>
        <IconButton onClick={onClose} title="Close" className="mt-0.5">
          <Icon icon={X} />
        </IconButton>
      </div>

      {/* Meta rows */}
      {hasMeta && (
        <div className="border-b-border-subtle border-b-hairline flex shrink-0 flex-col px-4 py-3">
          {meta.gameMode && <Row label="mode" value={capitalize(meta.gameMode)} />}
          {meta.difficulty && <Row label="difficulty" value={capitalize(meta.difficulty)} />}
          {meta.version && <Row label="version" value={meta.version} />}
          {meta.seed && <Row label="seed" value={meta.seed} mono />}
          <Row label="spawn" value={`${meta.spawnX}, ${meta.spawnY}, ${meta.spawnZ}`} mono />
          {meta.lastPlayed > 0 && <Row label="last played" value={fmtDate(meta.lastPlayed)} />}
        </div>
      )}

      {/* Size */}
      <div className="border-b-border-subtle border-b-hairline shrink-0 px-4 py-3">
        <Row label="total size" value={fmtBytes(world.totalSize)} />
      </div>

      {/* Dimensions */}
      <div className="flex flex-col gap-2 px-4 py-3">
        <span className="text-text-faint font-mono text-xs">dimensions</span>
        {overworld && <DimRow kind="overworld" size={overworld.size} />}
        {otherDims.map((dim) => (
          <DimRow key={dim.kind} kind={dim.kind} size={dim.size} />
        ))}
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

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="rounded px-1.5 py-px font-mono text-xs"
      // eslint-disable-next-line no-restricted-syntax -- `color` is an arbitrary runtime prop, invisible to the Tailwind JIT scanner
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `0.5px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
