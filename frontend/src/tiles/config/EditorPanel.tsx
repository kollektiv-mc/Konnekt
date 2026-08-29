import { useState, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { ConfigFile } from '../../types'
import { ConfigForm } from './form/ConfigForm'
import { yamlIsFormSafe } from './form/parseYaml'
import { tomlIsFormSafe } from './form/parseToml'

function langExtension(format: ConfigFile['format']): Extension[] {
  switch (format) {
    case 'json':
    case 'json5':
      return [json()]
    case 'yaml':
      return [yaml()]
    default:
      return []
  }
}

const appTheme = EditorView.theme({
  '&': { background: 'transparent', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '12px', overflow: 'auto' },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--text-faint)' },
  '.cm-activeLineGutter': { background: 'transparent' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground': { background: 'rgba(74,222,128,0.15) !important' },
})

const FORMAT_LABELS: Record<string, string> = {
  properties: '.properties',
  yaml: 'YAML',
  json: 'JSON',
  json5: 'JSON5',
  toml: 'TOML',
  text: 'text',
}

const FORMAT_COLORS: Record<string, string> = {
  properties: 'text-yellow-400',
  yaml: 'text-blue-400',
  json: 'text-orange-400',
  json5: 'text-orange-400',
  toml: 'text-purple-400',
  text: 'text-zinc-400',
}

function formSupported(format: string, content: string): boolean {
  if (format === 'properties') return true
  if (format === 'yaml') return yamlIsFormSafe(content)
  if (format === 'json') {
    try {
      const v = JSON.parse(content)
      return v !== null && typeof v === 'object' && !Array.isArray(v)
    } catch {
      return false
    }
  }
  if (format === 'toml') return tomlIsFormSafe(content)
  return false
}

interface ViewToggleProps {
  mode: 'form' | 'raw'
  supported: boolean
  onChange: (m: 'form' | 'raw') => void
}

function ViewToggle({ mode, supported, onChange }: ViewToggleProps) {
  if (!supported) {
    return (
      <span
        className="text-text-faint shrink-0 font-mono text-[10px]"
        title="Form view unavailable — file format not supported or contains constructs that can't be safely round-tripped"
      >
        Raw only
      </span>
    )
  }
  return (
    <div className="border-border-subtle flex shrink-0 items-center overflow-hidden rounded border">
      {(['form', 'raw'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2 py-0.5 font-mono text-[10px] capitalize transition-colors ${
            mode === m ? 'bg-accent text-black' : 'text-text-faint bg-transparent'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

interface Props {
  file: ConfigFile | null
  content: string
  onChange: (val: string) => void
  isDirty: boolean
  loading: boolean
  saving: boolean
  saveError: string | null
  isRunning: boolean
  onSave: () => void
  onRevert: () => void
  onRestart: () => void
}

export function EditorPanel({
  file,
  content,
  onChange,
  isDirty,
  loading,
  saving,
  saveError,
  isRunning,
  onSave,
  onRevert,
  onRestart,
}: Props) {
  const canForm = file ? formSupported(file.format, content) : false
  const [viewMode, setViewMode] = useState<'form' | 'raw'>('form')

  // When switching to a file that doesn't support form, force raw
  useEffect(() => {
    if (!canForm) setViewMode('raw')
    else setViewMode('form')
  }, [file?.relPath, canForm])

  if (!file) {
    return (
      <div className="lazy-panel-in flex flex-1 items-center justify-center">
        <span className="text-text-faint font-mono text-xs">Select a file to edit</span>
      </div>
    )
  }

  return (
    // lazy-panel-in: CodeMirror is a Suspense chunk, so the editor lands in one
    // frame — fade it in rather than snapping it into the empty pane
    // (style.css). Both return paths carry it so switching between them does
    // not restart the animation.
    <div className="lazy-panel-in flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-border-subtle flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <span
          className="text-text-muted min-w-0 flex-1 truncate font-mono text-xs"
          title={file.relPath}
        >
          {file.relPath}
        </span>

        <span
          className={`shrink-0 font-mono text-[10px] ${FORMAT_COLORS[file.format] ?? 'text-zinc-400'}`}
        >
          {FORMAT_LABELS[file.format] ?? file.format}
        </span>

        <ViewToggle mode={viewMode} supported={canForm} onChange={setViewMode} />

        {isDirty && <span className="text-text-faint shrink-0 text-[10px]">●</span>}

        {isRunning && isDirty && (
          <span className="flex-shrink-0 text-[10px] text-yellow-500">applies after restart</span>
        )}

        {isDirty && (
          <button
            onClick={onRevert}
            className="text-text-faint shrink-0 font-mono text-[10px] transition-colors hover:text-red-400"
          >
            Revert
          </button>
        )}

        <button
          onClick={onSave}
          disabled={!isDirty || saving}
          className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors disabled:opacity-30 ${
            isDirty && !saving ? 'bg-accent text-black' : 'text-text-faint'
          }`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        {isRunning && isDirty && (
          <button
            onClick={onRestart}
            className="border-border-subtle text-text-muted shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] transition-colors"
          >
            Restart
          </button>
        )}
      </div>

      {/* Error bar */}
      {saveError && (
        <div className="border-border-subtle shrink-0 border-b bg-[rgba(239,68,68,0.08)] px-3 py-1.5 font-mono text-xs text-red-400">
          {saveError}
        </div>
      )}

      {/* Body */}
      <div className="relative flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <span className="text-text-faint font-mono text-xs">Loading…</span>
          </div>
        )}

        {!loading && viewMode === 'form' && (
          <ConfigForm format={file.format} content={content} onChange={onChange} />
        )}

        {!loading && viewMode === 'raw' && (
          <CodeMirror
            value={content}
            onChange={onChange}
            extensions={[...langExtension(file.format), appTheme]}
            theme="dark"
            height="100%"
            // eslint-disable-next-line no-restricted-syntax -- @uiw/react-codemirror's own style prop, not a plain DOM element
            style={{ height: '100%' }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
              foldGutter: false,
              dropCursor: false,
              allowMultipleSelections: false,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
              rectangularSelection: false,
              crosshairCursor: false,
              searchKeymap: true,
            }}
          />
        )}
      </div>
    </div>
  )
}
