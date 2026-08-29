import { describe, it, expect, beforeEach } from 'vitest'
import { useInstallStore } from './useInstallStore'
import type { InstallerDetails } from '../components/ServerInstallModal'

const installer: InstallerDetails = {
  jarPath: '/downloads/neoforge-21.1.209-installer.jar',
  loader: 'neoforge',
  version: '21.1.209',
  mcVersion: '1.21.1',
}

describe('useInstallStore', () => {
  beforeEach(() => {
    useInstallStore.setState({
      open: false,
      installer: null,
      targetDir: '',
      phase: 'idle',
      log: [],
      error: null,
      result: null,
    })
  })

  it('opens on a picked installer with the suggested directory', () => {
    useInstallStore.getState().openFor(installer, '/srv/smp')
    const s = useInstallStore.getState()
    expect(s.open).toBe(true)
    expect(s.installer).toEqual(installer)
    expect(s.targetDir).toBe('/srv/smp')
    expect(s.phase).toBe('idle')
  })

  it('a fresh selection clears the previous run', () => {
    useInstallStore.getState().openFor(installer, '/srv/a')
    useInstallStore.getState().begin()
    useInstallStore.getState().appendLog('noise')
    useInstallStore.getState().fail('boom')

    useInstallStore.getState().openFor(installer, '/srv/b')

    const s = useInstallStore.getState()
    expect(s.phase).toBe('idle')
    expect(s.log).toEqual([])
    expect(s.error).toBeNull()
  })

  // The modal's own promise is that closing never blocks. That is only true if
  // hiding keeps everything the reopened view needs.
  it('hiding keeps the phase and the log, and showing brings them back', () => {
    useInstallStore.getState().openFor(installer, '/srv/smp')
    useInstallStore.getState().begin()
    useInstallStore.getState().appendLog('Downloading libraries…')

    useInstallStore.getState().hide()
    expect(useInstallStore.getState().open).toBe(false)
    expect(useInstallStore.getState().phase).toBe('running')

    useInstallStore.getState().show()
    const s = useInstallStore.getState()
    expect(s.open).toBe(true)
    expect(s.log).toEqual(['Downloading libraries…'])
  })

  // The add-server form reads it after the modal has been dismissed.
  it('a finished install keeps its result past hiding', () => {
    useInstallStore.getState().openFor(installer, '/srv/smp')
    useInstallStore.getState().begin()
    useInstallStore.getState().finish({
      targetDir: '/srv/smp',
      mcVersion: '1.21.1',
      loader: 'neoforge',
      loaderVersion: '21.1.209',
    })
    useInstallStore.getState().hide()

    expect(useInstallStore.getState().phase).toBe('done')
    expect(useInstallStore.getState().result?.loaderVersion).toBe('21.1.209')

    useInstallStore.getState().clearResult()
    expect(useInstallStore.getState().result).toBeNull()
  })

  it('records a failure', () => {
    useInstallStore.getState().openFor(installer, '/srv/smp')
    useInstallStore.getState().begin()
    useInstallStore.getState().fail('java not found in PATH')

    const s = useInstallStore.getState()
    expect(s.phase).toBe('failed')
    expect(s.error).toBe('java not found in PATH')
  })

  it('caps the log rather than growing without bound', () => {
    const { appendLog } = useInstallStore.getState()
    for (let i = 0; i < 600; i++) appendLog(`line ${i}`)
    const { log } = useInstallStore.getState()
    expect(log).toHaveLength(500)
    expect(log[log.length - 1]).toBe('line 599')
  })
})
