export type FieldType =
  'boolean' | 'number' | 'string' | 'text' | 'enum' | 'list' | 'section' | 'motd'

export interface ConfigField {
  path: (string | number)[]
  label: string
  description?: string
  type: FieldType
  value: unknown
  options?: string[]
  min?: number
  max?: number
  children?: ConfigField[]
}

export function inferType(value: unknown): FieldType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'list'
  if (value !== null && typeof value === 'object') return 'section'
  const str = String(value ?? '')
  if (str.length > 120 || str.includes('\n')) return 'text'
  return 'string'
}

export function labelFromKey(key: string): string {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
