import { useCallback, useEffect, useState } from 'react'
import { SendCommand } from '../../wailsjs/go/main/App'
import { hasWailsBridge } from '../lib/ipc'
import { Icon } from './ui/Icon'
import { Link2, TriangleAlert } from '../lib/icons'
import { COMMAND_GRID, columnsFor } from '../lib/gridColumns'
import { useElementSize } from '../hooks/useElementSize'
import { useCommandsStore, type CommandButton } from '../stores/useCommandsStore'
import { KickBanDialog, LifecycleConfirmDialog } from './commands/CommandDialogs'
import { useLifecycle } from './commands/useLifecycle'

interface QuickCommandsPanelProps {
  serverId: string
  /**
   * A fixed column count, for a host that knows its shape: the console's rail
   * is a narrow strip and wants one. Left out, the grid chooses from the count
   * of buttons and its own measured size (lib/gridColumns.ts).
   */
  columns?: number
}

/**
 * Tailwind has to see each class it emits, so the count maps to a literal
 * rather than being spliced into one. Six is `COMMAND_GRID.maxColumns`.
 */
const COLUMN_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
}

/**
 * The compact command grid: press a button, the command goes to the server.
 *
 * Shared rather than living under `tiles/quick-commands/` because the console
 * tile embeds it as its right-hand rail. The maximized half of the tile is a
 * separate, lazily-loaded component (`tiles/quick-commands/library/`); this one
 * stays deliberately small, since it renders inside a grid cell.
 *
 * It fires, and that is all. Adding, removing and reordering commands live in
 * the library: a grid cell has no room to do any of it well, and the input,
 * presets menu and edit mode that used to sit here cost the grid a row of
 * buttons for actions taken once. What is left is the grid.
 *
 * The grid fills the tile, and shapes itself to it. Columns come from the
 * count of buttons and the measured box (lib/gridColumns.ts): one command is
 * one cell the size of the tile, two stack, three go two by two, and a wider
 * tile spreads into more columns. Rows share the height, so the default size
 * is filled, and scroll once there are more rows than fit at the minimum. A
 * button then sizes its text to its row and, given the room, shows the
 * command under the label; that half is CSS in `style.css` (`.cmd-button`),
 * because only the row knows its height.
 *
 * The button list itself lives in `useCommandsStore`, not here. Once the tile
 * became maximizable, Dashboard began rendering the maximized copy *in addition
 * to* the grid copy, so component-local state would have diverged between two
 * simultaneous mounts of this same component.
 */
export function QuickCommandsPanel({ serverId, columns }: QuickCommandsPanelProps) {
  const items = useCommandsStore((s) => s.items)
  const hydrate = useCommandsStore((s) => s.hydrate)
  const [measure, box] = useElementSize()

  const [modal, setModal] = useState<'kick' | 'ban' | null>(null)

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

  // Before the first measurement (and under jsdom, forever) the count alone
  // decides, which is the same rule with a square box: a serviceable first
  // paint that the measured one replaces on the next frame.
  const cols =
    columns ??
    (box
      ? columnsFor(items.length, box, COMMAND_GRID)
      : columnsFor(items.length, { width: 360, height: 360 }, COMMAND_GRID))
  const grid = `grid h-full auto-rows-[minmax(2.25rem,1fr)] gap-1.5 ${
    COLUMN_CLASS[Math.min(cols, COMMAND_GRID.maxColumns)] ?? 'grid-cols-1'
  }`

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div ref={measure} className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-text-faint flex h-full items-center justify-center text-xs">
            No commands yet. Maximize the tile to add some.
          </div>
        ) : (
          <div className={grid}>
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => run(item)}
                disabled={
                  item.kind === 'lifecycle' &&
                  item.value !== 'force-stop' &&
                  lifecycle.busy !== null
                }
                title={item.value}
                className="cmd-button border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary flex min-w-0 flex-col justify-center gap-0.5 rounded border text-left transition-all disabled:opacity-40"
              >
                <span className="flex items-center gap-1.5">
                  <span className="cmd-button__label min-w-0 flex-1 truncate">{item.label}</span>
                  {item.link && <LinkGlyph status={item.link.status} />}
                </span>
                {/* Only a plain command has text worth a second line: a
                    lifecycle or dialog button's value is an internal token.
                    Hidden from the accessible name, which stays the label; the
                    command is already the button's title. */}
                {item.kind === 'cmd' && (
                  <span
                    aria-hidden
                    className="cmd-button__value text-text-faint text-2xs truncate font-mono"
                  >
                    {item.value}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {(lifecycle.busy === 'stop' || lifecycle.busy === 'restart') && (
        <div className="flex shrink-0 items-center justify-between gap-2 text-xs">
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
        <div role="alert" className="text-danger shrink-0 text-xs">
          Action failed: {lifecycle.error}
        </div>
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
