import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SendCommand } from '../../wailsjs/go/main/App'
import { Icon } from './ui/Icon'
import { GripVertical, Plus, X } from '../lib/icons'
import { useCommandsStore, type CommandButton } from '../stores/useCommandsStore'
import { KickBanDialog, LifecycleConfirmDialog } from './commands/CommandDialogs'
import { PRESETS, makeItem, type PresetTemplate } from './commands/presets'
import { useLifecycle } from './commands/useLifecycle'

interface DropdownPos {
  // Only one of top/bottom is set depending on which direction has more room.
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

interface QuickCommandsPanelProps {
  serverId: string
  /** grid columns for the button grid; a narrow sidepane rail should use 1 */
  columns?: 1 | 2
}

/**
 * The compact command grid: press a button, the command goes to the server.
 *
 * Shared rather than living under `tiles/quick-commands/` because the console
 * tile embeds it as its right-hand rail. The maximized half of the tile is a
 * separate, lazily-loaded component (`tiles/quick-commands/library/`); this one
 * stays deliberately small, since it renders inside a grid cell.
 *
 * The button list itself lives in `useCommandsStore`, not here. Once the tile
 * became maximizable, Dashboard began rendering the maximized copy *in addition
 * to* the grid copy, so component-local state would have diverged between two
 * simultaneous mounts of this same component.
 */
export function QuickCommandsPanel({ serverId, columns = 2 }: QuickCommandsPanelProps) {
  const items = useCommandsStore((s) => s.items)
  const hydrate = useCommandsStore((s) => s.hydrate)
  const add = useCommandsStore((s) => s.add)
  const remove = useCommandsStore((s) => s.remove)
  const reorder = useCommandsStore((s) => s.reorder)

  const [newCmd, setNewCmd] = useState('')
  const [modal, setModal] = useState<'kick' | 'ban' | null>(null)
  const [editing, setEditing] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const dragIndex = useRef<number | null>(null)
  const presetsButtonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const lifecycle = useLifecycle(serverId)

  useEffect(() => {
    // Idempotent in the store, which is what lets this run from every mount —
    // both copies of the tile plus the console's rail — without racing.
    void hydrate()
  }, [hydrate])

  // Close the presets dropdown when clicking outside of it.
  useEffect(() => {
    if (!dropdownPos) return
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        presetsButtonRef.current &&
        !presetsButtonRef.current.contains(e.target as Node)
      ) {
        setDropdownPos(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownPos])

  const openPresets = useCallback(() => {
    if (dropdownPos) {
      setDropdownPos(null)
      return
    }
    const btn = presetsButtonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const w = Math.max(rect.width, 240)
    const margin = 8
    const spaceAbove = rect.top - margin
    const spaceBelow = window.innerHeight - rect.bottom - margin
    if (spaceAbove >= spaceBelow) {
      setDropdownPos({
        bottom: window.innerHeight - rect.top + 6,
        left: rect.left,
        width: w,
        maxHeight: spaceAbove,
      })
    } else {
      setDropdownPos({
        top: rect.bottom + 6,
        left: rect.left,
        width: w,
        maxHeight: spaceBelow,
      })
    }
  }, [dropdownPos])

  const send = useCallback(
    (cmd: string) => {
      SendCommand(serverId, cmd).catch(console.error)
    },
    [serverId],
  )

  const run = useCallback(
    (item: CommandButton) => {
      if (item.kind === 'special') {
        setModal(item.value as 'kick' | 'ban')
      } else if (item.kind === 'lifecycle') {
        lifecycle.request(item.value)
      } else {
        send(item.value)
      }
    },
    [lifecycle, send],
  )

  const addCustom = useCallback(() => {
    const v = newCmd.trim()
    if (!v) return
    void add(makeItem({ label: v, kind: 'cmd', value: v })).catch(console.error)
    setNewCmd('')
  }, [newCmd, add])

  const addPreset = useCallback(
    (t: PresetTemplate) => {
      void add(makeItem(t)).catch(console.error)
    },
    [add],
  )

  const onDrop = useCallback(
    (to: number) => {
      const from = dragIndex.current
      dragIndex.current = null
      setOverIndex(null)
      if (from === null) return
      void reorder(from, to).catch(console.error)
    },
    [reorder],
  )

  const toggleEdit = useCallback(() => {
    setEditing((e) => !e)
    setDropdownPos(null)
  }, [])

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-2">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-text-faint flex h-full items-center justify-center text-xs">
            Press Edit to add commands.
          </div>
        ) : (
          <div className={`grid gap-1.5 ${columns === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {items.map((item, i) =>
              editing ? (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => {
                    dragIndex.current = i
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (overIndex !== i) setOverIndex(i)
                  }}
                  onDragLeave={() => setOverIndex((o) => (o === i ? null : o))}
                  onDrop={() => onDrop(i)}
                  onDragEnd={() => {
                    dragIndex.current = null
                    setOverIndex(null)
                  }}
                  className={`text-text-secondary flex cursor-grab items-center gap-1 rounded border px-2 py-1.5 text-xs transition-colors ${
                    overIndex === i ? 'border-border-hover bg-hover' : 'border-border-subtle'
                  }`}
                >
                  <Icon icon={GripVertical} size="xs" className="text-text-faint shrink-0" />
                  <span className="flex-1 truncate" title={item.value}>
                    {item.label}
                  </span>
                  <button
                    onClick={() => void remove(item.id).catch(console.error)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="text-text-faint hover:text-danger px-1 transition-colors"
                    title="Remove"
                    aria-label={`Remove ${item.label}`}
                  >
                    <Icon icon={X} size="xs" />
                  </button>
                </div>
              ) : (
                <button
                  key={item.id}
                  onClick={() => run(item)}
                  disabled={
                    item.kind === 'lifecycle' &&
                    item.value !== 'force-stop' &&
                    lifecycle.busy !== null
                  }
                  title={item.value}
                  className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary truncate rounded border px-2 py-1.5 text-left text-xs transition-all disabled:opacity-40"
                >
                  {item.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5">
        {(lifecycle.busy === 'stop' || lifecycle.busy === 'restart') && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-text-muted">
              {lifecycle.busy === 'stop' ? 'Stopping…' : 'Restarting…'}
            </span>
            <button
              onClick={() => lifecycle.setConfirmAction('force-stop')}
              className="border-hairline text-danger border-danger/30 bg-danger/15 hover:bg-danger/25 rounded px-2 py-1 text-xs transition-colors"
            >
              Force stop
            </button>
          </div>
        )}
        {lifecycle.error && (
          <div role="alert" className="text-danger text-xs">
            Action failed: {lifecycle.error}
          </div>
        )}
        {editing && (
          <div className="relative">
            <input
              type="text"
              value={newCmd}
              onChange={(e) => setNewCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              placeholder="Add command..."
              className="border-border-subtle bg-hover text-text-primary placeholder-text-faint focus:border-border-hover w-full rounded border px-2 py-1 pr-7 font-mono text-xs transition-colors outline-none"
            />
            <button
              onClick={addCustom}
              title="Add command"
              aria-label="Add command"
              className="text-text-muted hover:text-text-primary absolute top-1/2 right-1.5 -translate-y-1/2 transition-colors"
            >
              <Icon icon={Plus} size="xs" />
            </button>
          </div>
        )}
        <div className="flex justify-between gap-1.5">
          {editing && (
            <button
              ref={presetsButtonRef}
              onClick={openPresets}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                dropdownPos
                  ? 'border-border-hover bg-hover text-text-primary'
                  : 'border-border-subtle text-text-secondary hover:border-border-hover hover:text-text-primary'
              }`}
            >
              + Presets
            </button>
          )}
          <button
            onClick={toggleEdit}
            className={`ml-auto rounded border px-2 py-1 text-xs transition-colors ${
              editing
                ? 'border-border-hover bg-hover text-text-primary'
                : 'border-border-subtle text-text-secondary hover:border-border-hover hover:text-text-primary'
            }`}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Portaled to body so the dropdown escapes the tile's stacking context
          (a grid tile is transformed, a maximized one sits inside the overlay);
          z-popover is what carries it over the maximize overlay (lib/layers.ts). */}
      {dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="modal-panel-in border-hairline border-border-subtle bg-canvas z-popover fixed grid grid-cols-2 gap-1.5 overflow-y-auto rounded-[10px] p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            // eslint-disable-next-line no-restricted-syntax -- position computed from getBoundingClientRect, not visible to Tailwind's static scanner
            style={{
              top: dropdownPos.top,
              bottom: dropdownPos.bottom,
              left: dropdownPos.left,
              minWidth: dropdownPos.width,
              width: dropdownPos.width,
              maxHeight: dropdownPos.maxHeight,
            }}
          >
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  addPreset(p)
                  setDropdownPos(null)
                }}
                title={p.value}
                className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary truncate rounded border px-2 py-1.5 text-left text-xs transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>,
          document.body,
        )}

      {lifecycle.confirmAction && (
        <LifecycleConfirmDialog
          action={lifecycle.confirmAction}
          busy={lifecycle.busy !== null}
          onCancel={() => lifecycle.setConfirmAction(null)}
          onConfirm={lifecycle.runConfirmed}
        />
      )}

      {modal && (
        <KickBanDialog
          type={modal}
          onCancel={() => setModal(null)}
          onSubmit={(cmd) => {
            send(cmd)
            setModal(null)
          }}
        />
      )}
    </div>
  )
}
