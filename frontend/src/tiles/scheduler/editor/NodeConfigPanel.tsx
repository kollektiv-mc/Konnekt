import { useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import type { models } from '../../../../wailsjs/go/models'
import type { NodeData } from './graphMapping'
import { Combobox } from '../../../components/ui/Combobox'
import { DestinationField } from './DestinationField'
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
 *
 * It carries the hover and focus border the rest of the app's fields have and
 * this one did not, which is what the transition-colors was always for: the
 * panel declared the transition without ever having a state to transition.
 *
 * The background stays bg-surface rather than moving to the bg-hover most of
 * the app's dialogs use. That difference is real but it is not the scheduler's
 * alone: Combobox is shared with the server edit form, whose own fields are
 * bg-surface, so changing it here would fix one form by splitting another.
 * Recorded in the checklist's open backlog instead.
 */
const FIELD_CLASS =
  'bg-surface border-border-subtle text-text-primary hover:border-border-hover focus:border-border-hover border-hairline w-full rounded px-2 py-1 font-mono text-xs transition-colors outline-none'

/**
 * Whether a field is drawn. A field with `showWhen` follows the field it names:
 * that field's stored value, or its default where nothing is stored yet, must be
 * one of the listed values. A hidden field is only not drawn, so the value it
 * holds stays in the node's config.
 */
function isShown(
  field: models.ConfigField,
  schema: models.ConfigField[],
  config: Record<string, unknown> | undefined,
): boolean {
  const when = field.showWhen
  if (!when) return true
  const controller = schema.find((f) => f.key === when.key)
  const current = config?.[when.key] ?? controller?.default ?? ''
  return when.values.includes(String(current))
}

/**
 * Groups the shown fields into lines. Consecutive fields that share a non-empty
 * `row` go on one line in equal columns; any other field is a line of its own.
 */
function toLines(fields: models.ConfigField[]): models.ConfigField[][] {
  const lines: models.ConfigField[][] = []
  for (const field of fields) {
    const last = lines[lines.length - 1]
    if (field.row && last && last[0].row === field.row) last.push(field)
    else lines.push([field])
  }
  return lines
}

interface FieldControlProps {
  field: models.ConfigField
  val: unknown
  isWired: boolean
  onChange: (key: string, value: unknown) => void
}

/** One config field: its label and the control for its type. */
function FieldControl({ field, val, isWired, onChange }: FieldControlProps) {
  const options = (field.options ?? []).map((o) => ({ value: o.value, label: o.label }))

  // An unwired bool is a checkbox named by its label, with no heading above it.
  if (field.type === 'bool' && !isWired) {
    return (
      <label className="flex min-w-0 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(val)}
          onChange={(e) => onChange(field.key, e.target.checked)}
          className="accent-accent"
        />
        <span className="text-text-muted font-mono text-xs">
          {field.label}
          {field.required && <span className="text-danger">*</span>}
        </span>
      </label>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <label className="text-text-muted flex items-center gap-1 font-mono text-xs">
        {field.label}
        {field.required && <span className="text-danger">*</span>}
        {isWired && (
          <span className={`text-3xs ml-1 rounded px-1 ${WIRED_BG_CLASS} ${WIRED_TEXT_CLASS}`}>
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
      ) : field.type === 'select' ? (
        <Combobox
          value={String(val)}
          onChange={(v) => onChange(field.key, v)}
          options={options}
          ariaLabel={field.label}
        />
      ) : field.type === 'destination' ? (
        <DestinationField
          optional={!field.required}
          value={String(val)}
          onChange={(v) => onChange(field.key, v)}
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
          onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
          className={FIELD_CLASS}
        />
      ) : field.type === 'command' ? (
        <Combobox
          value={String(val)}
          onChange={(v) => onChange(field.key, v)}
          options={options}
          ariaLabel={field.label}
          freeText
          multiline
        />
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
  const shown = fields.filter((f) => isShown(f, fields, data.config))

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

      {toLines(shown).map((line) => (
        <div
          key={line.map((f) => f.key).join('+')}
          data-row={line[0].row || undefined}
          className="grid auto-cols-fr grid-flow-col gap-2"
        >
          {line.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              val={data.config?.[field.key] ?? field.default ?? ''}
              isWired={wiredKeys.has(field.key)}
              onChange={onChange}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
