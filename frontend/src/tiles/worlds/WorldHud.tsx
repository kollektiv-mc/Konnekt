import { useState } from 'react'
import { StopServer, StartServer } from '../../../wailsjs/go/main/App'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useServerStore } from '../../stores/useServerStore'
import type { WorldSystem } from './useWorlds'

interface Props {
  world: WorldSystem
  dimension: string // "overworld" | "nether" | "the_end"
  onClose: () => void
  onSetActive: (name: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onRename: (old: string, next: string) => Promise<void>
  onDuplicate: (name: string, next: string) => Promise<void>
  onOpenFolder: (name: string) => Promise<void>
  onBackup: (name: string) => Promise<void>
  onRefresh: () => void
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtRelative(ms: number): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type SwitchStep = 'idle' | 'confirm' | 'working' | 'delete-confirm' | 'rename' | 'duplicate'

const CARD: React.CSSProperties = {
  width: '100%',
  fontFamily: 'monospace',
  fontSize: 11,
  color: 'var(--text-primary)',
  userSelect: 'none',
}

const ROW: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '2px 0',
}

const LABEL: React.CSSProperties = { color: 'var(--text-faint)' }

const BTN = (danger = false): React.CSSProperties => ({
  background: 'transparent',
  border: `0.5px solid ${danger ? '#ef4444' : 'var(--border-subtle)'}`,
  color: danger ? '#ef4444' : 'var(--text-muted)',
  borderRadius: 3,
  padding: '2px 7px',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: 'monospace',
})

export function WorldHud({
  world,
  dimension,
  onClose,
  onSetActive,
  onDelete,
  onRename,
  onDuplicate,
  onOpenFolder,
  onBackup,
  onRefresh,
}: Props) {
  const activeId = useServerConfigStore((s) => s.activeId)
  const running = useServerStore((s) => s.status.running)

  const [step, setStep] = useState<SwitchStep>('idle')
  const [inputVal, setInputVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const dim = world.dimensions.find((d) => d.kind === dimension)
  const meta = world.meta

  const dimLabel =
    dimension === 'overworld' ? 'Overworld' : dimension === 'nether' ? 'Nether' : 'The End'

  async function doAction(fn: () => Promise<void>) {
    setBusy(true)
    setErr('')
    try {
      await fn()
      setStep('idle')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Switch active: if server running, show confirm with 3-way choice.
  function handleSetActive() {
    if (world.active) return
    if (running) {
      setStep('confirm')
    } else {
      doAction(() => onSetActive(world.name))
    }
  }

  async function switchAndRestart() {
    setBusy(true)
    setErr('')
    try {
      await StopServer(activeId)
      await onSetActive(world.name)
      await StartServer(activeId)
      onRefresh()
      setStep('idle')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function switchStayOff() {
    setBusy(true)
    setErr('')
    try {
      await StopServer(activeId)
      await onSetActive(world.name)
      onRefresh()
      setStep('idle')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={CARD}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          borderBottom: '0.5px solid var(--border-subtle)',
          paddingBottom: 6,
        }}
      >
        <span
          style={{ fontWeight: 700, color: world.active ? 'var(--accent)' : 'var(--text-primary)' }}
        >
          {world.name}
          {dimension !== 'overworld' ? ` / ${dimLabel}` : ''}
          {world.active && (
            <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)' }}>◉ active</span>
          )}
        </span>
        <button style={{ ...BTN(), padding: '1px 5px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Metadata */}
      {meta.found && (
        <div
          style={{
            marginBottom: 8,
            borderBottom: '0.5px solid var(--border-subtle)',
            paddingBottom: 6,
          }}
        >
          {meta.version && (
            <div style={ROW}>
              <span style={LABEL}>version</span>
              <span>{meta.version}</span>
            </div>
          )}
          {meta.gameMode && (
            <div style={ROW}>
              <span style={LABEL}>mode</span>
              <span>
                {meta.gameMode}
                {meta.hardcore ? ' (hardcore)' : ''}
              </span>
            </div>
          )}
          {meta.difficulty && (
            <div style={ROW}>
              <span style={LABEL}>difficulty</span>
              <span>{meta.difficulty}</span>
            </div>
          )}
          {meta.seed && (
            <div style={ROW}>
              <span style={LABEL}>seed</span>
              <span style={{ fontSize: 10 }}>{meta.seed}</span>
            </div>
          )}
          {meta.lastPlayed > 0 && (
            <div style={ROW}>
              <span style={LABEL}>last play</span>
              <span>{fmtRelative(meta.lastPlayed)}</span>
            </div>
          )}
        </div>
      )}

      {/* Folder stats */}
      <div
        style={{
          marginBottom: 8,
          borderBottom: '0.5px solid var(--border-subtle)',
          paddingBottom: 6,
        }}
      >
        <div style={ROW}>
          <span style={LABEL}>size</span>
          <span>{fmtBytes(world.totalSize)}</span>
        </div>
        {dim && dim.size !== world.totalSize && (
          <div style={ROW}>
            <span style={LABEL}>{dimLabel}</span>
            <span>{fmtBytes(dim.size)}</span>
          </div>
        )}
        <div style={ROW}>
          <span style={LABEL}>modified</span>
          <span>{fmtRelative(world.modified)}</span>
        </div>
      </div>

      {/* Error */}
      {err && <div style={{ color: '#ef4444', fontSize: 10, marginBottom: 6 }}>{err}</div>}

      {/* Action steps */}
      {step === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!world.active && (
            <button style={BTN()} onClick={handleSetActive} disabled={busy}>
              {busy ? '…' : 'set active'}
            </button>
          )}
          <button
            style={BTN()}
            onClick={() => doAction(() => onBackup(world.name))}
            disabled={busy}
          >
            {busy ? '…' : 'backup'}
          </button>
          <button
            style={BTN()}
            onClick={() => doAction(() => onOpenFolder(world.name))}
            disabled={busy}
          >
            open folder
          </button>
          <button
            style={BTN()}
            onClick={() => {
              setInputVal(world.name + '_copy')
              setStep('rename')
            }}
            disabled={busy || running}
          >
            rename
          </button>
          <button
            style={BTN()}
            onClick={() => {
              setInputVal(world.name + '_copy')
              setStep('duplicate')
            }}
            disabled={busy}
          >
            duplicate
          </button>
          {!world.active && (
            <button
              style={BTN(true)}
              onClick={() => setStep('delete-confirm')}
              disabled={busy || running}
            >
              delete
            </button>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ color: 'var(--text-faint)', fontSize: 10, marginBottom: 4 }}>
            Server is running. How to switch?
          </div>
          <button style={BTN()} onClick={switchAndRestart} disabled={busy}>
            {busy ? '…' : 'stop → switch → restart'}
          </button>
          <button style={BTN()} onClick={switchStayOff} disabled={busy}>
            {busy ? '…' : 'stop → switch (stay off)'}
          </button>
          <button style={BTN(true)} onClick={() => setStep('idle')} disabled={busy}>
            cancel
          </button>
        </div>
      )}

      {step === 'delete-confirm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ color: '#ef4444', fontSize: 10, marginBottom: 4 }}>
            Delete "{world.name}" permanently?
          </div>
          <button
            style={BTN(true)}
            onClick={() => doAction(() => onDelete(world.name))}
            disabled={busy}
          >
            {busy ? '…' : 'yes, delete'}
          </button>
          <button style={BTN()} onClick={() => setStep('idle')}>
            cancel
          </button>
        </div>
      )}

      {step === 'rename' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ color: 'var(--text-faint)', fontSize: 10, marginBottom: 2 }}>New name:</div>
          <input
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            style={{
              background: 'var(--bg-base)',
              border: '0.5px solid var(--accent)',
              color: 'var(--text-primary)',
              borderRadius: 3,
              padding: '3px 6px',
              fontFamily: 'monospace',
              fontSize: 11,
              outline: 'none',
            }}
          />
          <button
            style={BTN()}
            onClick={() => doAction(() => onRename(world.name, inputVal))}
            disabled={busy || !inputVal}
          >
            {busy ? '…' : 'rename'}
          </button>
          <button style={BTN(true)} onClick={() => setStep('idle')}>
            cancel
          </button>
        </div>
      )}

      {step === 'duplicate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ color: 'var(--text-faint)', fontSize: 10, marginBottom: 2 }}>
            Copy name:
          </div>
          <input
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            style={{
              background: 'var(--bg-base)',
              border: '0.5px solid var(--accent)',
              color: 'var(--text-primary)',
              borderRadius: 3,
              padding: '3px 6px',
              fontFamily: 'monospace',
              fontSize: 11,
              outline: 'none',
            }}
          />
          <button
            style={BTN()}
            onClick={() => doAction(() => onDuplicate(world.name, inputVal))}
            disabled={busy || !inputVal}
          >
            {busy ? '…' : 'duplicate'}
          </button>
          <button style={BTN(true)} onClick={() => setStep('idle')}>
            cancel
          </button>
        </div>
      )}
    </div>
  )
}
