import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useLoaderStore } from './useLoaderStore'
import type { LoaderStatus, LoaderVersion } from './useLoaderStore'

vi.mock('../../wailsjs/go/main/App')

const status = (over: Partial<LoaderStatus> = {}): LoaderStatus =>
  ({
    loader: 'neoforge',
    installedVersion: '21.1.72',
    mcVersion: '1.21.1',
    source: 'script',
    managed: true,
    reason: '',
    ...over,
  }) as LoaderStatus

const version = (v: string, over: Partial<LoaderVersion> = {}): LoaderVersion =>
  ({ version: v, mcVersion: '1.21.1', stable: true, latest: false, ...over }) as LoaderVersion

// jsdom has no window.go, so `hasWailsBridge()` is false by default — the
// `frontend-dev` preview case. Attach a stub for the real-rejection path.
const attachBridge = () => Object.assign(window, { go: {} })

describe('useLoaderStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(App.GetLoaderStatus).mockResolvedValue(status())
    vi.mocked(App.ListLoaderVersions).mockResolvedValue([version('21.1.209'), version('21.1.72')])
    vi.mocked(App.UpdateLoader).mockResolvedValue(undefined)
    useLoaderStore.setState({
      status: null,
      versions: [],
      loading: false,
      error: null,
      phase: 'idle',
      log: [],
      updateError: null,
      rolledBack: false,
    })
  })

  afterEach(() => {
    delete (window as { go?: unknown }).go
  })

  it('loads status and versions', async () => {
    await useLoaderStore.getState().load('srv1')
    const s = useLoaderStore.getState()
    expect(s.status?.installedVersion).toBe('21.1.72')
    expect(s.versions).toHaveLength(2)
    expect(s.loading).toBe(false)
  })

  // Asking for a version list Konnekt cannot use produces an error the user can
  // do nothing about, so an unmanaged loader does not ask.
  it('does not list versions for an unmanaged loader', async () => {
    vi.mocked(App.GetLoaderStatus).mockResolvedValue(
      status({ managed: false, reason: 'Konnekt cannot update paper servers yet.' }),
    )
    await useLoaderStore.getState().load('srv1')
    expect(App.ListLoaderVersions).not.toHaveBeenCalled()
    expect(useLoaderStore.getState().status?.reason).toContain('paper')
  })

  it('records a failed version fetch without losing the status', async () => {
    vi.mocked(App.ListLoaderVersions).mockRejectedValue('maven is unreachable')
    await useLoaderStore.getState().load('srv1')
    const s = useLoaderStore.getState()
    expect(s.error).toContain('maven is unreachable')
    expect(s.status?.installedVersion).toBe('21.1.72')
    expect(s.loading).toBe(false)
  })

  // The backend refuses synchronously for things it can judge up front, and
  // that message is the one worth showing immediately.
  it('surfaces a refused update and rethrows', async () => {
    attachBridge()
    vi.mocked(App.UpdateLoader).mockRejectedValue('stop the server before updating its loader')

    await expect(useLoaderStore.getState().startUpdate('srv1', '21.1.209', false)).rejects.toBe(
      'stop the server before updating its loader',
    )
    const s = useLoaderStore.getState()
    expect(s.phase).toBe('failed')
    expect(s.updateError).toContain('stop the server')
  })

  it('passes the full-backup choice through', async () => {
    await useLoaderStore.getState().startUpdate('srv1', '21.1.209', true)
    expect(App.UpdateLoader).toHaveBeenCalledWith({
      serverId: 'srv1',
      version: '21.1.209',
      fullBackup: true,
    })
  })

  // The outcome does not come back from the call — it arrives later as an
  // event, which is what these two setters are for.
  it('settles on the event, not on the call', async () => {
    await useLoaderStore.getState().startUpdate('srv1', '21.1.209', false)
    expect(useLoaderStore.getState().phase).toBe('running')

    useLoaderStore.getState().finishUpdate()
    expect(useLoaderStore.getState().phase).toBe('done')
  })

  it('records a failure and whether it rolled back', () => {
    useLoaderStore.getState().failUpdate('the installer exited 1', true)
    const s = useLoaderStore.getState()
    expect(s.phase).toBe('failed')
    expect(s.updateError).toBe('the installer exited 1')
    expect(s.rolledBack).toBe(true)
  })

  it('caps the log rather than growing without bound', () => {
    const { appendLog } = useLoaderStore.getState()
    for (let i = 0; i < 600; i++) appendLog(`line ${i}`)
    const { log } = useLoaderStore.getState()
    expect(log).toHaveLength(500)
    expect(log[log.length - 1]).toBe('line 599')
  })

  it('reset clears the previous run so a second update starts clean', () => {
    useLoaderStore.getState().failUpdate('boom', true)
    useLoaderStore.getState().appendLog('noise')
    useLoaderStore.getState().reset()

    const s = useLoaderStore.getState()
    expect(s.phase).toBe('idle')
    expect(s.log).toEqual([])
    expect(s.updateError).toBeNull()
    expect(s.rolledBack).toBe(false)
  })
})
