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
import {
  DEFAULT_LABELS,
  PRESETS,
  arrayMove,
  copyOf,
  makeItem,
} from '../components/commands/presets'

export type CommandButton = models.CommandButton
export type KommandsStatus = models.KommandsStatus
export type KommandsSavedCommand = models.KommandsSavedCommand

interface CommandsStore {
  items: CommandButton[]
  kommands: KommandsStatus | null
  /** What Kommands has linked, for the library's list of what can be added. */
  saved: KommandsSavedCommand[]
  hydrated: boolean
  loading: boolean
  error: string | null

  hydrate: () => Promise<void>
  refreshKommands: () => Promise<void>
  /** Re-read after the backend changed the list under us (a Kommands sync). */
  reload: () => Promise<void>

  save: (next: CommandButton[]) => Promise<void>
  add: (item: CommandButton) => Promise<void>
  remove: (id: string) => Promise<void>
  reorder: (from: number, to: number) => Promise<void>
  update: (id: string, patch: Partial<CommandButton>) => Promise<void>

  /** Add a button that follows one of Kommands' linked commands. */
  addLinked: (saved: KommandsSavedCommand) => Promise<void>
  /** Insert an unlinked copy of a button right after it. */
  duplicate: (id: string) => Promise<void>
  /** Drop the link, keep the button as a plain command of this server's own. */
  unlink: (id: string) => Promise<void>
  /** Clear the changed badge, keeping the applied value. */
  acknowledge: (id: string) => Promise<void>
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
 * A linked button starts here, from `addLinked`: Kommands decides which of its
 * saved commands are linked (that is the list in `saved`), and the user decides
 * which of those become buttons. From then on Go keeps the button in step with
 * its original (CommandsService.SyncLinks) and says so through
 * `commands:changed`, which `useCommandsSync` turns into a `reload`. Its label
 * and text are Kommands', so what this side offers on it is to acknowledge an
 * update, keep it as its own once the original is gone, or take a copy.
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
        set({ items: await seedDefaults(set), loading: false, hydrated: true })
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
      if (hasWailsBridge()) {
        set({ items: prev, error: errMsg(e) })
        throw e
      }
      // No bridge: the browser-only preview keeps the optimistic value.
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

  addLinked: async (savedCmd) =>
    get().add(
      models.CommandButton.createFrom({
        ...makeItem({ label: savedCmd.label, kind: 'cmd', value: savedCmd.command }),
        // The link agrees with its original from the first moment, so the
        // next poll has nothing to apply and nothing to badge.
        link: {
          source: 'kommands',
          id: savedCmd.id,
          revision: savedCmd.revision,
          status: 'ok',
        },
      }),
    ),

  duplicate: async (id) => {
    const items = get().items
    const at = items.findIndex((it) => it.id === id)
    if (at === -1) return
    // Right after its source rather than at the end, so the copy lands where
    // the eye already is.
    return get().save([...items.slice(0, at + 1), copyOf(items[at]), ...items.slice(at + 1)])
  },

  unlink: async (id) => get().save(get().items.map((it) => (it.id === id ? withoutLink(it) : it))),

  acknowledge: async (id) =>
    get().save(
      get().items.map((it) =>
        it.id === id && it.link
          ? // Only the badge clears. The applied value stays.
            models.CommandButton.createFrom({ ...it, link: { ...it.link, status: 'ok' } })
          : it,
      ),
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
async function seedDefaults(
  set: (partial: Partial<CommandsStore>) => void,
): Promise<CommandButton[]> {
  const seed = PRESETS.filter((p) => DEFAULT_LABELS.has(p.label)).map(makeItem)
  const legacy = await readOr(() => GetCustomCommands(), [] as string[])
  for (const cmd of legacy) {
    if (cmd && cmd.trim()) seed.push(makeItem({ label: cmd, kind: 'cmd', value: cmd }))
  }
  // A write, so `hasWailsBridge()` rather than a bare `.catch()` (see lib/ipc.ts).
  // With no bridge the binding throws synchronously, past any `.catch()`, as an
  // unhandled rejection on every launch of the browser-only `frontend-dev`
  // preset. The seed is already applied and nothing was going to persist.
  //
  // Awaited, because hydrate asks Kommands to sync right after this: Go only
  // syncs into a seeded file, so a seed still in flight would leave whatever
  // is linked in Kommands off the first launch's list until the next focus.
  //
  // Recorded, not rethrown, and this is the one write in the store that does
  // not: the seed is the first-launch default set and the tile shows it either
  // way, so there is nothing to revert into. What a failed write costs is the
  // Kommands sync (Go only syncs into a seeded file) until the next launch
  // re-seeds or the first edit rewrites the whole set. The tile renders
  // `error` beside the buttons, which is how the user learns the write did
  // not land; a console line would die with the window.
  if (hasWailsBridge()) {
    try {
      await SaveCommandButtons(seed)
    } catch (e) {
      set({ error: errMsg(e) })
    }
  }
  return seed
}
