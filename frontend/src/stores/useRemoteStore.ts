import { create } from 'zustand'
import { errMsg } from '../lib/ipc'
import {
  AnswerRemoteApproval,
  ApproveRemoteDevice,
  DenyRemoteDevice,
  GetRemoteAccessState,
  RemoveRemoteDevice,
  RevokeRemoteSessions,
  SetRemotePassword,
  StartRemoteAccess,
  StopRemoteAccess,
} from '../../wailsjs/go/main/App'
import type { models } from '../../wailsjs/go/models'

export type RemoteAccessState = models.RemoteAccessState
export type RemoteDevice = models.RemoteDevice
export type RemotePendingDevice = models.RemotePendingDevice
export type RemoteApproval = models.RemoteApproval

/** Remote Access as a fresh install has it: off, no password, nobody known. */
const OFF = {
  passwordSet: false,
  running: false,
  addr: '',
  clients: 0,
  devices: [],
  pendingDevices: [],
  approvals: [],
} as unknown as RemoteAccessState

interface RemoteStore {
  /** What the desktop shows about Remote Access. The getter twin of `remote:changed`. */
  access: RemoteAccessState
  /** False until the first read has answered, so a pane can tell "off" from "not known yet". */
  loaded: boolean
  /** The last action the backend refused, or a failed read. Cleared by the next action. */
  error: string | null

  refresh: () => Promise<void>
  setPassword: (password: string) => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  approveDevice: (requestId: string, name: string) => Promise<void>
  denyDevice: (requestId: string) => Promise<void>
  removeDevice: (deviceId: string) => Promise<void>
  revokeSessions: () => Promise<void>
  answerApproval: (id: string, allow: boolean) => Promise<void>
}

/**
 * The desktop's side of Remote Access (#47): the listener's state, the devices
 * that may sign in, the ones waiting to, and the admin-tier calls waiting on a
 * yes. `hooks/useRemoteSync.ts` keeps it fresh from `remote:changed`; nothing
 * here subscribes.
 *
 * Nothing is optimistic. Every action is a decision about who may reach the
 * host, so the store shows what the backend says happened and not what was
 * asked for: an action awaits its call, then reads the state back. A refusal
 * is recorded in `error` and rethrown, so the caller keeps its form open
 * (`.claude/rules/ipc.md`).
 *
 * A browser served by the listener never mounts any of this: every method
 * below is one a remote client cannot call (`remote_methods.go`).
 */
export const useRemoteStore = create<RemoteStore>((set, get) => {
  const act = async (call: () => Promise<void>) => {
    set({ error: null })
    try {
      await call()
    } catch (e) {
      set({ error: errMsg(e) })
      throw e
    }
    await get().refresh()
  }

  return {
    access: OFF,
    loaded: false,
    error: null,

    refresh: async () => {
      try {
        const access = await GetRemoteAccessState()
        set({ access, loaded: true })
      } catch (e) {
        set({ error: errMsg(e), loaded: true })
      }
    },

    setPassword: (password) => act(() => SetRemotePassword(password)),
    start: () => act(() => StartRemoteAccess()),
    stop: () => act(() => StopRemoteAccess()),
    approveDevice: (requestId, name) => act(() => ApproveRemoteDevice(requestId, name)),
    denyDevice: (requestId) => act(() => DenyRemoteDevice(requestId)),
    removeDevice: (deviceId) => act(() => RemoveRemoteDevice(deviceId)),
    revokeSessions: () => act(() => RevokeRemoteSessions()),
    answerApproval: (id, allow) => act(() => AnswerRemoteApproval(id, allow)),
  }
})
