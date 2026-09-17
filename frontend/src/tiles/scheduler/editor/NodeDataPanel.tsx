import { useEffect, useState } from 'react'
import type { models } from '../../../../wailsjs/go/models'
import { CUSTOM_ATTR_TEXT_CLASS } from './blockMeta'

interface Props {
  graph: models.Graph
  nodeId: string
  onPreview: (graph: models.Graph, nodeId: string) => Promise<models.NodePreview>
}

// Live dry-run "spreadsheet": attributes the node references/defines with their
// current values, plus a console line for what the block would do. No side effects.
export function NodeDataPanel({ graph, nodeId, onPreview }: Props) {
  const [preview, setPreview] = useState<models.NodePreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    onPreview(graph, nodeId)
      .then((p) => {
        if (!cancelled) setPreview(p)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [graph, nodeId, onPreview])

  const labelClass = 'text-text-faint font-mono text-3xs uppercase tracking-wider'

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-text-primary font-mono text-xs font-semibold">Data preview</div>

      {error && <div className="text-danger font-mono text-xs">{error}</div>}

      {/* Attribute table */}
      <div className="flex flex-col gap-1">
        <span className={labelClass}>attributes</span>
        {preview && preview.attributes && preview.attributes.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {preview.attributes.map((a) => (
              <div
                key={a.name}
                className="bg-surface border-border-subtle border-hairline flex items-center justify-between gap-2 rounded px-2 py-1"
              >
                <span
                  className={`font-mono text-xs ${a.writable ? 'text-text-primary' : 'text-text-muted'}`}
                >
                  @{a.name}
                  {!a.writable && a.type !== 'custom' && (
                    <span className="text-text-faint text-3xs ml-1">(read-only)</span>
                  )}
                  {a.type === 'custom' && (
                    <span className={`text-3xs ml-1 ${CUSTOM_ATTR_TEXT_CLASS}`}>(custom)</span>
                  )}
                </span>
                <span className={`font-mono text-xs ${a.error ? 'text-danger' : 'text-accent'}`}>
                  {a.error ? a.error : a.value === '' ? '—' : a.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-text-faint font-mono text-xs">no attributes referenced</span>
        )}
      </div>

      {/* Console */}
      <div className="flex flex-col gap-1">
        <span className={labelClass}>console</span>
        <div className="bg-canvas border-border-subtle border-hairline flex min-h-[26px] flex-col gap-0.5 rounded px-2 py-1 font-mono text-xs">
          {preview && preview.console && preview.console.length > 0 ? (
            preview.console.map((line, i) => {
              const isError = line.startsWith('ERROR') || line.startsWith('would fail')
              return (
                <span key={i} className={isError ? 'text-danger' : 'text-text-secondary'}>
                  {line}
                </span>
              )
            })
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </div>
      </div>
    </div>
  )
}
