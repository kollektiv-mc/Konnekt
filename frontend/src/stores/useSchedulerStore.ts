import { create } from 'zustand'
import {
  GetScheduleGraphs,
  GetScheduleBlockDefs,
  GetScheduleNextRuns,
  SaveScheduleGraph,
  DeleteScheduleGraph,
  SetScheduleGraphEnabled,
  RunScheduleGraphNow,
  PreviewScheduleNode,
} from '../../wailsjs/go/main/App'
import { models } from '../../wailsjs/go/models'
import { errMsg } from '../lib/ipc'

/**
 * Scheduler domain state, extracted from the scheduler tile's local `useState`
 * per CLAUDE.md's one-Zustand-store-per-domain rule.
 *
 * This store established the two patterns every store in this folder now
 * follows (it was the only one that did until 2026-08-20 — see HEALTH_LOG.md):
 *
 * 1. `error` — a real error surface, because a dead bridge is otherwise
 *    indistinguishable from "no graphs configured". A shared `useWailsCall()`
 *    hook used to be nominated for this; a store can't call a React hook, which
 *    is part of why it was removed.
 * 2. Write actions rethrow after recording `error`, so `GraphEditor` can revert
 *    its optimistic UI (a failed enable toggle used to leave the switch lying).
 *
 * One difference remains, and it is deliberate: the other stores skip the
 * revert when `hasWailsBridge()` is false, so the browser-only `frontend-dev`
 * preview stays usable. The scheduler has nothing to keep optimistically —
 * every write here goes to the backend and comes back authoritative — so it
 * treats a no-bridge rejection as the failure it is.
 *
 * Event subscription deliberately lives in the `useScheduler` hook, not here:
 * no store in this folder imports React or the Wails runtime, and a listener
 * here would need module-level refcounting to unsubscribe.
 */
interface SchedulerStore {
  graphs: models.Graph[]
  blockDefs: models.BlockDef[]
  nextRuns: Record<string, number>
  /** Hydration in flight. Mutations are tracked locally by GraphEditor. */
  loading: boolean
  /** First successful hydration completed — the idempotency latch. */
  hydrated: boolean
  error: string | null

  hydrate: () => Promise<void>
  setNextRuns: (runs: Record<string, number> | null | undefined) => void
  clearError: () => void

  saveGraph: (g: models.Graph) => Promise<models.Graph>
  deleteGraph: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runGraph: (id: string) => Promise<models.RunRecord>
  previewNode: (g: models.Graph, nodeId: string) => Promise<models.NodePreview>
}

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  graphs: [],
  blockDefs: [],
  nextRuns: {},
  loading: false,
  hydrated: false,
  error: null,

  /**
   * Idempotent: the tile is mounted twice while maximized (Dashboard renders
   * the maximized copy *in addition to* the grid one), and StrictMode
   * double-mounts on top of that. The guard is sound because the `set` below
   * runs synchronously, before the first `await`.
   *
   * `Promise.all` is fail-fast, so one failing binding discards the other two
   * responses — acceptable, since the realistic failure is "no bridge", where
   * all three fail together. A failure leaves `hydrated` false so the next
   * mount retries once; there's no retry loop.
   */
  hydrate: async () => {
    if (get().hydrated || get().loading) return
    set({ loading: true, error: null })
    try {
      const [graphs, blockDefs, nextRuns] = await Promise.all([
        GetScheduleGraphs(),
        GetScheduleBlockDefs(),
        GetScheduleNextRuns(),
      ])
      set({
        graphs: graphs ?? [],
        blockDefs: blockDefs ?? [],
        nextRuns: nextRuns ?? {},
        loading: false,
        hydrated: true,
      })
    } catch (e) {
      // Keep last-good state; the tile renders cached graphs alongside the error.
      set({ loading: false, error: errMsg(e) })
    }
  },

  /**
   * Always sets a fresh object — never short-circuit on deep equality. A
   * timeOfDay graph's epoch is constant while its rendered countdown ("in 2h" →
   * "in 1h") is not, and SchedulerSummary only re-renders when `nextRuns`
   * changes identity. An equality check here would freeze the countdown.
   */
  setNextRuns: (runs) => set({ nextRuns: { ...(runs ?? {}) } }),

  clearError: () => set({ error: null }),

  // Writes mutate local state from the backend's response rather than
  // refetching: SaveScheduleGraph already returns the authoritative graph, and a
  // refetch would add a round trip plus an ambiguous "write succeeded, refetch
  // failed" state. The backend emits schedule:next-runs after each mutator, so
  // the countdown corrects itself.
  saveGraph: async (g) => {
    set({ error: null })
    try {
      const saved = await SaveScheduleGraph(g)
      set((s) => {
        const idx = s.graphs.findIndex((x) => x.id === saved.id)
        return {
          graphs: idx >= 0 ? s.graphs.map((x, i) => (i === idx ? saved : x)) : [...s.graphs, saved],
        }
      })
      return saved
    } catch (e) {
      set({ error: errMsg(e) })
      throw e
    }
  },

  deleteGraph: async (id) => {
    set({ error: null })
    try {
      await DeleteScheduleGraph(id)
      set((s) => ({ graphs: s.graphs.filter((g) => g.id !== id) }))
    } catch (e) {
      set({ error: errMsg(e) })
      throw e
    }
  },

  setEnabled: async (id, enabled) => {
    set({ error: null })
    try {
      await SetScheduleGraphEnabled(id, enabled)
      // SetScheduleGraphEnabled returns no graph, so mirror the two fields Go
      // touches. createFrom keeps the result a real models.Graph instance.
      set((s) => ({
        graphs: s.graphs.map((g) =>
          g.id === id ? models.Graph.createFrom({ ...g, enabled, updatedAt: Date.now() }) : g,
        ),
      }))
    } catch (e) {
      set({ error: errMsg(e) })
      throw e
    }
  },

  runGraph: async (id) => {
    set({ error: null })
    try {
      return await RunScheduleGraphNow(id)
    } catch (e) {
      set({ error: errMsg(e) })
      throw e
    }
  },

  // Pass-through by design: NodeDataPanel owns preview errors locally, and they
  // are per-node-selection noise that shouldn't raise a tile-wide banner.
  previewNode: (g, nodeId) => PreviewScheduleNode(g, nodeId),
}))
