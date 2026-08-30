import { create } from 'zustand'
import {
  GetCommandButtons,
  GetCustomCommands,
  GetKommandsCommands,
  RefreshKommands,
  SaveCommandButtons,
} from '../../wailsjs/go/main/App'
import { models } from '../../wailsjs/go/models'
import { errMsg, hasWailsBridge, readOr } from '../lib/ipc'
import { DEFAULT_LABELS, PRESETS, arrayMove, makeItem } from '../components/commands/presets'

export type CommandButton = models.CommandButton
export type KommandsStatus = models.KommandsStatus
export type KommandsSavedCommand = models.KommandsSavedCommand

interface CommandsStore {
  items: CommandButton[]
  kommands: KommandsStatus | null
  /** What Kommands has saved, for the library's "link this to that" list. */
  saved: KommandsSavedCommand[]
  hydrated: boolean
  loading: boolean
  error: string | null

  hydrate: () => Promise<void>
  refreshKommands: () => Promise<void>
  /** Re-read after the backend changed the list under us (a Kommands update). */
  reload: () => Promise<void>

  save: (next: CommandButton[]) => Promise<void>
  add: (item: CommandButton) => Promise<void>
  remove: (id: string) => Promise<void>
  reorder: (from: number, to: number) => Promise<void>
  update: (id: string, patch: Partial<CommandButton>) => Promise<void>

  /** Bind a button to one of Kommands' saved commands. */
  linkTo: (id: string, saved: KommandsSavedCommand) => Promise<void>
  /** Drop the link, keep the button. */
  unlink: (id: string) => Promise<void>
  /** Clear the changed badge, keeping the applied value. */
  acknowledge: (id: string) => Promise<void>
  /** Put back what the last applied update replaced, and unlink. */
  revert: (id: string) => Promise<void>
}

/**
 * The Commands tile's button list.
 *
 * This is a store rather than component state for a reason that only appears
 * once the tile is maximizable: Dashboard renders the maximized copy of a tile
 * *in addition to* the grid copy, so the component is mounted twice at the same
 * time. Two `useState` lists would diverge the moment either one was edited,
 * and the console tile embeds the same panel as a third mount on top of that.
 *
 * Write actions follow the convention in agent_docs/CLAUDE.md: they apply
 * optimistically, and on a real rejection they revert, record the message and
 * rethrow so the caller can react. `hasWailsBridge()` is what separates a real
 * rejection from the browser-only `frontend-dev` preset, where every binding
 * throws because there is no Go process and reverting would make the preview
 * read-only.
 */
