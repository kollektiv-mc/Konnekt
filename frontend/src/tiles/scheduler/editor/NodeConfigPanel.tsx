import { useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'
import type { NodeData } from './graphMapping'
import { Combobox } from '../../../components/ui/Combobox'
import { WIRED_BG_CLASS, WIRED_BORDER_CLASS, WIRED_TEXT_CLASS } from './blockMeta'

interface Props {
  nodeId: string
  data: NodeData
  def: models.BlockDef | undefined
  edges: Edge[]
  onChange: (key: string, value: unknown) => void
}

/**
 * The one class string every field control wears, so six branches cannot drift
 * into six near-identical variants of it (#163). Anything a single field type
 * genuinely needs on top is appended at that branch.
 */
const FIELD_CLASS =
  'bg-surface border-border-subtle text-text-primary border-hairline w-full rounded px-2 py-1 font-mono text-xs transition-colors outline-none'

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
        const options = (field.options ?? []).map((o) => ({ value: o.value, label: o.label }))

        return (
          <div key={field.key} className="flex flex-col gap-0.5">
            <label className="text-text-muted flex items-center gap-1 font-mono text-xs">
              {field.label}
              {field.required && <span className="text-danger">*</span>}
              {isWired && (
                <span
                  className={`text-3xs ml-1 rounded px-1 ${WIRED_BG_CLASS} ${WIRED_TEXT_CLASS}`}
                >
                  wired
                </span>
              )}
            </label>

            {isWired ? (
              <div
                className={`bg-canvas border-hairline min-h-[26px] rounded px-2 py-1 font-mono text-xs ${WIRED_BORDER_CLASS} ${WIRED_TEXT_CLASS}`}
              >
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
              <Combobox
                value={String(val)}
                onChange={(v) => onChange(field.key, v)}
                options={options}
                ariaLabel={field.label}
              />
            ) : field.type === 'attribute' ? (
              <>
                <Combobox
                  value={String(val)}
                  onChange={(v) => onChange(field.key, v)}
                  options={options}
                  ariaLabel={field.label}
                  freeText
                />
                <span className="text-text-faint text-3xs">
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
                className={FIELD_CLASS}
              />
            ) : field.type === 'command' ? (
              <>
                <Combobox
                  value={String(val)}
                  onChange={(v) => onChange(field.key, v)}
                  options={options}
                  ariaLabel={field.label}
                  freeText
                  showOptionLabel
                />
                <span className="text-text-faint text-3xs">
                  Pick a preset or type a command. The preset is the command.
                </span>
              </>
            ) : (
              <input
                type="text"
                value={String(val)}
                onChange={(e) => onChange(field.key, e.target.value)}
                className={FIELD_CLASS}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
