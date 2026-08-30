import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../components/ui/Icon'
import { Check, Plus, Search } from '../../../lib/icons'
import { KickBanDialog, LifecycleConfirmDialog } from '../../../components/commands/CommandDialogs'
import { PRESETS, makeItem } from '../../../components/commands/presets'
import { useLifecycle } from '../../../components/commands/useLifecycle'
import {
  useCommandsStore,
  type CommandButton,
  type KommandsSavedCommand,
} from '../../../stores/useCommandsStore'
import { useUiStore } from '../../../stores/useUiStore'
import { SendCommand } from '../../../../wailsjs/go/main/App'
import { CommandRow } from './CommandRow'
import { KommandsPanel } from './KommandsPanel'
import type { LibraryFilter } from '../types'

const UNGROUPED = 'Ungrouped'

/**
 * The maximized Commands tile: a command library rather than a button grid.
 *
 * The compact panel stays exactly as it was — it is what the console tile
 * embeds, and it is the right shape for firing a command. This is the other
 * half: managing a set of them, which a grid cell has never had room for, and
 * which becomes the blocker once commands can be authored in Kommands and
 * linked in here.
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
  const unlink = useCommandsStore((s) => s.unlink)
  const acknowledge = useCommandsStore((s) => s.acknowledge)
  const revert = useCommandsStore((s) => s.revert)
  const linkTo = useCommandsStore((s) => s.linkTo)

  const setCloseGuard = useUiStore((s) => s.setCloseGuard)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [newCmd, setNewCmd] = useState('')
  const [modal, setModal] = useState<'kick' | 'ban' | null>(null)
  const [forking, setForking] = useState<{ id: string; patch: Partial<CommandButton> } | null>(null)

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
  const dialogOpen = forking !== null || modal !== null || lifecycle.confirmAction !== null
  useEffect(() => {
    if (!dialogOpen) return
    setCloseGuard(() => {
      setForking(null)
      setModal(null)
      lifecycle.setConfirmAction(null)
      return true
    })
    return () => setCloseGuard(null)
  }, [dialogOpen, setCloseGuard, lifecycle])

  const send = useCallback(
    (cmd: string) => {
      SendCommand(serverId, cmd).catch(console.error)
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

  /**
   * Editing a linked row forks it. The confirm is not ceremony: the whole point
   * of a link is that the value tracks Kommands, so an edit here either loses
   * on the next poll or stops the link meaning anything. Forking makes the
   * choice explicit and keeps the edit.
   */
  const requestEdit = useCallback(
    (item: CommandButton, patch: Partial<CommandButton>) => {
      if (item.link) setForking({ id: item.id, patch })
      else void update(item.id, patch).catch(console.error)
    },
    [update],
  )

  const confirmFork = useCallback(() => {
    if (!forking) return
    const { id, patch } = forking
    setForking(null)
    void (async () => {
      await update(id, patch)
      await unlink(id)
    })().catch(console.error)
  }, [forking, update, unlink])

  const addCustom = useCallback(() => {
    const v = newCmd.trim()
    if (!v) return
    void add(makeItem({ label: v, kind: 'cmd', value: v })).catch(console.error)
    setNewCmd('')
  }, [newCmd, add])

  const onLink = useCallback(
    (item: CommandButton, savedCmd: KommandsSavedCommand) => {
      void linkTo(item.id, savedCmd).catch(console.error)
    },
    [linkTo],
  )

  const changedCount = kommands?.changedCount ?? 0

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

  const groups = useMemo(() => {
    const map = new Map<string, CommandButton[]>()
    for (const it of visible) {
      const key = it.group || UNGROUPED
      const list = map.get(key)
      if (list) list.push(it)
      else map.set(key, [it])
    }
    return [...map.entries()]
  }, [visible])

  const acknowledgeAll = useCallback(() => {
    void (async () => {
      for (const it of items) {
        if (it.link?.status === 'changed') await acknowledge(it.id)
      }
    })().catch(console.error)
  }, [items, acknowledge])

  return (
    <div className="lazy-panel-in flex h-full flex-col">
      <div className="border-border-subtle flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <span className="text-text-primary text-sm font-semibold">Commands</span>
        <span className="text-text-faint text-xs">{items.length}</span>

        <div className="relative ml-3 w-56">
          <Icon
            icon={Search}
            size="xs"
            className="text-text-faint absolute top-1/2 left-2 -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands"
            className="border-border-subtle bg-hover text-text-primary placeholder-text-faint focus:border-border-hover w-full rounded border px-2 py-1 pl-7 text-xs transition-colors outline-none"
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'linked', 'attention'] as LibraryFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded border px-2 py-1 text-xs capitalize transition-colors ${
                filter === f
                  ? 'border-border-hover bg-hover text-text-primary'
                  : 'border-border-subtle text-text-secondary hover:border-border-hover hover:text-text-primary'
              }`}
            >
              {f === 'attention' ? 'Needs attention' : f}
            </button>
          ))}
        </div>

        {changedCount > 0 && (
          <button
            onClick={acknowledgeAll}
            className="text-accent border-accent/30 bg-accent/10 border-hairline ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
          >
            <Icon icon={Check} size="xs" />
            Acknowledge {changedCount} update{changedCount === 1 ? '' : 's'}
          </button>
        )}
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
              {items.length === 0 ? 'No commands yet.' : 'Nothing matches that filter.'}
            </div>
          ) : (
            groups.map(([group, rows]) => (
              <div key={group} className="mb-4">
                <div className="text-text-faint text-2xs mb-1.5 tracking-wide uppercase">
                  {group}
                </div>
                <div className="flex flex-col gap-1">
                  {rows.map((item) => (
                    <CommandRow
                      key={item.id}
                      item={item}
                      index={items.indexOf(item)}
                      canReorder={canReorder}
                      lifecycleBusy={lifecycle.busy !== null}
                      onRun={() => run(item)}
                      onEdit={(patch) => requestEdit(item, patch)}
                      onRemove={() => void remove(item.id).catch(console.error)}
                      onReorder={(from, to) => void reorder(from, to).catch(console.error)}
                      onAcknowledge={() => void acknowledge(item.id).catch(console.error)}
                      onRevert={() => void revert(item.id).catch(console.error)}
                      onUnlink={() => void unlink(item.id).catch(console.error)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-border-subtle flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l px-3 py-3">
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

          <KommandsPanel status={kommands} saved={saved} items={items} onLink={onLink} />
        </div>
      </div>

      {forking && (
        <div className="modal-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="modal-panel-in border-border-subtle bg-canvas border-hairline flex w-96 flex-col gap-4 rounded-xl p-5">
            <div className="flex flex-col gap-1">
              <span className="text-text-primary text-sm font-semibold">
                Editing unlinks this command
              </span>
              <span className="text-text-secondary text-xs">
                It currently follows its original in Kommands. Keeping your edit means it stops
                following, so a later change over there will not reach it. The command itself is
                unaffected in Kommands.
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setForking(null)}
                className="text-text-muted hover:text-text-primary px-3 py-1.5 text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmFork}
                className="border-hairline border-border-hover bg-hover text-text-primary hover:border-border-hover rounded px-3 py-1.5 text-xs transition-colors"
              >
                Keep my edit, unlink
              </button>
            </div>
          </div>
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