export const useCommandsStore = create<CommandsStore>((set, get) => ({
  items: [],
  kommands: null,
  saved: [],
  hydrated: false,
  loading: false,
  error: null,

  /**
   * Idempotent, for the same double-mount reason as useSchedulerStore.hydrate:
   * the guard is sound because the `set` below runs synchronously, before the
   * first `await`. A failure leaves `hydrated` false so the next mount retries
   * once, without a retry loop.
   */
  hydrate: async () => {
    if (get().hydrated || get().loading) return
    set({ loading: true, error: null })
    try {
      const stored = await GetCommandButtons()
      if (stored?.seeded) {
        set({ items: stored.items ?? [], loading: false, hydrated: true })
      } else {
        // No file has ever been written, so this is a first launch. Seeded is
        // what makes that distinguishable from a user who deleted every button:
        // the old empty-string check could not tell them apart and would have
        // resurrected the defaults.
        set({ items: await seedDefaults(), loading: false, hydrated: true })
      }
    } catch (e) {
      // Keep whatever is on screen; the tile renders the error beside it.
      set({ loading: false, error: errMsg(e) })
      return
    }
    await get().refreshKommands()
  },

  refreshKommands: async () => {
    // A read: degrade to "we know nothing" rather than surfacing an error. Not
    // having Kommands installed is the overwhelmingly common case and must not
    // read as something being wrong.
    //
    // Deliberately does NOT reload the items. The backend only rewrites them
    // when a link actually moved, and it says so by emitting commands:changed —
    // which useCommandsSync turns into a reload(). Re-reading on every focus
    // instead would race a save still in flight and put the old value back.
    const [kommands, saved] = await Promise.all([
      readOr(() => RefreshKommands(), null),
      readOr(() => GetKommandsCommands(), [] as KommandsSavedCommand[]),
    ])
    set({ kommands, saved: saved ?? [] })
  },

  reload: async () => {
    const stored = await readOr(() => GetCommandButtons(), null)
    if (stored?.seeded) set({ items: stored.items ?? [] })
  },

  save: async (next) => {
    const prev = get().items
    set({ items: next, error: null })
    try {
      await SaveCommandButtons(next)
    } catch (e) {
      if (!hasWailsBridge()) return
      set({ items: prev, error: errMsg(e) })
      throw e
    }
  },

  add: async (item) => get().save([...get().items, item]),

  remove: async (id) => get().save(get().items.filter((it) => it.id !== id)),

  reorder: async (from, to) => {
    if (from === to) return
    return get().save(arrayMove(get().items, from, to))
  },

  update: async (id, patch) =>
    get().save(
      get().items.map((it) =>
        it.id === id ? models.CommandButton.createFrom({ ...it, ...patch }) : it,
      ),
    ),

  linkTo: async (id, savedCmd) =>
    get().save(
      get().items.map((it) =>
        it.id === id
          ? models.CommandButton.createFrom({
              ...it,
              // The button takes the original's text immediately, so a fresh
              // link never starts out already disagreeing with its source.
              label: savedCmd.label || it.label,
              value: savedCmd.command,
              link: {
                source: 'kommands',
                id: savedCmd.id,
                revision: savedCmd.revision,
                status: 'ok',
                prevLabel: it.label,
                prevValue: it.value,
              },
            })
          : it,
      ),
    ),

  unlink: async (id) => get().save(get().items.map((it) => (it.id === id ? withoutLink(it) : it))),

  acknowledge: async (id) =>
    get().save(
      get().items.map((it) =>
        it.id === id && it.link
          ? // Only the badge clears. The applied value stays, and prevLabel /
            // prevValue stay with it so Revert is still available afterwards.
            models.CommandButton.createFrom({ ...it, link: { ...it.link, status: 'ok' } })
          : it,
      ),
    ),

  revert: async (id) =>
    get().save(
      get().items.map((it) => {
        if (it.id !== id || !it.link) return it
        // Reverting keeps the old text, which is by definition no longer what
        // Kommands says. Leaving the link attached would make the next poll
        // apply the same update again, so this unlinks too.
        return models.CommandButton.createFrom({
          ...withoutLink(it),
          label: it.link.prevLabel || it.label,
          value: it.link.prevValue || it.value,
        })
      }),
    ),
}))

/** A copy of `item` with no link, without mutating the original. */
function withoutLink(item: CommandButton): CommandButton {
  const next = models.CommandButton.createFrom({ ...item })
  delete next.link
  return next
}

/**
 * Build the first-launch button set: the default presets, plus anything the
 * pre-button-model `custom_commands.json` still holds.
 *
 * That legacy read is the only remaining use of GetCustomCommands. Its write
 * half was bound but never called from anywhere and has been removed.
 */
async function seedDefaults(): Promise<CommandButton[]> {
  const seed = PRESETS.filter((p) => DEFAULT_LABELS.has(p.label)).map(makeItem)
  const legacy = await readOr(() => GetCustomCommands(), [] as string[])
  for (const cmd of legacy) {
    if (cmd && cmd.trim()) seed.push(makeItem({ label: cmd, kind: 'cmd', value: cmd }))
  }
  // A write, so `hasWailsBridge()` rather than a bare `.catch()` (see lib/ipc.ts).
  // With no bridge the binding throws synchronously, past any `.catch()`, as an
  // unhandled rejection on every launch of the browser-only `frontend-dev`
  // preset. The seed is already applied and nothing was going to persist.
  if (hasWailsBridge()) {
    SaveCommandButtons(seed).catch(console.error)
  }
  return seed
}
