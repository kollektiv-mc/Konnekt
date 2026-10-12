import { create } from 'zustand'
import { errMsg } from '../lib/ipc'
import {
  DeleteDestination,
  GetSnapshotLink,
  ListDestinations,
  RotateSnapshotLink,
  SaveDestination,
  SetSnapshotLinkPrivate,
  TestDestination,
} from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'

export type Destination = models.Destination
export type DestinationTestResult = models.DestinationTestResult
export type SnapshotLinkResult = models.SnapshotLinkResult

interface DestinationsStore {
  /** The saved buckets. Each says whether a secret is stored (`secretSet`); the secret itself never arrives here. */
  destinations: Destination[]
  /** False until the first read has answered, so a pane can tell "none" from "not known yet". */
  loaded: boolean
  loading: boolean
  /** The last read or action the backend refused. Cleared by the next one. */
  error: string | null

  refresh: () => Promise<void>
  /**
   * `secret` is the only way a secret leaves the form, and only to the backend.
   * A blank one keeps the stored secret. Returns the saved destination.
   */
  save: (destination: Destination, secret: string) => Promise<Destination>
  remove: (id: string) => Promise<void>
  /** A verdict in words; a blank `secret` tests with the stored one. Writes nothing to the bucket. */
  test: (destination: Destination, secret: string) => Promise<DestinationTestResult>
  /**
   * The destination's snapshot link (#561), for a click on Copy link. The link
   * carries the private token, so it is returned to the caller and never kept
   * here: this store holds the mode (`privateLink`) and nothing more.
   */
  getSnapshotLink: (id: string) => Promise<SnapshotLinkResult>
  /** Moves the published snapshot to the other layout, then reads the list back. Takes minutes. */
  setSnapshotLinkPrivate: (id: string, isPrivate: boolean) => Promise<SnapshotLinkResult>
  /** Gives a private link a new token, then reads the list back. Takes minutes. */
  rotateSnapshotLink: (id: string) => Promise<SnapshotLinkResult>
}

/**
 * The saved bucket destinations (#480). Nothing is optimistic: a destination
 * holds a credential, so the list shows what the backend says it stored and not
 * what was asked for. A refusal is recorded in `error` and rethrown, so the form
 * stays open (`.claude/rules/ipc.md`).
 */
export const useDestinationsStore = create<DestinationsStore>((set, get) => {
  const act = async <T>(call: () => Promise<T>): Promise<T> => {
    set({ error: null })
    try {
      return await call()
    } catch (e) {
      set({ error: errMsg(e) })
      throw e
    }
  }

  return {
    destinations: [],
    loaded: false,
    loading: false,
    error: null,

    refresh: async () => {
      set({ loading: true, error: null })
      try {
        const destinations = await ListDestinations()
        set({ destinations, loaded: true, loading: false })
      } catch (e) {
        set({ error: errMsg(e), loaded: true, loading: false })
      }
    },

    save: async (destination, secret) => {
      const saved = await act(() => SaveDestination(destination, secret))
      await get().refresh()
      return saved
    },

    remove: async (id) => {
      await act(() => DeleteDestination(id))
      await get().refresh()
    },

    test: (destination, secret) => act(() => TestDestination(destination, secret)),

    getSnapshotLink: (id) => act(() => GetSnapshotLink(id)),

    setSnapshotLinkPrivate: async (id, isPrivate) => {
      const result = await act(() => SetSnapshotLinkPrivate(id, isPrivate))
      await get().refresh()
      return result
    },

    rotateSnapshotLink: async (id) => {
      const result = await act(() => RotateSnapshotLink(id))
      await get().refresh()
      return result
    },
  }
})
