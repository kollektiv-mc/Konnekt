import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useProcessesStore } from './useProcessesStore'

describe('useProcessesStore', () => {
  beforeEach(() => {
    useProcessesStore.setState({ processes: {} })
  })

  it('start registers a running process at 0%', () => {
    useProcessesStore.getState().start('p1', 'Backing up')
    expect(useProcessesStore.getState().processes.p1).toMatchObject({
      id: 'p1',
      label: 'Backing up',
      percent: 0,
      status: 'running',
    })
  })

  it('start with no filename leaves it undefined', () => {
    useProcessesStore.getState().start('p1', 'Backing up')
    expect(useProcessesStore.getState().processes.p1.filename).toBeUndefined()
  })

  it('start with a filename stores it on the process', () => {
    useProcessesStore.getState().start('p1', 'Backing up', 'world_x.zip')
    expect(useProcessesStore.getState().processes.p1).toMatchObject({
      filename: 'world_x.zip',
    })
  })

  // Work with no measurable progress (the Forge/NeoForge installer) must read
  // as empty while it runs — a full bar would claim progress we do not have.
  it('an indeterminate process stays at 0% until it finishes', () => {
    useProcessesStore.getState().start('install:/srv/mc', 'Installing server…', undefined, true)
    expect(useProcessesStore.getState().processes['install:/srv/mc']).toMatchObject({
      percent: 0,
      status: 'running',
      indeterminate: true,
    })

    useProcessesStore.getState().finish('install:/srv/mc', 'done')
    expect(useProcessesStore.getState().processes['install:/srv/mc']).toMatchObject({
      percent: 100,
      status: 'done',
    })
  })

  it('leaves indeterminate undefined for measurable work', () => {
    useProcessesStore.getState().start('p1', 'Backing up')
    expect(useProcessesStore.getState().processes.p1.indeterminate).toBeUndefined()
  })

  it('filename survives updateProgress and finish', () => {
    useProcessesStore.getState().start('p1', 'Backing up', 'world_x.zip')
    useProcessesStore.getState().updateProgress('p1', 42)
    expect(useProcessesStore.getState().processes.p1.filename).toBe('world_x.zip')
    useProcessesStore.getState().finish('p1', 'done')
    expect(useProcessesStore.getState().processes.p1.filename).toBe('world_x.zip')
  })

  it('updateProgress updates percent while running', () => {
    useProcessesStore.getState().start('p1', 'Backing up')
    useProcessesStore.getState().updateProgress('p1', 42)
    expect(useProcessesStore.getState().processes.p1.percent).toBe(42)
  })

  it('updateProgress is a no-op for an unknown id', () => {
    useProcessesStore.getState().updateProgress('missing', 50)
    expect(useProcessesStore.getState().processes.missing).toBeUndefined()
  })

  it('updateProgress is a no-op once the process is no longer running', () => {
    useProcessesStore.getState().start('p1', 'Backing up')
    useProcessesStore.getState().finish('p1', 'done')
    useProcessesStore.getState().updateProgress('p1', 5)
    expect(useProcessesStore.getState().processes.p1.percent).toBe(100)
  })

  describe('finish', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('sets status and percent to 100 immediately', () => {
      useProcessesStore.getState().start('p1', 'Backing up')
      useProcessesStore.getState().finish('p1', 'failed')
      expect(useProcessesStore.getState().processes.p1).toMatchObject({
        status: 'failed',
        percent: 100,
      })
    })

    it('auto-removes the process 3000ms after finishing', () => {
      useProcessesStore.getState().start('p1', 'Backing up')
      useProcessesStore.getState().finish('p1', 'done')
      expect(useProcessesStore.getState().processes.p1).toBeDefined()

      vi.advanceTimersByTime(2999)
      expect(useProcessesStore.getState().processes.p1).toBeDefined()

      vi.advanceTimersByTime(1)
      expect(useProcessesStore.getState().processes.p1).toBeUndefined()
    })

    it('is a no-op for an unknown id', () => {
      useProcessesStore.getState().finish('missing', 'done')
      expect(useProcessesStore.getState().processes).toEqual({})
    })
  })
})
