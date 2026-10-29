import { useCallback, useEffect, useRef, useState } from 'react'
import { ReadConfigFile, WriteConfigFile } from '../../../wailsjs/go/main/App'
import { PROPERTIES_SCHEMA } from './form/propertiesSchema'
import { applyPropertyEdit } from './form/parseProperties'
import type { FieldType } from './form/inferType'
import { decodeEscapes } from './motd'
import { MotdPreviewLine } from './MotdLine'
import { fitItems, useGridFit } from '../../hooks/useGridFit'
import { IconButton } from '../../components/ui/IconButton'
import { Icon } from '../../components/ui/Icon'
import { RotateCw } from '../../lib/icons'

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

// Shown masked: a glance at the dashboard should not put a password on screen.
const SECRET_KEYS = new Set(['rcon.password'])

function displayValue(key: string, rawVal: string, type: FieldType): string {
  if (type === 'boolean') return rawVal === 'true' ? 'On' : 'Off'
  if (SECRET_KEYS.has(key) && rawVal) return '••••••'
  // The file's escapes (`minecraft\:normal`, `\u00e9`) are how Java stores the
  // value, not what it is.
  return decodeEscapes(rawVal).replace(/\\(.)/g, '$1')
}

function valueColorClass(type: FieldType, rawVal: string): string {
  if (type === 'boolean') return rawVal === 'true' ? 'text-accent' : 'text-text-muted'
  return 'text-text-primary'
}

interface CellProps {
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

/**
 * One setting as label over value, so the two read as a pair at any width.
 * The row it replaced set the label at the left edge and the value at the
 * right, which on a wide tile put the whole tile between them. Every cell is
 * one height, which `useGridFit` counts on.
 */
function PropCell({
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
}: CellProps) {
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
    <li className="flex h-8 min-w-0 flex-col justify-center">
      <span className="text-text-muted text-2xs truncate leading-tight">{label}</span>

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
          className="bg-canvas border-accent text-text-primary w-full min-w-0 rounded border px-1 font-mono text-xs leading-tight outline-none"
        />
      ) : (
        <span
          className={`truncate font-mono text-xs leading-tight font-medium transition-opacity ${colorClass} ${
            saving ? 'opacity-40' : 'opacity-100'
          } ${isInteractive ? 'cursor-pointer' : 'cursor-default'}`}
          onClick={
            type === 'boolean' ? onToggle : type === 'enum' && options?.length ? onCycle : undefined
          }
          onDoubleClick={!isInteractive ? onStartEdit : undefined}
        >
          {disp || <span className="text-text-faint">none</span>}
        </span>
      )}
    </li>
  )
}

/**
 * The Config tile's canvas face: server.properties at a glance, never scrolled.
 *
 * The MOTD leads, rendered the way a client shows it, and the settings follow
 * as a wrapping grid of cells in `ORDERED_KEYS`' order, identity first. What
 * does not fit gives its last cell to a count of the rest; the maximized
 * editor holds all of them. A switch or a choice still flips with a click and
 * a value still edits on a double-click, as the rows did.
 */
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

  const props = rawContent ? parseRawProps(rawContent) : {}
  // Only show keys that exist in the file (don't pollute with all possible keys)
  const keys = ORDERED_KEYS.filter((k) => k !== 'motd' && k in props)
  const [measure, capacity] = useGridFit(keys.length)
  const { shown, more } = fitItems(keys, capacity)

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
          className="border-border-subtle text-text-muted text-2xs rounded border px-2 py-0.5 font-mono"
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

  // The first line only: the second is the server list's, and one line is
  // what a glance has room for.
  const motd = (props.motd ?? '').split('\\n')[0]

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden px-3 py-2">
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm"
          aria-label={decodeEscapes(motd).replace(/§./g, '')}
        >
          <MotdPreviewLine raw={motd} placeholder="A Minecraft Server" />
        </span>
        <IconButton onClick={load} title="Reload from disk">
          <Icon icon={RotateCw} size="sm" />
        </IconButton>
      </div>

      <ul
        ref={measure}
        aria-label="Server properties"
        className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] content-start gap-x-4 gap-y-2 overflow-hidden"
      >
        {shown.map((key) => {
          const schema = PROPERTIES_SCHEMA[key]
          const type: FieldType = schema?.type === 'motd' ? 'string' : (schema?.type ?? 'string')
          const options = schema?.options
          const rawVal = props[key] ?? ''

          return (
            <PropCell
              key={key}
              propKey={key}
              label={schema?.label ?? key}
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
        {more > 0 && (
          <li className="text-text-muted flex h-8 items-center font-mono text-xs">+{more} more</li>
        )}
      </ul>
    </div>
  )
}
