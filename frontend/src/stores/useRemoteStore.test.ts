import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useRemoteStore } from './useRemoteStore'
import type { RemoteAccessState } from './useRemoteStore'
import { models } from '../../wailsjs/go/models'

vi.mock('../../wailsjs/go/main/App')

// The generated class, as the binding returns it.
const state = (over: Partial<RemoteAccessState> = {}): models.RemoteAccessState =>
  models.RemoteAccessState.createFrom({
    passwordSet: true,
    running: true,
    addr: '127.0.0.1:54321',
    clients: 0,
    devices: [],
    pendingDevices: [],
    approvals: [],
    tunnel: { status: 'off', url: '', error: '', percent: 0, version: '2026.9.3' },
    ...over,
  })

const initial = useRemoteStore.getState()

describe('useRemoteStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRemoteStore.setState({ ...initial, loaded: false, error: null })
    vi.mocked(App.GetRemoteAccessState).mockResolvedValue(state())
    for (const fn of [
      App.SetRemotePassword,
      App.StartRemoteAccess,
      App.StopRemoteAccess,
      App.StartRemoteTunnel,
      App.StopRemoteTunnel,
      App.ApproveRemoteDevice,
      App.DenyRemoteDevice,
      App.RemoveRemoteDevice,
      App.RevokeRemoteSessions,
      App.AnswerRemoteApproval,
    ]) {
      vi.mocked(fn).mockResolvedValue(undefined)
    }
  })

  it('starts with the tunnel off', () => {
    expect(initial.access.tunnel.status).toBe('off')
  })

  it('refresh stores the state and marks the store loaded', async () => {
    await useRemoteStore.getState().refresh()
    const s = useRemoteStore.getState()
    expect(s.access.addr).toBe('127.0.0.1:54321')
    expect(s.loaded).toBe(true)
    expect(s.error).toBeNull()
  })

  it('a failed refresh records the error and still marks the store loaded', async () => {
    vi.mocked(App.GetRemoteAccessState).mockRejectedValue(new Error('no backend'))
    await useRemoteStore.getState().refresh()
    const s = useRemoteStore.getState()
    expect(s.error).toBe('no backend')
    expect(s.loaded).toBe(true)
    expect(s.access.running).toBe(false)
  })

  const actions: [string, () => Promise<void>, () => unknown, unknown[]][] = [
    [
      'setPassword',
      () => useRemoteStore.getState().setPassword('correct horse'),
      () => App.SetRemotePassword,
      ['correct horse'],
    ],
    ['start', () => useRemoteStore.getState().start(), () => App.StartRemoteAccess, []],
    ['stop', () => useRemoteStore.getState().stop(), () => App.StopRemoteAccess, []],
    ['startTunnel', () => useRemoteStore.getState().startTunnel(), () => App.StartRemoteTunnel, []],
    ['stopTunnel', () => useRemoteStore.getState().stopTunnel(), () => App.StopRemoteTunnel, []],
    [
      'approveDevice',
      () => useRemoteStore.getState().approveDevice('r1', 'Phone'),
      () => App.ApproveRemoteDevice,
      ['r1', 'Phone'],
    ],
    [
      'denyDevice',
      () => useRemoteStore.getState().denyDevice('r1'),
      () => App.DenyRemoteDevice,
      ['r1'],
    ],
    [
      'removeDevice',
      () => useRemoteStore.getState().removeDevice('d1'),
      () => App.RemoveRemoteDevice,
      ['d1'],
    ],
    [
      'revokeSessions',
      () => useRemoteStore.getState().revokeSessions(),
      () => App.RevokeRemoteSessions,
      [],
    ],
    [
      'answerApproval',
      () => useRemoteStore.getState().answerApproval('a1', true),
      () => App.AnswerRemoteApproval,
      ['a1', true],
    ],
  ]

  it.each(actions)(
    '%s calls its binding and then re-reads the state',
    async (_n, run, binding, args) => {
      await run()
      expect(binding()).toHaveBeenCalledWith(...args)
      expect(App.GetRemoteAccessState).toHaveBeenCalledTimes(1)
      expect(useRemoteStore.getState().loaded).toBe(true)
    },
  )

  it.each(actions)(
    '%s records a refusal, rethrows and does not re-read',
    async (_n, run, binding) => {
      vi.mocked(binding() as typeof App.StartRemoteAccess).mockRejectedValue(new Error('refused'))
      await expect(run()).rejects.toThrow('refused')
      expect(useRemoteStore.getState().error).toBe('refused')
      expect(App.GetRemoteAccessState).not.toHaveBeenCalled()
    },
  )

  it('clears the error when the next action starts', async () => {
    useRemoteStore.setState({ error: 'old refusal' })
    await useRemoteStore.getState().start()
    expect(useRemoteStore.getState().error).toBeNull()
  })
})
