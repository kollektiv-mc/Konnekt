import { useState, useRef, useCallback, lazy, Suspense } from 'react'
import { RestartServer } from '../../../wailsjs/go/main/App'
import { useServerStore } from '../../stores/useServerStore'
import type { TileProps } from '../../types'
import { FileList } from './FileList'

import { useConfigEditor } from './useConfigEditor'
import { ConfigSummary } from './ConfigSummary'

// CodeMirror plus the yaml/toml parsers behind it are ~1.4 MB of source and
// only the maximized editor renders them, so they load on demand rather than
// on every launch. Warmed during idle by lib/prefetch.ts, which names this
// exact specifier.
const EditorPanel = lazy(() => import('./EditorPanel').then((m) => ({ default: m.EditorPanel })))

const SIDEBAR_MIN = 140
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 208 // w-52

export function ConfigTile({ serverId, maximized }: TileProps) {
  const { status } = useServerStore()
  const [search, setSearch] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = sidebarWidth

      function onMouseMove(ev: MouseEvent) {
        if (!dragging.current) return
        const delta = ev.clientX - startX.current
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth.current + delta))
        setSidebarWidth(next)
      }

      function onMouseUp() {
        dragging.current = false
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [sidebarWidth],
  )

  const {
    files,
    loadingFiles,
    listError,
    refresh,
    selectedFile,
    selectedRelPath,
    selectFile,
    content,
    setContent,
    isDirty,
    loadingContent,
    saving,
    saveError,
    save,
    revert,
  } = useConfigEditor(serverId)

  // Summary view when tile is not maximized
  if (!maximized) {
    return <ConfigSummary serverId={serverId} />
  }

  async function handleSaveAndMaybeRestart() {
    await save()
  }

  function handleRestart() {
    RestartServer(serverId).catch(() => {})
  }

  async function handleSelect(relPath: string) {
    if (isDirty && selectedRelPath !== relPath) {
      const ok = window.confirm('You have unsaved changes. Discard and switch files?')
      if (!ok) return
      revert()
    }
    await selectFile(relPath)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* File list panel */}
      <div
        className="flex shrink-0 flex-col overflow-hidden"
        // eslint-disable-next-line no-restricted-syntax -- sidebarWidth is a live drag-computed value
        style={{ width: sidebarWidth }}
      >
        <FileList
          files={files}
          selectedRelPath={selectedRelPath}
          dirtyPath={isDirty ? selectedRelPath : null}
          loading={loadingFiles}
          error={listError}
          search={search}
          onSearch={setSearch}
          onSelect={handleSelect}
          onRefresh={refresh}
        />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onHandleMouseDown}
        className="bg-border-subtle w-1 shrink-0 cursor-col-resize transition-colors"
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.background = 'var(--border-subtle)'
        }}
      />

      {/* Editor panel */}
      <Suspense fallback={<div className="min-w-0 flex-1" />}>
        <EditorPanel
          file={selectedFile}
          content={content}
          onChange={setContent}
          isDirty={isDirty}
          loading={loadingContent}
          saving={saving}
          saveError={saveError}
          isRunning={status.running}
          onSave={handleSaveAndMaybeRestart}
          onRevert={revert}
          onRestart={handleRestart}
        />
      </Suspense>
    </div>
  )
}
