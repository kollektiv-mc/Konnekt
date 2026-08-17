import { useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'
import type { NodeData } from './graphMapping'

interface Props {
  nodeId: string
  data: NodeData
  def: models.BlockDef | undefined
  edges: Edge[]
  onChange: (key: string, value: unknown) => void
}

export function NodeConfigPanel({ nodeId, data, def, edges, onChange }: Props) {
  // Keys that are wired via a data edge — shown as read-only.
  const wiredKeys = useMemo(() => {
    return new Set(
      edges
        .filter((e) => e.target === nodeId && (e.data as { kind?: string })?.kind === 'data')
        .map((e) => (e.targetHandle ?? '').replace('data:', '')),
    )
  }, [edges, nodeId])

  if (!def) {
    return (
      <div className="p-3">
        <span className="text-text-faint font-mono text-xs">unknown block type</span>
      </div>
    )
  }

  const fields = (def.configSchema ?? []).filter((f) => f.key !== '_collapsed')

  if (fields.length === 0) {
    return (
      <div className="p-3">
        <div className="text-text-primary mb-2 font-mono text-xs font-semibold">{def.label}</div>
        <span className="text-text-faint font-mono text-xs">{def.description}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-text-primary font-mono text-xs font-semibold">{def.label}</div>
      <div className="text-text-muted text-xs">{def.description}</div>

      {fields.map((field) => {
        const val = data.config?.[field.key] ?? field.default ?? ''
        const isWired = wiredKeys.has(field.key)

        return (
          <div key={field.key} className="flex flex-col gap-0.5">
            <label className="text-text-muted flex items-center gap-1 font-mono text-xs">
              {field.label}
              {field.required && <span className="text-[#ef4444]">*</span>}
              {isWired && (
                <span className="ml-1 rounded bg-[#1e3a5f] px-1 text-[9px] text-[#60a5fa]">
                  wired
                </span>
              )}
            </label>

            {isWired ? (
              <div className="bg-canvas border-hairline min-h-[26px] rounded border-[#1e3a5f] px-2 py-1 font-mono text-xs text-[#60a5fa]">
                ← data edge
              </div>
            ) : field.type === 'bool' ? (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(val)}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="accent-accent"
                />
                <span className="text-text-muted font-mono text-xs">{val ? 'true' : 'false'}</span>
              </label>
            ) : field.type === 'select' ? (
              <select
                value={String(val)}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="bg-canvas border-border-subtle text-text-primary border-hairline rounded px-2 py-1 font-mono text-xs outline-none"
              >
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'attribute' ? (
              <>
                <input
                  type="text"
                  list={`attrs-${nodeId}-${field.key}`}
                  value={String(val)}
                  placeholder="@server.motd or @myValue"
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="bg-surface border-border-subtle text-text-primary border-hairline rounded px-2 py-1 font-mono text-xs outline-none"
                />
                <datalist id={`attrs-${nodeId}-${field.key}`}>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </datalist>
                <span className="text-text-faint text-[9px]">
                  Type a built-in or custom attribute name.
                </span>
              </>
            ) : field.type === 'number' ? (
              <input
                type="number"
                value={val === '' ? '' : Number(val)}
                onChange={(e) =>
                  onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))
                }
                className="bg-surface border-border-subtle text-text-primary border-hairline rounded px-2 py-1 font-mono text-xs outline-none"
              />
            ) : field.type === 'command' ? (
              <textarea
                value={String(val)}
                onChange={(e) => onChange(field.key, e.target.value)}
                rows={2}
                className="bg-surface border-border-subtle text-text-primary border-hairline resize-none rounded px-2 py-1 font-mono text-xs outline-none"
              />
            ) : (
              <input
                type="text"
                value={String(val)}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="bg-surface border-border-subtle text-text-primary border-hairline rounded px-2 py-1 font-mono text-xs outline-none"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
