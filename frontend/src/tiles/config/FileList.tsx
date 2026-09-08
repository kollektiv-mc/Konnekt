// aislop-ignore-file code-quality/duplicate-block -- #313
import { useEffect, useState } from 'react'
import type { ConfigFile } from '../../types'

const FORMAT_COLORS: Record<string, string> = {
  properties: 'text-yellow-400',
  yaml: 'text-blue-400',
  json: 'text-orange-400',
  json5: 'text-orange-400',
  toml: 'text-purple-400',
  text: 'text-zinc-500',
}

const FORMAT_LABELS: Record<string, string> = {
  properties: 'props',
  yaml: 'yml',
  json: 'json',
  json5: 'json5',
  toml: 'toml',
  text: 'txt',
}

function FormatChip({ format }: { format: ConfigFile['format'] }) {
  return (
    <span
      className={`flex-shrink-0 font-mono text-[9px] tracking-wide uppercase ${FORMAT_COLORS[format] ?? 'text-zinc-500'}`}
    >
      {FORMAT_LABELS[format] ?? format}
    </span>
  )
}

function FileRow({
  file,
  selected,
  dirty,
  onClick,
}: {
  file: ConfigFile
  selected: boolean
  dirty: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors ${
        selected ? 'bg-accent/15' : 'hover:bg-white/5'
      }`}
    >
      <span
        className={`flex-1 truncate font-mono text-xs ${selected ? 'text-accent' : 'text-text-primary'}`}
      >
        {file.name}
      </span>
      {dirty && <span className="bg-accent h-1.5 w-1.5 flex-shrink-0 rounded-full" />}
      <FormatChip format={file.format} />
    </button>
  )
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-4 pb-1.5">
      <span className="text-text-muted text-[10px] font-bold tracking-widest uppercase">
        {label}
      </span>
      <span className="text-text-faint font-mono text-[10px]">{count}</span>
    </div>
  )
}

function PluginGroup({
  source,
  files,
  selectedRelPath,
  dirtyPath,
  onSelect,
}: {
  source: string
  files: ConfigFile[]
  selectedRelPath: string | null
  dirtyPath: string | null
  onSelect: (p: string) => void
}) {
  const hasSelected = files.some((f) => f.relPath === selectedRelPath)
  const [open, setOpen] = useState(hasSelected)

  return (
    <div className="mb-0.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded px-3 py-1.5 text-left transition-colors hover:bg-white/3"
      >
        <span
          className={`text-text-faint text-[9px] transition-transform ${open ? 'rotate-90' : 'rotate-0'}`}
        >
          ▶
        </span>
        <span className="text-text-muted flex-1 truncate text-xs font-medium">{source}</span>
        <span className="text-text-faint font-mono text-[9px]">{files.length}</span>
      </button>

      {open && (
        <div className="pl-3">
          {files.map((f) => (
            <FileRow
              key={f.relPath}
              file={f}
              selected={f.relPath === selectedRelPath}
              dirty={f.relPath === dirtyPath}
              onClick={() => onSelect(f.relPath)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  files: ConfigFile[]
  selectedRelPath: string | null
  dirtyPath: string | null
  loading: boolean
  error: string | null
  search: string
  onSearch: (q: string) => void
  onSelect: (relPath: string) => void
  onRefresh: () => void
}

export function FileList({
  files,
  selectedRelPath,
  dirtyPath,
  loading,
  error,
  search,
  onSearch,
  onSelect,
  onRefresh,
}: Props) {
  const q = search.toLowerCase()
  const filtered = q
    ? files.filter((f) => f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q))
    : files

  const serverFiles = filtered.filter((f) => f.category === 'server')
  const pluginFiles = filtered.filter((f) => f.category === 'plugins')
  const modFiles = filtered.filter((f) => f.category === 'mods')

  function groupBySource(list: ConfigFile[]): Map<string, ConfigFile[]> {
    const map = new Map<string, ConfigFile[]>()
    for (const f of list) {
      const key = f.source || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(f)
    }
    return map
  }

  const pluginGroups = groupBySource(pluginFiles)
  const modGroups = groupBySource(modFiles)

  useEffect(() => {
    onRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="border-border-subtle flex h-full flex-col border-r">
      {/* Search */}
      <div className="border-border-subtle flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <span className="text-text-faint text-xs">⌕</span>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="text-text-primary flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-zinc-700"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && <p className="text-text-faint px-4 py-3 text-xs">Scanning…</p>}
        {error && <p className="px-4 py-3 text-xs break-all text-red-400">{error}</p>}
        {!loading && !error && files.length === 0 && (
          <p className="text-text-faint px-4 py-3 text-xs">No config files found.</p>
        )}

        {/* Server */}
        {serverFiles.length > 0 && (
          <div>
            <GroupHeader label="Server" count={serverFiles.length} />
            {serverFiles.map((f) => (
              <FileRow
                key={f.relPath}
                file={f}
                selected={f.relPath === selectedRelPath}
                dirty={f.relPath === dirtyPath}
                onClick={() => onSelect(f.relPath)}
              />
            ))}
          </div>
        )}

        {/* Plugins */}
        {pluginFiles.length > 0 && (
          <div>
            <GroupHeader label="Plugins" count={pluginFiles.length} />
            {/* Root-level plugin files (no source) */}
            {(pluginGroups.get('') ?? []).map((f) => (
              <FileRow
                key={f.relPath}
                file={f}
                selected={f.relPath === selectedRelPath}
                dirty={f.relPath === dirtyPath}
                onClick={() => onSelect(f.relPath)}
              />
            ))}
            {/* Plugin sub-groups */}
            {Array.from(pluginGroups.entries())
              .filter(([src]) => src !== '')
              .map(([source, group]) => (
                <PluginGroup
                  key={source}
                  source={source}
                  files={group}
                  selectedRelPath={selectedRelPath}
                  dirtyPath={dirtyPath}
                  onSelect={onSelect}
                />
              ))}
          </div>
        )}

        {/* Mods */}
        {modFiles.length > 0 && (
          <div>
            <GroupHeader label="Mods" count={modFiles.length} />
            {(modGroups.get('') ?? []).map((f) => (
              <FileRow
                key={f.relPath}
                file={f}
                selected={f.relPath === selectedRelPath}
                dirty={f.relPath === dirtyPath}
                onClick={() => onSelect(f.relPath)}
              />
            ))}
            {Array.from(modGroups.entries())
              .filter(([src]) => src !== '')
              .map(([source, group]) => (
                <PluginGroup
                  key={source}
                  source={source}
                  files={group}
                  selectedRelPath={selectedRelPath}
                  dirtyPath={dirtyPath}
                  onSelect={onSelect}
                />
              ))}
          </div>
        )}
      </div>

      {/* Refresh */}
      <div className="border-border-subtle shrink-0 border-t px-3 py-2">
        <button
          onClick={onRefresh}
          className="text-text-faint hover:text-accent font-mono text-[10px] transition-colors"
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
