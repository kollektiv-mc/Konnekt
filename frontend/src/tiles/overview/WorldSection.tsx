import { Earth } from '../../lib/icons'
import { fmtBytes, relativeMs } from '../../lib/format'
import { useWorlds } from '../worlds/useWorlds'
import { Section, SectionEmpty } from './Section'

/**
 * The world the server is actually running, and how big it has got.
 *
 * `useWorlds` rather than the worlds tile's compact list: this block names one
 * world, not all of them. Nothing here reaches `scene/WorldsScene`, so the
 * panel never pulls three.js.
 */
export function WorldSection() {
  const { worlds, loading, error } = useWorlds()
  const active = worlds.find((w) => w.active)

  return (
    <Section tileId="worlds" icon={Earth} label="Active world">
      {!active ? (
        <SectionEmpty>
          {loading ? 'loading…' : error ? 'worlds unavailable' : 'no active world'}
        </SectionEmpty>
      ) : (
        <div className="flex h-full flex-col justify-center gap-1 px-3 py-2">
          <div className="text-text-primary truncate font-mono text-sm" title={active.name}>
            {active.name}
          </div>
          <div className="text-accent font-mono text-lg">{fmtBytes(active.totalSize)}</div>
          <div className="text-text-faint truncate font-mono text-xs">
            {[
              active.meta?.found ? active.meta.difficulty : null,
              active.meta?.found ? active.meta.version : null,
              active.modified ? relativeMs(active.modified) : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
        </div>
      )}
    </Section>
  )
}
