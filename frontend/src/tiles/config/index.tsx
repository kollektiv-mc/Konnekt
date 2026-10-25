import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import { RestartServer } from '../../../wailsjs/go/main/App'
import { hasWailsBridge } from '../../lib/ipc'
import { useServerStore } from '../../stores/useServerStore'
import { useUiStore } from '../../stores/useUiStore'
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog'
import { useDirtyGuard } from '../../hooks/useDirtyGuard'
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
  // The one field it reads. The whole store changes on every status poll, and
  // each change re-rendered the open editor.
  const running = useServerStore((s) => s.status.running)
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

  // Veto a close, a server switch or a file switch while the open file has
  // unsaved edits (#450), behind the same dialog the scheduler editor uses.
  // Both read through refs so the guard keeps one identity across keystrokes
  // instead of re-registering on each, and it is only registered while this
  // editor is maximized, since the compact face holds nothing to lose.
  const setCloseGuard = useUiStore((s) => s.setCloseGuard)
  const isDirtyRef = useRef(false)
  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])
  const confirm = useDirtyGuard(() => isDirtyRef.current)
  // Pulled out for the effect's dependency list: the hook's callbacks are
  // stable, the object holding them is not.
  const { hold: holdConfirm } = confirm
  useEffect(() => {
    if (!maximized) return
    setCloseGuard((proceed) => {
      if (!isDirtyRef.current) return false
      // Holding still returns true: the guard has answered, and the close or
      // switch runs from the dialog or not at all.
      holdConfirm(proceed)
      return true
    })
    return () => setCloseGuard(null)
  }, [maximized, setCloseGuard, holdConfirm])

  // Summary view when tile is not maximized
  if (!maximized) {
    return <ConfigSummary serverId={serverId} />
  }

  async function handleSaveAndMaybeRestart() {
    await save()
  }

  // A close re-enters the close guard through the store before the render that
  // refreshes isDirtyRef, so both ways on mark it clean first or it would ask
  // again.
  function discardAndContinue() {
    revert()
    isDirtyRef.current = false
    confirm.proceed()
  }

  async function saveAndContinue() {
    // A failed save leaves its reason in the editor's header; drop the held
    // action and keep the file open rather than continue past it.
    if (!(await save())) {
      confirm.cancel()
      return
    }
    isDirtyRef.current = false
    confirm.proceed()
  }

  function handleRestart() {
    // A write, so `hasWailsBridge()` rather than the `.catch()` alone (see
    // lib/ipc.ts): with no bridge the binding throws inside the click
    // handler before a promise exists (#185).
    if (hasWailsBridge()) RestartServer(serverId).catch(() => {})
  }

  function handleSelect(relPath: string) {
    if (relPath === selectedRelPath) return
    confirm.guard(() => void selectFile(relPath))
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
          isRunning={running}
          onSave={handleSaveAndMaybeRestart}
          onRevert={revert}
          onRestart={handleRestart}
        />
      </Suspense>

      <UnsavedChangesDialog
        open={confirm.pending}
        saving={saving}
        body="This file has unsaved changes. Save them first, or discard them?"
        onCancel={confirm.cancel}
        onDiscard={discardAndContinue}
        onSaveAndContinue={() => void saveAndContinue()}
      />
    </div>
  )
}
