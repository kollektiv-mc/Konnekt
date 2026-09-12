import { useCallback, useEffect, useState } from 'react'
import { SendCommand } from '../../wailsjs/go/main/App'
import { hasWailsBridge } from '../lib/ipc'
import { Icon } from './ui/Icon'
import { GripVertical, Link2, TriangleAlert, X } from '../lib/icons'
import { useSortable } from '../hooks/useSortable'
import { useCommandsStore, type CommandButton } from '../stores/useCommandsStore'
import { KickBanDialog, LifecycleConfirmDialog } from './commands/CommandDialogs'
import { useLifecycle } from './commands/useLifecycle'

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
 * It fires and it arranges, and that is all. Adding a command, whether typed,
 * from a preset or from Kommands, lives in the library: a grid cell has no
 * room to do it well, and the input and presets menu that used to sit here
 * cost the grid a row of buttons for an action taken once. Edit mode keeps
 * the two things worth doing in place, reordering and removing.
 *
 * The rows stretch to fill the tile. Six default buttons in a tile sized for
 * more left the bottom half empty; letting each row take its share of the
 * height fills the default size and still scrolls once there are more rows
 * than fit at the minimum height.
 *
 * The button list itself lives in `useCommandsStore`, not here. Once the tile
 * became maximizable, Dashboard began rendering the maximized copy *in addition
 * to* the grid copy, so component-local state would have diverged between two
 * simultaneous mounts of this same component.
 */
export function QuickCommandsPanel({ serverId, columns = 2 }: QuickCommandsPanelProps) {
  const items = useCommandsStore((s) => s.items)
  const hydrate = useCommandsStore((s) => s.hydrate)
  const remove = useCommandsStore((s) => s.remove)
  const reorder = useCommandsStore((s) => s.reorder)

  const [modal, setModal] = useState<'kick' | 'ban' | null>(null)
  const [editing, setEditing] = useState(false)

  const lifecycle = useLifecycle(serverId)

  useEffect(() => {
    // Idempotent in the store, which is what lets this run from every mount —
    // both copies of the tile plus the console's rail — without racing.
    void hydrate()
  }, [hydrate])

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

  const onMove = useCallback(
    (from: number, to: number) => void reorder(from, to).catch(console.error),
    [reorder],
  )
  // Two columns, so the slot is judged in reading order rather than top to
  // bottom (lib/sortable.ts). Only live while editing: the grip is the handle,
  // and the grip is only drawn then.
  const sortable = useSortable({
    count: items.length,
    axis: columns === 1 ? 'y' : 'grid',
    disabled: !editing,
    onMove,
  })

  const grid = `grid h-full auto-rows-[minmax(2.25rem,1fr)] gap-1.5 ${
    columns === 1 ? 'grid-cols-1' : 'grid-cols-2'
  }`

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-2">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-text-faint flex h-full items-center justify-center text-xs">
            No commands yet. Maximize the tile to add some.
          </div>
        ) : (
          <div className={grid}>
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
                    className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary flex items-center gap-1.5 rounded border px-2.5 text-left text-xs transition-all disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.link && <LinkGlyph status={item.link.status} />}
                  </button>
                )
              }
              const lift = sortable.drag?.from === i ? sortable.drag : null
              const offset = lift ?? sortable.shift(i)
              return (
                <div
                  key={item.id}
                  ref={sortable.rowRef(i)}
                  className={`text-text-secondary flex items-center gap-1.5 rounded border px-2 text-xs ${
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
                    className="text-text-faint hover:text-text-secondary flex h-full shrink-0 cursor-grab touch-none items-center active:cursor-grabbing"
                  >
                    <Icon icon={GripVertical} size="xs" />
                  </button>
                  <span className="min-w-0 flex-1 truncate" title={item.value}>
                    {item.label}
                  </span>
                  {item.link && <LinkGlyph status={item.link.status} />}
                  <button
                    onClick={() => void remove(item.id).catch(console.error)}
                    className="text-text-faint hover:text-danger flex h-full shrink-0 items-center transition-colors"
                    title="Remove"
                    aria-label={`Remove ${item.label}`}
                  >
                    <Icon icon={X} size="xs" />
                  </button>
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
        <div className="flex justify-end">
          <button
            onClick={() => setEditing((e) => !e)}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              editing
                ? 'border-border-hover bg-hover text-text-primary'
                : 'border-border-subtle text-text-secondary hover:border-border-hover hover:text-text-primary'
            }`}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

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
 * and a warning when its original is gone. The library says the same things in
 * words; a button in a grid cell has room for one glyph.
 */
function LinkGlyph({ status }: { status: string }) {
  if (status === 'broken') {
    return (
      <Icon icon={TriangleAlert} size="xs" className="text-warning" label="Unlinked in Kommands" />
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
