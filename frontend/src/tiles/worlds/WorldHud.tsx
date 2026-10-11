import { useState } from 'react'
import { StopServer, StartServer } from '../../../wailsjs/go/main/App'
import { useServerConfigStore } from '../../stores/useServerConfigStore'
import { useServerStore } from '../../stores/useServerStore'
import type { WorldSystem } from './useWorlds'
import { backupsOfWorld } from './useWorldBackups'
import type { WorldBackup } from './useWorldBackups'
import { fmtBytes, fmtDate, relativeMs } from '../../lib/format'
import { isRemoteBrowser } from '../../lib/ipc'

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
  /** Every world-kind backup of the server; the HUD shows this world's. */
  backups: WorldBackup[]
  onRestoreBackup: (filename: string) => Promise<void>
  onDeleteBackup: (filename: string) => Promise<void>
  onRefresh: () => void
}

// How many of a world's backups the HUD lists; the Backups tile has the rest.
const BACKUP_ROWS = 3

interface PendingBackup {
  action: 'restore' | 'delete'
  filename: string
}

type SwitchStep = 'idle' | 'confirm' | 'working' | 'delete-confirm' | 'rename' | 'duplicate'

const CARD = 'text-text-primary w-full font-mono text-1xs select-none'

const ROW = 'flex justify-between gap-2 py-0.5'

const LABEL = 'text-text-faint'

const SECTION = 'border-b-border-subtle mb-2 border-b-hairline pb-1.5'

const STACK = 'flex flex-col gap-1'

// Split from the padding below so a variant (the ✕ close button) can set its own
// without two arbitrary padding utilities racing each other in the cascade —
// class-attribute order does not decide which of `px-[7px]`/`px-[5px]` wins.
const BTN_BASE = 'border-hairline cursor-pointer rounded-sm bg-transparent font-mono text-2xs'
const BTN_TONE = (danger: boolean) =>
  danger ? 'border-[#ef4444] text-[#ef4444]' : 'border-border-subtle text-text-muted'

