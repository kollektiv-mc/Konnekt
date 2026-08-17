import { truncateStart } from '../lib/format'
import type { ServerSummary } from '../types'

const LOADER_LABELS: Record<string, string> = {
  neoforge: 'NeoForge',
  forge: 'Forge',
  fabric: 'Fabric',
  quilt: 'Quilt',
  paper: 'Paper',
  spigot: 'Spigot',
  bukkit: 'Bukkit',
  purpur: 'Purpur',
  velocity: 'Velocity',
  vanilla: 'Vanilla',
}

const PATH_MAX_CHARS = 34

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-text-faint text-3xs shrink-0 tracking-wider uppercase">{label}</span>
      <span className="text-text-secondary text-2xs truncate font-mono">{children}</span>
    </div>
  )
}

interface Props {
  summary: ServerSummary | null
  /** Viewport coordinates of the hovered row, from getBoundingClientRect(). */
  anchor: { top: number; left: number }
}

/**
 * Hover card for a sidebar server row. Fixed-positioned because the sidebar is
 * only 12rem wide and clips its own overflow — the card has to escape it.
 */
export function ServerTooltip({ summary, anchor }: Props) {
  if (!summary) return null

  const loader = LOADER_LABELS[summary.loader] ?? (summary.loader || 'Unknown')

  return (
    <div
      className="border-border-subtle bg-elevated border-hairline pointer-events-none fixed z-[300] flex w-60 flex-col gap-1.5 rounded-lg px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md"
      // eslint-disable-next-line no-restricted-syntax -- anchored to the hovered row's measured viewport position
      style={{ top: anchor.top, left: anchor.left }}
      role="tooltip"
    >
      <Row label="Version">{summary.mcVersion || '—'}</Row>
      <Row label="Type">{loader}</Row>
      <Row label="Path">{truncateStart(summary.workingDir, PATH_MAX_CHARS) || '—'}</Row>
      <Row label="Launch">{summary.launchFile || '—'}</Row>
      <div className="border-border-subtle border-t-hairline flex items-center gap-1.5 pt-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${summary.running ? 'bg-accent' : 'bg-text-faint'}`}
        />
        <span className={`text-2xs ${summary.running ? 'text-accent' : 'text-text-muted'}`}>
          {summary.running ? 'Running' : 'Stopped'}
        </span>
      </div>
    </div>
  )
}
