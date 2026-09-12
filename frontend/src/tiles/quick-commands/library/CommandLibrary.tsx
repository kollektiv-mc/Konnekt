import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { Plus, Search } from '../../../lib/icons'
import { KickBanDialog, LifecycleConfirmDialog } from '../../../components/commands/CommandDialogs'
import { PRESETS, makeItem } from '../../../components/commands/presets'
import { useLifecycle } from '../../../components/commands/useLifecycle'
import { Segmented } from '../../../components/ui/Segmented'
import { useSortable } from '../../../hooks/useSortable'
import {
  useCommandsStore,
  type CommandButton,
  type KommandsSavedCommand,
} from '../../../stores/useCommandsStore'
import { useUiStore } from '../../../stores/useUiStore'
import { SendCommand } from '../../../../wailsjs/go/main/App'
import { hasWailsBridge } from '../../../lib/ipc'
import { CommandRow } from './CommandRow'
import { KommandsPanel } from './KommandsPanel'
import type { LibraryFilter } from '../types'

const UNGROUPED = 'Ungrouped'

const FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'linked', label: 'Linked' },
  { value: 'attention', label: 'Attention' },
]

/**
 * The maximized Commands tile: a command library rather than a button grid.
 *
 * The compact panel stays exactly as it was — it is what the console tile
 * embeds, and it is the right shape for firing a command. This is the other
 * half: managing a set of them, which a grid cell has never had room for.
 *
 * The list is one ordered array, and everything here respects that. Rows
 * linked from Kommands sit in it wherever the user drags them, badged with
 * where they come from; they are not a section of their own, because a
 * command's origin is not what decides where it belongs on a server. The
 * sidebar is where a command enters the list: typed, from a preset, or added
 * from what Kommands has linked.
 */
