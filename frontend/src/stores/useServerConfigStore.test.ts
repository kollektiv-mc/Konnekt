import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useServerConfigStore } from './useServerConfigStore'
import type { ServerConfig } from '../types'

vi.mock('../../wailsjs/go/main/App')

function cfg(id: string, name = id): ServerConfig {
  return { id, name, jarPath: '', jvmArgs: [], workingDir: '', mcVersion: '1.21', loader: 'paper' }
}

// jsdom has no window.go, so `hasWailsBridge()` is false by default — the
// `frontend-dev` preview case. Attach a stub for the real-rejection path.
const attachBridge = () => Object.assign(window, { go: {} })

describe('useServerConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks() resets calls, not implementations, so a rejection armed by
    // one test would still be armed in the next.
    vi.mocked(App.SaveServerConfig).mockResolvedValue(undefined)
    vi.mocked(App.DeleteServerConfig).mockResolvedValue(undefined)
    vi.mocked(App.SetActiveServerID).mockResolvedValue(undefined)
    Reflect.deleteProperty(window, 'go')
    useServerConfigStore.setState({ configs: [], activeId: '', error: null })
  })

  describe('loadConfigs', () => {
    it('keeps a valid activeId', async () => {
      vi.mocked(App.GetServerConfigs).mockResolvedValue([cfg('a'), cfg('b')])
      vi.mocked(App.GetActiveServerID).mockResolvedValue('b')
      await useServerConfigStore.getState().loadConfigs()
      expect(useServerConfigStore.getState().activeId).toBe('b')
    })

    it('falls back to the first config id when activeId is missing', async () => {
      vi.mocked(App.GetServerConfigs).mockResolvedValue([cfg('a'), cfg('b')])
      vi.mocked(App.GetActiveServerID).mockResolvedValue('')
      await useServerConfigStore.getState().loadConfigs()
      expect(useServerConfigStore.getState().activeId).toBe('a')
    })

    it('falls back to the first config id when the saved activeId no longer exists', async () => {
      vi.mocked(App.GetServerConfigs).mockResolvedValue([cfg('a'), cfg('b')])
      vi.mocked(App.GetActiveServerID).mockResolvedValue('stale-id')
      await useServerConfigStore.getState().loadConfigs()
      expect(useServerConfigStore.getState().activeId).toBe('a')
    })

    it('results in an empty activeId when there are no configs', async () => {
      vi.mocked(App.GetServerConfigs).mockResolvedValue([])
      vi.mocked(App.GetActiveServerID).mockResolvedValue('')
      await useServerConfigStore.getState().loadConfigs()
      expect(useServerConfigStore.getState().activeId).toBe('')
    })

    it('degrades to empty state when both IPC calls reject', async () => {
      vi.mocked(App.GetServerConfigs).mockRejectedValue(new Error('no bridge'))
      vi.mocked(App.GetActiveServerID).mockRejectedValue(new Error('no bridge'))
      await useServerConfigStore.getState().loadConfigs()
      expect(useServerConfigStore.getState().configs).toEqual([])
      expect(useServerConfigStore.getState().activeId).toBe('')
    })
  })

  describe('saveConfig', () => {
    it('inserts a new config and persists it', async () => {
      await useServerConfigStore.getState().saveConfig(cfg('a'))
      expect(useServerConfigStore.getState().configs).toEqual([cfg('a')])
      expect(App.SaveServerConfig).toHaveBeenCalledWith(cfg('a'))
    })

    it('updates an existing config in place by id', async () => {
      useServerConfigStore.setState({ configs: [cfg('a', 'Old Name')], activeId: 'a' })
      await useServerConfigStore.getState().saveConfig(cfg('a', 'New Name'))
      expect(useServerConfigStore.getState().configs).toEqual([cfg('a', 'New Name')])
    })

    it('sets activeId to the new config id when previously empty', async () => {
      await useServerConfigStore.getState().saveConfig(cfg('a'))
      expect(useServerConfigStore.getState().activeId).toBe('a')
    })

    it('leaves activeId untouched when one is already set', async () => {
      useServerConfigStore.setState({ configs: [cfg('a')], activeId: 'a' })
      await useServerConfigStore.getState().saveConfig(cfg('b'))
      expect(useServerConfigStore.getState().activeId).toBe('a')
    })

    // The config carries the working directory, the JVM args and the RCON
    // credentials, and nothing else in the app holds a copy. Showing a refused
    // write as applied loses all of it at the next start with no error anywhere
    // (HEALTH_LOG.md, 2026-08-20).
    it('does not apply the edit and records the error when the backend rejects', async () => {
      attachBridge()
      useServerConfigStore.setState({ configs: [cfg('a', 'Old Name')], activeId: 'a' })
      vi.mocked(App.SaveServerConfig).mockRejectedValue(new Error('permission denied'))
      await expect(
        useServerConfigStore.getState().saveConfig(cfg('a', 'New Name')),
      ).rejects.toThrow('permission denied')
      expect(useServerConfigStore.getState().configs).toEqual([cfg('a', 'Old Name')])
      expect(useServerConfigStore.getState().error).toBe('permission denied')
    })

    it('keeps the config in memory when there is no Wails bridge to save to', async () => {
      vi.mocked(App.SaveServerConfig).mockRejectedValue(new Error('no wails bridge'))
      await useServerConfigStore.getState().saveConfig(cfg('a'))
      expect(useServerConfigStore.getState().configs).toEqual([cfg('a')])
      expect(useServerConfigStore.getState().error).toBeNull()
    })

    it('clears a stale error after a later save succeeds', async () => {
      attachBridge()
      useServerConfigStore.setState({ error: 'permission denied' })
      await useServerConfigStore.getState().saveConfig(cfg('a'))
      expect(useServerConfigStore.getState().error).toBeNull()
    })
  })

  describe('deleteConfig', () => {
    it('removes the config by id and persists the deletion', async () => {
      useServerConfigStore.setState({ configs: [cfg('a'), cfg('b')], activeId: 'b' })
      await useServerConfigStore.getState().deleteConfig('a')
      expect(useServerConfigStore.getState().configs).toEqual([cfg('b')])
      expect(App.DeleteServerConfig).toHaveBeenCalledWith('a')
      expect(useServerConfigStore.getState().activeId).toBe('b')
    })

    it('reassigns activeId to the first remaining config when the active one is deleted', async () => {
      useServerConfigStore.setState({ configs: [cfg('a'), cfg('b')], activeId: 'a' })
      await useServerConfigStore.getState().deleteConfig('a')
      expect(useServerConfigStore.getState().activeId).toBe('b')
    })

    it('reassigns activeId to empty when the last config is deleted', async () => {
      useServerConfigStore.setState({ configs: [cfg('a')], activeId: 'a' })
      await useServerConfigStore.getState().deleteConfig('a')
      expect(useServerConfigStore.getState().activeId).toBe('')
    })

    it('keeps the config listed and records the error when the backend rejects', async () => {
      attachBridge()
      useServerConfigStore.setState({ configs: [cfg('a'), cfg('b')], activeId: 'a' })
      vi.mocked(App.DeleteServerConfig).mockRejectedValue(new Error('file in use'))
      await expect(useServerConfigStore.getState().deleteConfig('a')).rejects.toThrow('file in use')
      expect(useServerConfigStore.getState().configs).toEqual([cfg('a'), cfg('b')])
      expect(useServerConfigStore.getState().activeId).toBe('a')
      expect(useServerConfigStore.getState().error).toBe('file in use')
    })
  })

  describe('setActiveId', () => {
    it('sets state and persists the new active id', async () => {
      await useServerConfigStore.getState().setActiveId('c')
      expect(useServerConfigStore.getState().activeId).toBe('c')
      expect(App.SetActiveServerID).toHaveBeenCalledWith('c')
    })

    it('keeps the previous active id and records the error when the backend rejects', async () => {
      attachBridge()
      useServerConfigStore.setState({ configs: [cfg('a'), cfg('b')], activeId: 'a' })
      vi.mocked(App.SetActiveServerID).mockRejectedValue(new Error('disk full'))
      await expect(useServerConfigStore.getState().setActiveId('b')).rejects.toThrow('disk full')
      expect(useServerConfigStore.getState().activeId).toBe('a')
      expect(useServerConfigStore.getState().error).toBe('disk full')
    })
  })
})
