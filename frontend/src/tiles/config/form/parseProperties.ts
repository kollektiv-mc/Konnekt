import type { ConfigField } from './inferType'
import { inferType, labelFromKey } from './inferType'
import { PROPERTIES_SCHEMA, SECTION_ORDER } from './propertiesSchema'

interface ParsedEntry {
  key: string
  value: string
  lineIndex: number
}

function parseEntries(content: string): ParsedEntry[] {
  const lines = content.split('\n')
  const entries: ParsedEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1)
    entries.push({ key, value, lineIndex: i })
  }
  return entries
}

export function parsePropertiesFields(content: string): ConfigField[] {
  const entries = parseEntries(content)

  const sectionMap = new Map<string, ConfigField>()

  for (const { key, value } of entries) {
    const schema = PROPERTIES_SCHEMA[key]
    const sectionName = schema?.section ?? 'Other'

    let section = sectionMap.get(sectionName)
    if (!section) {
      section = {
        path: [sectionName],
        label: sectionName,
        type: 'section',
        value: null,
        children: [],
      }
      sectionMap.set(sectionName, section)
    }

    let typedValue: unknown = value
    const type = schema?.type ?? inferType(value)

    if (type === 'boolean') {
      typedValue = value.trim() === 'true'
    } else if (type === 'number') {
      const n = Number(value.trim())
      typedValue = Number.isNaN(n) ? value : n
    }

    section.children!.push({
      path: [key],
      label: schema?.label ?? labelFromKey(key),
      description: schema?.description,
      type,
      value: typedValue,
      options: schema?.options,
      min: schema?.min,
      max: schema?.max,
    })
  }

  // Sort sections by canonical order
  const ordered: ConfigField[] = []
  for (const name of SECTION_ORDER) {
    const s = sectionMap.get(name)
    if (s) ordered.push(s)
    sectionMap.delete(name)
  }
  // Append any remaining unordered sections
  for (const s of sectionMap.values()) ordered.push(s)

  return ordered
}

/** Surgically update a single key in server.properties content, preserving all other lines. */
export function applyPropertyEdit(content: string, key: string, value: unknown): string {
  const lines = content.split('\n')
  const strVal = String(value)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('#') || trimmed.startsWith('!') || !trimmed.includes('=')) continue
    const eqIdx = trimmed.indexOf('=')
    const lineKey = trimmed.slice(0, eqIdx).trim()
    if (lineKey === key) {
      // Preserve leading whitespace if any
      const indent = line.length - line.trimStart().length
      lines[i] = line.slice(0, indent) + key + '=' + strVal
      return lines.join('\n')
    }
  }

  // Key not found — append
  return content.trimEnd() + '\n' + key + '=' + strVal + '\n'
}
