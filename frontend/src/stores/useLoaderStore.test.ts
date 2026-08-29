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

const srv = { id: 'srv1', name: 'smp' }

// jsdom has no window.go, so `hasWailsBridge()` is false by default — the
// `frontend-dev` preview case. Attach a stub for the real-rejection path.
const attachBridge = () => Object.assign(window, { go: {} })

/** Puts the store in the state a live update leaves it in. */
function withRunningJob(logLines = ['downloading…']) {
  useLoaderStore.getState().jobStarted({ serverId: 'srv1', from: '21.1.72', to: '21.1.209' })
  for (const line of logLines) useLoaderStore.getState().appendLog(line)
}

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
      jobServerId: '',
      jobFrom: '',
      jobTarget: '',
      dialogOpen: false,
      pending: null,
      startError: null,
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

  describe('the job belongs to the backend', () => {
    // The event is the only thing that knows a job exists, and it says which.
    it('takes its identity from the started event', () => {
      useLoaderStore.getState().jobStarted({ serverId: 'srv1', from: '21.1.72', to: '21.1.209' })
      const s = useLoaderStore.getState()
      expect(s.phase).toBe('running')
      expect(s.jobServerId).toBe('srv1')
      expect(s.jobFrom).toBe('21.1.72')
      expect(s.jobTarget).toBe('21.1.209')
      expect(s.log).toEqual([])
    })

    // The bug this whole split exists for: a later selection must not be able
    // to rename the job that finishes.
    it('reports the version that ran, not one picked afterwards', () => {
      withRunningJob()
      useLoaderStore.getState().openUpdate(srv, '21.1.72', version('21.1.100'))
      useLoaderStore.getState().finishUpdate()

      const s = useLoaderStore.getState()
      expect(s.phase).toBe('done')
      expect(s.jobTarget).toBe('21.1.209')
    })

    it('starting a job clears a pending selection', () => {
      useLoaderStore.getState().openUpdate(srv, '21.1.72', version('21.1.209'))
      useLoaderStore.getState().jobStarted({ serverId: 'srv1', from: '21.1.72', to: '21.1.209' })
      expect(useLoaderStore.getState().pending).toBeNull()
    })
  })

  describe('a second update cannot clobber the running one', () => {
    // Picking another version used to wipe the log here, before any refusal —
    // so even opening the confirm and cancelling corrupted the live update.
    it('openUpdate leaves a running job untouched and shows it', () => {
      withRunningJob(['downloading…', 'unpacking…'])

      useLoaderStore.getState().openUpdate(srv, '21.1.72', version('21.1.100'))

      const s = useLoaderStore.getState()
      expect(s.phase).toBe('running')
      expect(s.jobTarget).toBe('21.1.209')
      expect(s.log).toEqual(['downloading…', 'unpacking…'])
      expect(s.pending).toBeNull()
      // It opens the dialog, which now shows the running job.
      expect(s.dialogOpen).toBe(true)
    })

    // A refusal is an attempt that never became a job. Writing it as the job's
    // outcome is what made the sidebar row open the refusal.
    it('a refused start records startError and leaves the job alone', async () => {
      attachBridge()
      withRunningJob()
      vi.mocked(App.UpdateLoader).mockRejectedValue('a loader update is already running')

      await expect(
        useLoaderStore.getState().startUpdate('srv1', '21.1.100', false),
      ).rejects.toBeDefined()

      const s = useLoaderStore.getState()
      expect(s.startError).toContain('already running')
      expect(s.phase).toBe('running')
      expect(s.jobTarget).toBe('21.1.209')
      expect(s.updateError).toBeNull()
      expect(s.log).toEqual(['downloading…'])
    })

    // The log route in App gates on this, so losing it silently stopped the
    // running update's console.
    it('keeps phase running through the whole attempt', async () => {
      attachBridge()
      withRunningJob()
      vi.mocked(App.UpdateLoader).mockRejectedValue('a loader update is already running')

      await useLoaderStore
        .getState()
        .startUpdate('srv1', '21.1.100', false)
        .catch(() => {})
      useLoaderStore.getState().appendLog('still going')

      expect(useLoaderStore.getState().phase).toBe('running')
      expect(useLoaderStore.getState().log).toContain('still going')
    })
  })

  describe('starting an update', () => {
    it('passes the full-backup choice through', async () => {
      useLoaderStore.getState().openUpdate(srv, '21.1.72', version('21.1.209'))
      await useLoaderStore.getState().startUpdate('srv1', '21.1.209', true)
      expect(App.UpdateLoader).toHaveBeenCalledWith({
        serverId: 'srv1',
        version: '21.1.209',
        fullBackup: true,
      })
    })

    // The call resolves once the backend accepts; the event is what says the
    // job is running, so the store must not claim it early.
    it('does not claim a job before the event says so', async () => {
      useLoaderStore.getState().openUpdate(srv, '21.1.72', version('21.1.209'))
      await useLoaderStore.getState().startUpdate('srv1', '21.1.209', false)

      expect(useLoaderStore.getState().phase).toBe('idle')
      expect(useLoaderStore.getState().pending?.starting).toBe(true)
    })

    it('a refusal with no job running leaves nothing behind but the message', async () => {
      attachBridge()
      useLoaderStore.getState().openUpdate(srv, '21.1.72', version('21.1.209'))
      vi.mocked(App.UpdateLoader).mockRejectedValue('stop the server before updating its loader')

      await expect(
        useLoaderStore.getState().startUpdate('srv1', '21.1.209', false),
      ).rejects.toBeDefined()

      const s = useLoaderStore.getState()
      expect(s.startError).toContain('stop the server')
      expect(s.phase).toBe('idle')
      expect(s.pending?.starting).toBe(false)
    })
  })

  describe('the dialog', () => {
    it('hiding keeps the job, and showing brings it back', () => {
      withRunningJob()
      useLoaderStore.getState().showDialog()

      useLoaderStore.getState().hideDialog()
      expect(useLoaderStore.getState().dialogOpen).toBe(false)
      expect(useLoaderStore.getState().phase).toBe('running')

      useLoaderStore.getState().showDialog()
      const s = useLoaderStore.getState()
      expect(s.dialogOpen).toBe(true)
      expect(s.log).toEqual(['downloading…'])
    })

    // Only once nothing is running: a settled job is history when a new
    // version is being confirmed.
    it('openUpdate clears a settled job', () => {
      withRunningJob()
      useLoaderStore.getState().failUpdate('the installer exited 1', true)

      useLoaderStore.getState().openUpdate(srv, '21.1.72', version('21.1.100'))

      const s = useLoaderStore.getState()
      expect(s.phase).toBe('idle')
      expect(s.updateError).toBeNull()
      expect(s.jobTarget).toBe('')
      expect(s.pending?.target.version).toBe('21.1.100')
    })
  })

  it('records a failure and whether it rolled back', () => {
    withRunningJob()
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

  it('reset clears the job and the selection alike', () => {
    withRunningJob()
    useLoaderStore.getState().failUpdate('boom', true)
    useLoaderStore.getState().reset()

    const s = useLoaderStore.getState()
    expect(s.phase).toBe('idle')
    expect(s.log).toEqual([])
    expect(s.updateError).toBeNull()
    expect(s.rolledBack).toBe(false)
    expect(s.jobTarget).toBe('')
    expect(s.pending).toBeNull()
    expect(s.startError).toBeNull()
  })
})
