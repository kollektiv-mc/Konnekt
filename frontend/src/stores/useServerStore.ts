import { create } from 'zustand'
import type { ServerStatus, Player } from '../types'

interface ServerStore {
  status: ServerStatus
  /**
   * Whether the last status fetch or push actually reached the backend.
   *
   * Three axes, three different questions: `reachable` says the backend
   * answered at all, `status.running` says a live server process exists (true
   * through starting, running and stopping), and `status.state` refines that
   * into the lifecycle phase (offline | starting | running | stopping, #108).
   * A stopped server is reachable and reports `running: false`, while an
   * unreachable backend reports nothing at all and leaves `status` holding
   * whatever was last known. Tiles that render "nothing here" need to tell those
   * apart or they show an unreachable server as a healthy, idle one
   * (HEALTH_LOG.md, 2026-08-20).
   *
   * Optimistic at startup: `true` until a call actually fails, so the UI does
   * not flash an error banner during the first fetch.
   */
  reachable: boolean
  players: Player[]
  setStatus: (status: ServerStatus) => void
  /**
   * Applies a server:state push. It carries the phase and whose it is, and
   * both are needed: the sidebar has to light the right row on the starting
   * transition rather than waiting up to a full status tick to learn which
   * server the phase belongs to.
   */
  setServerState: (state: string, serverId: string) => void
  setReachable: (reachable: boolean) => void
  setPlayers: (players: Player[]) => void
}

const defaultStatus: ServerStatus = {
  running: false,
  state: 'offline',
  serverId: '',
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
  setServerState: (state, serverId) => set((s) => ({ status: { ...s.status, state, serverId } })),
  setReachable: (reachable) => set({ reachable }),
  setPlayers: (players) => set({ players }),
}))
