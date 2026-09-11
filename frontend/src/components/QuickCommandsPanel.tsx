import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SendCommand } from '../../wailsjs/go/main/App'
import { hasWailsBridge } from '../lib/ipc'
import { Icon } from './ui/Icon'
import { GripVertical, Link2, Plus, TriangleAlert, X } from '../lib/icons'
import { useSortable } from '../hooks/useSortable'
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
      // A write, so `hasWailsBridge()` rather than the `.catch()` alone (see
      // lib/ipc.ts): with no bridge the binding throws inside the click
      // handler before a promise exists (#185).
      if (hasWailsBridge()) SendCommand(serverId, cmd).catch(console.error)
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

  const onMove = useCallback(
    (from: number, to: number) => void reorder(from, to).catch(console.error),
    [reorder],
  )
  // Two columns, so the slot is judged in reading order rather than top to
  // bottom (lib/sortable.ts). Only live while editing: the grip is the handle,
  // and the grip is only drawn then.
  const sortable = useSortable({ count: items.length, axis: 'grid', disabled: !editing, onMove })

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
            {items.map((item, i) => {
              if (!editing) {
                return (
                  <button
                    key={item.id}
                    onClick={() => run(item)}
                    disabled={
                      item.kind === 'lifecycle' &&
                      item.value !== 'force-stop' &&
                      lifecycle.busy !== null
                    }
                    title={item.value}
                    className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary flex items-center gap-1 rounded border px-2 py-1.5 text-left text-xs transition-all disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.link && <LinkGlyph status={item.link.status} />}
                  </button>
                )
              }
              const lift = sortable.drag?.from === i ? sortable.drag : null
              const offset = lift ?? sortable.shift(i)
              // A row Kommands still lists comes back on the next sync if it is
              // removed here, so the way to remove it is to unlink it there. A
              // row whose file is gone is removable: nothing would return it.
              const removable = !item.link || item.link.status === 'broken'
              return (
                <div
                  key={item.id}
                  ref={sortable.rowRef(i)}
                  className={`text-text-secondary flex items-center gap-1 rounded border px-2 py-1.5 text-xs ${
                    lift
                      ? 'border-accent/60 bg-canvas relative z-10 transition-none'
                      : 'border-border-subtle duration-fast transition-[transform,border-color]'
                  }`}
                  // eslint-disable-next-line no-restricted-syntax -- a row follows the pointer or slides aside for one; a per-frame offset has no class
                  style={
                    offset ? { transform: `translate(${offset.dx}px, ${offset.dy}px)` } : undefined
                  }
                >
                  <button
                    type="button"
                    {...sortable.handleProps(i)}
                    aria-label={`Reorder ${item.label}`}
                    title="Drag to reorder, or use the arrow keys"
                    className="text-text-faint hover:text-text-secondary shrink-0 cursor-grab touch-none active:cursor-grabbing"
                  >
                    <Icon icon={GripVertical} size="xs" />
                  </button>
                  <span className="min-w-0 flex-1 truncate" title={item.value}>
                    {item.label}
                  </span>
                  {removable ? (
                    <button
                      onClick={() => void remove(item.id).catch(console.error)}
                      className="text-text-faint hover:text-danger px-1 transition-colors"
                      title="Remove"
                      aria-label={`Remove ${item.label}`}
                    >
                      <Icon icon={X} size="xs" />
                    </button>
                  ) : (
                    <span
                      className="px-1"
                      title="From Kommands. Unlink it there to remove it here."
                    >
                      <LinkGlyph status={item.link?.status ?? 'ok'} />
                    </span>
                  )}
                </div>
              )
            })}
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

/**
 * Where a button came from, at the grid's own scale: a link for a command that
 * follows Kommands, tinted when it has changed and not yet been acknowledged,
 * and a warning when the file it followed is gone. The library says the same
 * things in words; a button in a grid cell has room for one glyph.
 */
function LinkGlyph({ status }: { status: string }) {
  if (status === 'broken') {
    return (
      <Icon icon={TriangleAlert} size="xs" className="text-warning" label="Kommands not found" />
    )
  }
  return (
    <Icon
      icon={Link2}
      size="xs"
      className={status === 'changed' ? 'text-accent' : 'text-text-faint'}
      label={status === 'changed' ? 'Updated in Kommands' : 'From Kommands'}
    />
  )
}
