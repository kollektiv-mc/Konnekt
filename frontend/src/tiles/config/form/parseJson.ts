import type { ConfigField } from './inferType'
import { inferType, labelFromKey } from './inferType'

function valueToField(key: string, value: unknown, path: (string | number)[]): ConfigField {
  const label = labelFromKey(key)

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const children: ConfigField[] = Object.entries(obj).map(([k, v]) =>
      valueToField(k, v, [...path, k]),
    )
    return { path, label, type: 'section', value: null, children }
  }

  if (Array.isArray(value)) {
    // Arrays of objects (e.g. array-of-tables) stay as raw — too complex for a chip list
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return { path, label, type: 'text', value: JSON.stringify(value, null, 2) }
    }
    return { path, label, type: 'list', value: value as (string | number)[] }
  }

  const type = inferType(value)
  return { path, label, type, value }
}

export function parseJsonFields(content: string): ConfigField[] {
  const obj = JSON.parse(content) as unknown
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj as Record<string, unknown>).map(([k, v]) => valueToField(k, v, [k]))
}

/** Surgically replace the value at `path` inside the JSON string, preserving formatting. */
export function applyJsonEdit(content: string, path: (string | number)[], value: unknown): string {
  const obj = JSON.parse(content) as Record<string, unknown>
  let cursor: Record<string, unknown> | unknown[] = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (Array.isArray(cursor)) {
      cursor = (cursor as unknown[])[key as number] as Record<string, unknown>
    } else {
      cursor = (cursor as Record<string, unknown>)[key as string] as Record<string, unknown>
    }
  }
  const last = path[path.length - 1]
  if (Array.isArray(cursor)) {
    ;(cursor as unknown[])[last as number] = value
  } else {
    ;(cursor as Record<string, unknown>)[last as string] = value
  }
  // Detect original indentation (2 or 4 spaces, or tab)
  const indentMatch = content.match(/^{\n([ \t]+)/m)
  const indent = indentMatch ? indentMatch[1] : '  '
  return JSON.stringify(obj, null, indent)
}