export function CommandLibrary({ serverId }: { serverId: string }) {
  const items = useCommandsStore((s) => s.items)
  const kommands = useCommandsStore((s) => s.kommands)
  const saved = useCommandsStore((s) => s.saved)
  const error = useCommandsStore((s) => s.error)
  const hydrate = useCommandsStore((s) => s.hydrate)
  const add = useCommandsStore((s) => s.add)
  const remove = useCommandsStore((s) => s.remove)
  const reorder = useCommandsStore((s) => s.reorder)
  const update = useCommandsStore((s) => s.update)
  const duplicate = useCommandsStore((s) => s.duplicate)
  const addLinked = useCommandsStore((s) => s.addLinked)
  const unlink = useCommandsStore((s) => s.unlink)
  const acknowledge = useCommandsStore((s) => s.acknowledge)

  const setCloseGuard = useUiStore((s) => s.setCloseGuard)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [newCmd, setNewCmd] = useState('')
  const [modal, setModal] = useState<'kick' | 'ban' | null>(null)

  const lifecycle = useLifecycle(serverId)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Dashboard's window-level Escape handler closes the whole maximized tile.
  // While a dialog is open that would tear the dialog down along with it, so
  // the guard swallows the first Escape and closes only the dialog.
  //
  // Only the library registers this. The compact panel is mounted at the same
  // time and must not, or its own dialogs would block a close the user meant.
  const dialogOpen = modal !== null || lifecycle.confirmAction !== null
  useEffect(() => {
    if (!dialogOpen) return
    setCloseGuard(() => {
      setModal(null)
      lifecycle.setConfirmAction(null)
      return true
    })
    return () => setCloseGuard(null)
  }, [dialogOpen, setCloseGuard, lifecycle])

  const send = useCallback(
    (cmd: string) => {
      // Same split as QuickCommandsPanel's send, for the same reason (#185).
      if (hasWailsBridge()) SendCommand(serverId, cmd).catch(console.error)
    },
    [serverId],
  )

  const run = useCallback(
    (item: CommandButton) => {
      if (item.kind === 'special') setModal(item.value as 'kick' | 'ban')
      else if (item.kind === 'lifecycle') lifecycle.request(item.value)
      else send(item.value)
    },
    [lifecycle, send],
  )

  const addCustom = useCallback(() => {
    const v = newCmd.trim()
    if (!v) return
    void add(makeItem({ label: v, kind: 'cmd', value: v })).catch(console.error)
    setNewCmd('')
  }, [newCmd, add])

  const onAdd = useCallback(
    (sc: KommandsSavedCommand) => void addLinked(sc).catch(console.error),
    [addLinked],
  )

  const linkedCount = useMemo(() => items.filter((it) => it.link).length, [items])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (filter === 'linked' && !it.link) return false
      if (filter === 'attention' && it.link?.status !== 'changed' && it.link?.status !== 'broken')
        return false
      if (!q) return true
      return it.label.toLowerCase().includes(q) || it.value.toLowerCase().includes(q)
    })
  }, [items, search, filter])

  // Reordering writes positions into one flat ordered array, so dragging inside
  // a filtered subset would move a row to an index that means something else
  // entirely. Disabled rather than silently wrong.
  const canReorder = search.trim() === '' && filter === 'all'

  const onMove = useCallback(
    (from: number, to: number) => void reorder(from, to).catch(console.error),
    [reorder],
  )
  const sortable = useSortable({ count: items.length, axis: 'y', disabled: !canReorder, onMove })

  // Group headers only once there is more than one group to tell apart. A
  // single "Ungrouped" heading over the whole list said nothing and cost a
  // line; nothing in the UI creates a group yet, so this is the usual state.
  const showGroups = useMemo(() => new Set(visible.map((it) => it.group || '')).size > 1, [visible])

  return (
    <div className="lazy-panel-in flex h-full flex-col">
      <div className="border-border-subtle flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <span className="text-text-primary text-sm font-semibold">Commands</span>
        <span className="text-text-faint -ml-1 text-xs">
          {items.length}
          {linkedCount > 0 && ` · ${linkedCount} linked`}
        </span>

        <div className="relative w-40">
          <Icon
            icon={Search}
            size="xs"
            className="text-text-faint absolute top-1/2 left-2 -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search commands"
            className="border-border-subtle bg-hover text-text-primary placeholder-text-faint focus:border-border-hover h-6 w-full rounded border px-2 pl-7 text-xs transition-colors outline-none"
          />
        </div>

        <Segmented options={FILTERS} value={filter} onChange={setFilter} compact />
      </div>

      {error && (
        <div role="alert" className="text-danger border-border-subtle border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {visible.length === 0 ? (
            <div className="text-text-faint flex h-full items-center justify-center text-xs">
              {items.length === 0 ? 'No commands yet. Add one on the right.' : 'Nothing matches.'}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {visible.map((item, i) => {
                // Positions are indices into the full array. With no search and
                // no filter the two lists are the same, which is the only time
                // reordering is on.
                const index = canReorder ? i : items.indexOf(item)
                const group = item.group || ''
                const header = showGroups && (i === 0 || (visible[i - 1].group || '') !== group)
                return (
                  <Fragment key={item.id}>
                    {header && (
                      <div className="text-text-faint text-2xs mt-3 mb-0.5 tracking-wide uppercase first:mt-0">
                        {group || UNGROUPED}
                      </div>
                    )}
                    <CommandRow
                      item={item}
                      canReorder={canReorder}
                      lift={
                        sortable.drag?.from === index
                          ? { dx: sortable.drag.dx, dy: sortable.drag.dy }
                          : null
                      }
                      shift={sortable.shift(index)}
                      rowRef={sortable.rowRef(index)}
                      handleProps={sortable.handleProps(index)}
                      lifecycleBusy={lifecycle.busy !== null}
                      onRun={() => run(item)}
                      onEdit={(patch) => void update(item.id, patch).catch(console.error)}
                      onRemove={() => void remove(item.id).catch(console.error)}
                      onDuplicate={() => void duplicate(item.id).catch(console.error)}
                      onAcknowledge={() => void acknowledge(item.id).catch(console.error)}
                      onUnlink={() => void unlink(item.id).catch(console.error)}
                    />
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-border-subtle flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l px-3 py-3">
          <div className="flex flex-col gap-2">
            <span className="text-text-secondary text-xs font-semibold">Add a command</span>
            <div className="relative">
              <input
                type="text"
                value={newCmd}
                onChange={(e) => setNewCmd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                placeholder="say Hello"
                className="border-border-subtle bg-hover text-text-primary placeholder-text-faint focus:border-border-hover w-full rounded border px-2 py-1.5 pr-7 font-mono text-xs transition-colors outline-none"
              />
              <button
                onClick={addCustom}
                aria-label="Add command"
                className="text-text-muted hover:text-text-primary absolute top-1/2 right-1.5 -translate-y-1/2 transition-colors"
              >
                <Icon icon={Plus} size="xs" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => void add(makeItem(p)).catch(console.error)}
                  title={p.value}
                  className="border-border-subtle text-text-secondary hover:border-border-hover hover:bg-hover hover:text-text-primary truncate rounded border px-2 py-1 text-left text-xs transition-all"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <KommandsPanel status={kommands} saved={saved} items={items} onAdd={onAdd} />
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
