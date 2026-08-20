import { create } from 'zustand'
import type { ServerStatus, Player } from '../types'

interface ServerStore {
  status: ServerStatus
  /**
   * Whether the last status fetch or push actually reached the backend.
   *
   * Separate from `status.running`, which answers a different question: a
   * stopped server is reachable and reports `running: false`, while an
   * unreachable backend reports nothing at all and leaves `status` holding
   * whatever was last known. Tiles that render "nothing here" need to tell those
   * two apart or they show an unreachable server as a healthy, idle one
   * (HEALTH_LOG.md, 2026-08-20).
   *
   * Optimistic at startup: `true` until a call actually fails, so the UI does
   * not flash an error banner during the first fetch.
   */
  reachable: boolean
  players: Player[]
  setStatus: (status: ServerStatus) => void
  setReachable: (reachable: boolean) => void
  setPlayers: (players: Player[]) => void
}

const defaultStatus: ServerStatus = {
  running: false,
  uptime: '0s',
  players: 0,
  maxPlayers: 20,
  tps: 20,
  ramUsed: 0,
  ramTotal: 2048,
}

export const useServerStore = create<ServerStore>((set) => ({
  status: defaultStatus,
  reachable: true,
  players: [],
  setStatus: (status) => set({ status }),
  setReachable: (reachable) => set({ reachable }),
  setPlayers: (players) => set({ players }),
}))
