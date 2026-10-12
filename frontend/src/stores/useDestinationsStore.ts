import { create } from 'zustand'
import { errMsg } from '../lib/ipc'
import {
  DeleteDestination,
  ListDestinations,
  SaveDestination,
  TestDestination,
} from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'

export type Destination = models.Destination
export type DestinationTestResult = models.DestinationTestResult

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
  }
})
