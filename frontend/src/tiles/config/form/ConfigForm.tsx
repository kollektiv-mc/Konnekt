import { useState } from 'react'
import type { ConfigField } from './inferType'
import { parsePropertiesFields, applyPropertyEdit } from './parseProperties'
import { parseYamlFields, applyYamlEdit } from './parseYaml'
import { parseJsonFields, applyJsonEdit } from './parseJson'
import { parseTomlFields, applyTomlEdit } from './parseToml'
import { Toggle, NumberInput, TextInput, TextArea, Select, ChipList, MotdWidget } from './widgets'
import { Collapsible } from '../../../components/ui/Collapsible'

interface Props {
  format: string
  content: string
  onChange: (newContent: string) => void
}

function Field({
  field,
  onEdit,
}: {
  field: ConfigField
  onEdit: (path: (string | number)[], value: unknown) => void
}) {
  const [open, setOpen] = useState(true)

  if (field.type === 'section') {
    return (
      <div className="mb-1">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 py-2 text-left"
        >
          <span
            className={`text-text-muted duration-fast ease-standard text-2xs transition-transform ${open ? 'rotate-90' : 'rotate-0'}`}
          >
            ▶
          </span>
          <span className="text-text-muted text-xs font-semibold tracking-widest uppercase">
            {field.label}
          </span>
        </button>

        <Collapsible open={open} className="pl-2">
          {field.children?.map((child, i) => (
            <Field key={i} field={child} onEdit={onEdit} />
          ))}
        </Collapsible>
      </div>
    )
  }

  function edit(value: unknown) {
    onEdit(field.path, value)
  }

  if (field.type === 'boolean') return <Toggle field={field} onChange={edit} />
  if (field.type === 'number') return <NumberInput field={field} onChange={(v) => edit(v)} />
  if (field.type === 'enum') return <Select field={field} onChange={edit} />
  if (field.type === 'list') return <ChipList field={field} onChange={edit} />
  if (field.type === 'text') return <TextArea field={field} onChange={edit} />
  if (field.type === 'motd') return <MotdWidget field={field} onChange={(v) => edit(v)} />
  return <TextInput field={field} onChange={edit} />
}

export function ConfigForm({ format, content, onChange }: Props) {
  const isProperties = format === 'properties'

  let fields: ConfigField[] = []
  try {
    if (isProperties) fields = parsePropertiesFields(content)
    else if (format === 'yaml') fields = parseYamlFields(content)
    else if (format === 'json') fields = parseJsonFields(content)
    else if (format === 'toml') fields = parseTomlFields(content)
  } catch {
    // leave fields empty; form shows "No fields detected"
  }

  function handleEdit(path: (string | number)[], value: unknown) {
    try {
      let newContent: string
      if (isProperties) {
        newContent = applyPropertyEdit(content, String(path[0]), value)
      } else if (format === 'yaml') {
        newContent = applyYamlEdit(content, path, value)
      } else if (format === 'json') {
        newContent = applyJsonEdit(content, path, value)
      } else if (format === 'toml') {
        newContent = applyTomlEdit(content, path, value)
      } else {
        return
      }
      onChange(newContent)
    } catch (e) {
      console.error('Config edit failed', e)
    }
  }

  if (fields.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-text-faint font-mono text-xs">No fields detected</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-2">
      {fields.map((f, i) => (
        <Field key={i} field={f} onEdit={handleEdit} />
      ))}
    </div>
  )
}
