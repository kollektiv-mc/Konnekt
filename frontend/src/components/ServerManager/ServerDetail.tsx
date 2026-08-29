import { useCallback, useEffect, useState } from 'react'
import { GetServerSummary } from '../../../wailsjs/go/main/App'
import { LOADER_LABELS } from '../../lib/loaders'
import type { ServerConfig, ServerSummary } from '../../types'

/**
 * How the reported loader build was arrived at. A build read out of run.sh is
 * exactly what the next start will use; one carried over from the stored config
 * is the last thing Konnekt knew and can be stale, which is worth saying rather
 * than presenting both as equally current.
 */
const SOURCE_NOTES: Record<string, string> = {
  script: 'from the launcher script',
  libraries: 'found under libraries/',
  config: 'last known, install not readable',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border-subtle border-b-hairline flex items-baseline justify-between gap-4 py-2">
      <span className="text-text-faint text-2xs shrink-0 tracking-wider uppercase">{label}</span>
      <span className="text-text-secondary min-w-0 truncate font-mono text-xs" title={undefined}>
        {children}
      </span>
    </div>
  )
}

interface Props {
  config: ServerConfig
  /** Bumped by the manager after a save, to re-read the summary from disk. */
  refreshKey?: number
}

/**
 * The identity panel: what this server actually is, read from the install
 * directory rather than from the stored config where the two can disagree.
 */
export function ServerDetail({ config, refreshKey = 0 }: Props) {
  const [summary, setSummary] = useState<ServerSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    GetServerSummary(config.id)
      .then((s) => setSummary(s))
      .catch(() => {
        // Reads degrade to defaults rather than surfacing an error: the panel
        // below still renders everything the stored config knows.
        setSummary(null)
      })
      .finally(() => setLoading(false))
  }, [config.id])

  useEffect(load, [load, refreshKey])

  const loader = summary?.loader || config.loader
  const mcVersion = summary?.mcVersion || config.mcVersion
  const loaderVersion = summary?.loaderVersion || config.loaderVersion
  const sourceNote = summary?.loaderSource ? SOURCE_NOTES[summary.loaderSource] : undefined

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            summary?.running ? 'bg-accent' : 'bg-text-faint'
          }`}
        />
        <span className={`text-2xs ${summary?.running ? 'text-accent' : 'text-text-muted'}`}>
          {loading ? 'Reading install…' : summary?.running ? 'Running' : 'Stopped'}
        </span>
      </div>

      <Field label="Minecraft">{mcVersion || '—'}</Field>
      <Field label="Loader">{LOADER_LABELS[loader] ?? (loader || 'Unknown')}</Field>
      <Field label="Build">
        {loaderVersion ? (
          <>
            {loaderVersion}
            {sourceNote && <span className="text-text-faint"> · {sourceNote}</span>}
          </>
        ) : (
          '—'
        )}
      </Field>
      <Field label="Launch">{summary?.launchFile || '—'}</Field>
      <Field label="Path">{summary?.workingDir || config.workingDir || '—'}</Field>
    </div>
  )
}
