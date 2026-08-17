import { useCallback, useEffect, useRef, useState } from 'react'
import { ReadConfigFile, WriteConfigFile } from '../../../wailsjs/go/main/App'
import { PROPERTIES_SCHEMA } from './form/propertiesSchema'
import { applyPropertyEdit } from './form/parseProperties'
import type { FieldType } from './form/inferType'

// Flat list of keys in relevance order — identity first, power-user settings last
const ORDERED_KEYS: string[] = [
  // Server identity
  'motd',
  'server-port',
  'max-players',
  // Access
  'online-mode',
  'white-list',
  'enforce-whitelist',
  'pvp',
  // Gameplay
  'gamemode',
  'difficulty',
  'hardcore',
  'allow-flight',
  'allow-nether',
  'enable-command-block',
  'spawn-animals',
  'spawn-monsters',
  'spawn-npcs',
  'spawn-protection',
  // World
  'level-name',
  'view-distance',
  'simulation-distance',
  'level-type',
  'level-seed',
  'max-world-size',
  // Performance
  'max-tick-time',
  'network-compression-threshold',
  'rate-limit',
  'pause-when-empty-seconds',
  // Network & security
  'player-idle-timeout',
  'prevent-proxy-connections',
  'enforce-secure-profile',
  'hide-online-players',
  'log-ips',
  // RCON & Query
  'enable-rcon',
  'rcon.port',
  'rcon.password',
  'broadcast-rcon-to-ops',
  'enable-query',
  'query.port',
  // Resource pack
  'resource-pack',
  'require-resource-pack',
  'resource-pack-prompt',
]

interface Props {
  serverId: string
}

function parseRawProps(raw: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('!')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return map
}

function stripCodes(raw: string): string {
  return raw
    .split('\\n')[0]
    .replace(/§[0-9a-fklmnor]/gi, '')
    .trim()
}

function displayValue(key: string, rawVal: string, type: FieldType): string {
  if (key === 'motd') return stripCodes(rawVal) || rawVal
  if (type === 'boolean') return rawVal === 'true' ? 'On' : 'Off'
  return rawVal
}

function valueColorClass(type: FieldType, rawVal: string): string {
  if (type === 'boolean') return rawVal === 'true' ? 'text-accent' : 'text-text-muted'
  return 'text-text-primary'
}

interface RowProps {
  propKey: string
  label: string
  type: FieldType
  rawVal: string
  options?: string[]
  editing: boolean
  editValue: string
  saving: boolean
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onToggle: () => void
  onCycle: () => void
}

function PropRow({
  propKey,
  label,
  type,
  rawVal,
  options,
  editing,
  editValue,
  saving,
  onStartEdit,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onToggle,
  onCycle,
}: RowProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // prevent blur from committing when pressing Escape
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (editing) {
      cancelledRef.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const isInteractive = type === 'boolean' || (type === 'enum' && options && options.length > 0)
  const disp = displayValue(propKey, rawVal, type)
  const colorClass = valueColorClass(type, rawVal)

  return (
    <div className="border-border-subtle border-b-hairline flex items-center gap-2 py-1">
      <span className="text-text-muted min-w-0 flex-1 truncate text-xs" title={label}>
        {label}
      </span>

      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onEditCommit()
            }
            if (e.key === 'Escape') {
              cancelledRef.current = true
              onEditCancel()
            }
          }}
          onBlur={() => {
            if (!cancelledRef.current) onEditCommit()
          }}
          className="bg-canvas border-accent text-text-primary w-28 min-w-0 shrink-0 rounded border px-1 text-right font-mono text-xs outline-none"
        />
      ) : (
        <span
          className={`max-w-[55%] shrink-0 truncate text-right font-mono text-xs font-medium transition-opacity ${colorClass} ${
            saving ? 'opacity-40' : 'opacity-100'
          } ${isInteractive ? 'cursor-pointer' : 'cursor-default'}`}
          title={isInteractive ? undefined : 'Double-click to edit'}
          onClick={
            type === 'boolean' ? onToggle : type === 'enum' && options?.length ? onCycle : undefined
          }
          onDoubleClick={!isInteractive ? onStartEdit : undefined}
        >
          {disp || <span className="text-text-faint">—</span>}
        </span>
      )}
    </div>
  )
}

export function ConfigSummary({ serverId }: Props) {
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const load = useCallback(async () => {
    try {
      const raw = await ReadConfigFile(serverId, 'server.properties')
      setRawContent(raw)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [serverId])

  useEffect(() => {
    load()
  }, [load])

  async function commit(key: string, rawStringValue: string) {
    if (!rawContent) return
    const newContent = applyPropertyEdit(rawContent, key, rawStringValue)
    setRawContent(newContent)
    setSaving(true)
    try {
      await WriteConfigFile(serverId, 'server.properties', newContent)
    } catch (e) {
      setError(String(e))
      load()
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
        <span className="text-text-faint text-center font-mono text-xs">
          Could not read server.properties
        </span>
        <button
          onClick={load}
          className="border-border-subtle text-text-muted rounded border px-2 py-0.5 font-mono text-[10px]"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!rawContent) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-text-faint font-mono text-xs">Loading…</span>
      </div>
    )
  }

  const props = parseRawProps(rawContent)

  // Only show keys that exist in the file (don't pollute with all possible keys)
  const rows = ORDERED_KEYS.filter((k) => k in props)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-1.5 pr-5 pl-3">
        {rows.map((key) => {
          const schema = PROPERTIES_SCHEMA[key]
          const type: FieldType = schema?.type === 'motd' ? 'string' : (schema?.type ?? 'string')
          const label = schema?.label ?? key
          const options = schema?.options
          const rawVal = props[key] ?? ''

          return (
            <PropRow
              key={key}
              propKey={key}
              label={label}
              type={type}
              rawVal={rawVal}
              options={options}
              editing={editingKey === key}
              editValue={editValue}
              saving={saving}
              onStartEdit={() => {
                setEditingKey(key)
                setEditValue(rawVal)
              }}
              onEditChange={setEditValue}
              onEditCommit={() => {
                commit(key, editValue)
                setEditingKey(null)
              }}
              onEditCancel={() => setEditingKey(null)}
              onToggle={() => commit(key, rawVal === 'true' ? 'false' : 'true')}
              onCycle={() => {
                if (!options) return
                const idx = options.indexOf(rawVal)
                commit(key, options[(idx + 1) % options.length])
              }}
            />
          )
        })}
      </div>

      <div className="border-border-subtle border-t-hairline flex shrink-0 items-center justify-start px-3 py-1">
        <button
          onClick={load}
          className="text-text-faint font-mono text-[10px] transition-colors"
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'
          }}
          title="Reload from disk"
        >
          ↻
        </button>
      </div>
    </div>
  )
}