const BTN = (danger = false) => `${BTN_BASE} ${BTN_TONE(danger)} px-[7px] py-0.5`
const BTN_CLOSE = `${BTN_BASE} ${BTN_TONE(false)} px-[5px] py-px`

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
  backups,
  onRestoreBackup,
  onDeleteBackup,
  onRefresh,
}: Props) {
  const activeId = useServerConfigStore((s) => s.activeId)
  const running = useServerStore((s) => s.status.running)

  const [step, setStep] = useState<SwitchStep>('idle')
  const [inputVal, setInputVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pending, setPending] = useState<PendingBackup | null>(null)

  const worldBackups = backupsOfWorld(backups, world.name)
  const shownBackups = worldBackups.slice(0, BACKUP_ROWS)
  const hiddenBackups = worldBackups.length - shownBackups.length

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

  async function confirmBackupAction() {
    if (!pending) return
    const { action, filename } = pending
    await doAction(() =>
      action === 'restore' ? onRestoreBackup(filename) : onDeleteBackup(filename),
    )
    setPending(null)
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
    <div className={CARD}>
      {/* Header */}
      <div className={`${SECTION} flex items-center justify-between`}>
        <span className={`font-bold ${world.active ? 'text-accent' : 'text-text-primary'}`}>
          {world.name}
          {dimension !== 'overworld' ? ` / ${dimLabel}` : ''}
          {world.active && <span className="text-accent text-3xs ml-1">◉ active</span>}
        </span>
        <button className={BTN_CLOSE} onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Metadata */}
      {meta.found && (
        <div className={SECTION}>
          {meta.version && (
            <div className={ROW}>
              <span className={LABEL}>version</span>
              <span>{meta.version}</span>
            </div>
          )}
          {meta.gameMode && (
            <div className={ROW}>
              <span className={LABEL}>mode</span>
              <span>
                {meta.gameMode}
                {meta.hardcore ? ' (hardcore)' : ''}
              </span>
            </div>
          )}
          {meta.difficulty && (
            <div className={ROW}>
              <span className={LABEL}>difficulty</span>
              <span>{meta.difficulty}</span>
            </div>
          )}
          {meta.seed && (
            <div className={ROW}>
              <span className={LABEL}>seed</span>
              <span className="text-2xs">{meta.seed}</span>
            </div>
          )}
          {meta.lastPlayed > 0 && (
            <div className={ROW}>
              <span className={LABEL}>last play</span>
              <span>{relativeMs(meta.lastPlayed)}</span>
            </div>
          )}
        </div>
      )}

      {/* Folder stats */}
      <div className={SECTION}>
        <div className={ROW}>
          <span className={LABEL}>size</span>
          <span>{fmtBytes(world.totalSize)}</span>
        </div>
        {dim && dim.size !== world.totalSize && (
          <div className={ROW}>
            <span className={LABEL}>{dimLabel}</span>
            <span>{fmtBytes(dim.size)}</span>
          </div>
        )}
        <div className={ROW}>
          <span className={LABEL}>modified</span>
          <span>{relativeMs(world.modified)}</span>
        </div>
      </div>

      {/* Error */}
      {err && <div className="text-2xs mb-1.5 text-[#ef4444]">{err}</div>}

      {/* Action steps */}
      {step === 'idle' && (
        <div className={STACK}>
          {!world.active && (
            <button className={BTN()} onClick={handleSetActive} disabled={busy}>
              {busy ? '…' : 'set active'}
            </button>
          )}
          <button
            className={BTN()}
            onClick={() => doAction(() => onBackup(world.name))}
            disabled={busy}
          >
            {busy ? '…' : 'backup'}
          </button>
          {/* OpenWorldFolder opens a folder on the desktop: not callable from a remote browser. */}
          {!isRemoteBrowser() && (
            <button
              className={BTN()}
              onClick={() => doAction(() => onOpenFolder(world.name))}
              disabled={busy}
            >
              open folder
            </button>
          )}
          <button
            className={BTN()}
            onClick={() => {
              setInputVal(world.name + '_copy')
              setStep('rename')
            }}
            disabled={busy || running}
          >
            rename
          </button>
          <button
            className={BTN()}
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
              className={BTN(true)}
              onClick={() => setStep('delete-confirm')}
              disabled={busy || running}
            >
              delete
            </button>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div className={STACK}>
          <div className="text-text-faint text-2xs mb-1">Server is running. How to switch?</div>
          <button className={BTN()} onClick={switchAndRestart} disabled={busy}>
            {busy ? '…' : 'stop → switch → restart'}
          </button>
          <button className={BTN()} onClick={switchStayOff} disabled={busy}>
            {busy ? '…' : 'stop → switch (stay off)'}
          </button>
          <button className={BTN(true)} onClick={() => setStep('idle')} disabled={busy}>
            cancel
          </button>
        </div>
      )}

      {step === 'delete-confirm' && (
        <div className={STACK}>
          <div className="text-2xs mb-1 text-[#ef4444]">Delete "{world.name}" permanently?</div>
          <button
            className={BTN(true)}
            onClick={() => doAction(() => onDelete(world.name))}
            disabled={busy}
          >
            {busy ? '…' : 'yes, delete'}
          </button>
          <button className={BTN()} onClick={() => setStep('idle')}>
            cancel
          </button>
        </div>
      )}

      {step === 'rename' && (
        <div className={STACK}>
          <div className="text-text-faint text-2xs mb-0.5">New name:</div>
          <input
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            className="bg-canvas border-accent text-text-primary border-hairline text-1xs rounded-sm px-1.5 py-[3px] font-mono outline-none"
          />
          <button
            className={BTN()}
            onClick={() => doAction(() => onRename(world.name, inputVal))}
            disabled={busy || !inputVal}
          >
            {busy ? '…' : 'rename'}
          </button>
          <button className={BTN(true)} onClick={() => setStep('idle')}>
            cancel
          </button>
        </div>
      )}

      {step === 'duplicate' && (
        <div className={STACK}>
          <div className="text-text-faint text-2xs mb-0.5">Copy name:</div>
          <input
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            className="bg-canvas border-accent text-text-primary border-hairline text-1xs rounded-sm px-1.5 py-[3px] font-mono outline-none"
          />
          <button
            className={BTN()}
            onClick={() => doAction(() => onDuplicate(world.name, inputVal))}
            disabled={busy || !inputVal}
          >
            {busy ? '…' : 'duplicate'}
          </button>
          <button className={BTN(true)} onClick={() => setStep('idle')}>
            cancel
          </button>
        </div>
      )}

      {/* This world's backups */}
      {step === 'idle' && (
        <div className="border-t-border-subtle border-t-hairline mt-2 pt-1.5">
          <div className={`${LABEL} mb-1`}>Backups</div>
          {shownBackups.length === 0 && (
            <div className="text-text-faint text-2xs">No backups of this world yet</div>
          )}
          {shownBackups.map((b) => {
            const asking = pending?.filename === b.filename ? pending.action : null
            return (
              <div key={b.filename} className="border-b-border-subtle border-b-hairline py-1">
                <div className="flex justify-between gap-2">
                  <span>{fmtDate(b.createdAt)}</span>
                  <span className="text-text-muted">{fmtBytes(b.sizeBytes)}</span>
                </div>
                {b.displayName && (
                  <div className="text-text-muted text-2xs truncate">{b.displayName}</div>
                )}
                {asking ? (
                  <div className={`${STACK} mt-1`}>
                    <div
                      className={`text-2xs ${asking === 'delete' ? 'text-danger' : 'text-text-muted'}`}
                    >
                      {asking === 'restore'
                        ? 'Replace the current world with this backup?'
                        : 'Delete this backup permanently?'}
                    </div>
                    <button
                      className={BTN(asking === 'delete')}
                      onClick={confirmBackupAction}
                      disabled={busy}
                    >
                      {busy ? '…' : asking === 'restore' ? 'yes, restore' : 'yes, delete'}
                    </button>
                    <button className={BTN()} onClick={() => setPending(null)} disabled={busy}>
                      cancel
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex gap-1">
                    <button
                      className={BTN()}
                      onClick={() => setPending({ action: 'restore', filename: b.filename })}
                      disabled={busy || running}
                      title={running ? 'Stop the server before restoring a backup' : undefined}
                    >
                      restore
                    </button>
                    <button
                      className={BTN(true)}
                      onClick={() => setPending({ action: 'delete', filename: b.filename })}
                      disabled={busy}
                    >
                      delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {hiddenBackups > 0 && (
            <div className="text-text-faint text-2xs pt-1">
              +{hiddenBackups} more in the Backups tile
            </div>
          )}
        </div>
      )}
    </div>
  )
}
