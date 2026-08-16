import { parse } from 'smol-toml'
import type { ConfigField } from './inferType'
import { inferType, labelFromKey } from './inferType'

/** Returns true if the TOML file is safe to edit in form view. */
export function tomlIsFormSafe(content: string): boolean {
  try {
    parse(content)
    // Reject files with array-of-tables — multiline value splicing gets complex
    if (/^\[\[/m.test(content)) return false
    // Reject multiline basic/literal strings
    if (/"""|'''/.test(content)) return false
    return true
  } catch {
    return false
  }
}

function tomlValueToField(key: string, value: unknown, path: (string | number)[]): ConfigField {
  const label = labelFromKey(key)

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const children: ConfigField[] = Object.entries(obj).map(([k, v]) =>
      tomlValueToField(k, v, [...path, k]),
    )
    return { path, label, type: 'section', value: null, children }
  }

  if (Array.isArray(value)) {
    // Flat arrays of primitives → chip list; arrays of objects → raw textarea
    if (value.length > 0 && typeof value[0] === 'object') {
      return { path, label, type: 'text', value: JSON.stringify(value, null, 2) }
    }
    return { path, label, type: 'list', value: value as (string | number)[] }
  }

  // TOML Date objects stringify nicely
  if (value instanceof Date) {
    return { path, label, type: 'string', value: value.toISOString() }
  }

  const type = inferType(value)
  return { path, label, type, value }
}

export function parseTomlFields(content: string): ConfigField[] {
  const obj = parse(content) as Record<string, unknown>
  return Object.entries(obj).map(([k, v]) => tomlValueToField(k, v, [k]))
}

/** Serialize a value back to its TOML literal representation. */
function toTomlLiteral(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    const items = value.map((v) =>
      typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : String(v),
    )
    return `[${items.join(', ')}]`
  }
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return String(value)
}

/**
 * Surgically replace a single key's value in TOML source.
 * Path is ['TableName', 'key'] for a keyed table, or ['key'] for root-level.
 * Comment lines and other keys are untouched.
 */
export function applyTomlEdit(content: string, path: (string | number)[], value: unknown): string {
  const lines = content.split('\n')
  const result = [...lines]

  const sectionPath = path.slice(0, -1) as string[]
  const key = String(path[path.length - 1])
  const literal = toTomlLiteral(value)

  // Find the right section first (if nested)
  let sectionStart = 0
  if (sectionPath.length > 0) {
    const sectionHeader = sectionPath.join('.')
    // Match [Header] or [Header.SubHeader] etc.
    const headerRe = new RegExp(`^\\[${escapeRegex(sectionHeader)}\\]`)
    const idx = lines.findIndex((l) => headerRe.test(l.trim()))
    if (idx === -1) return content // section not found — bail
    sectionStart = idx + 1
  }

  // Find key within section, stopping at next section header
  const keyRe = new RegExp(`^(${escapeRegex(key)})(\\s*=\\s*)`)
  for (let i = sectionStart; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (i > sectionStart && /^\[/.test(trimmed)) break // crossed into next section
    const m = lines[i].match(keyRe)
    if (m) {
      // Preserve inline comments after the value
      const rest = lines[i].slice(m[0].length)
      const commentIdx = findInlineComment(rest)
      const trailingComment = commentIdx !== -1 ? ' ' + rest.slice(commentIdx) : ''
      result[i] = `${m[1]}${m[2]}${literal}${trailingComment}`
      break
    }
  }

  return result.join('\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Find the start of an inline TOML comment (`# ...`) that isn't inside a string. */
function findInlineComment(s: string): number {
  let inStr = false
  let strChar = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === strChar) inStr = false
    } else {
      if (c === '"' || c === "'") {
        inStr = true
        strChar = c
        continue
      }
      if (c === '#') return i
    }
  }
  return -1
}
