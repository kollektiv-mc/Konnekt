import { create } from 'zustand'
import type { ServerConfig } from '../types'
import { errMsg, hasWailsBridge } from '../lib/ipc'
import {
  GetServerConfigs,
  SaveServerConfig,
  DeleteServerConfig,
  GetActiveServerID,
  SetActiveServerID,
} from '../../wailsjs/go/main/App'

interface ServerConfigStore {
  configs: ServerConfig[]
  activeId: string
  error: string | null
  loadConfigs: () => Promise<void>
  saveConfig: (cfg: ServerConfig) => Promise<void>
  deleteConfig: (id: string) => Promise<void>
  setActiveId: (id: string) => Promise<void>
  clearError: () => void
}

/**
 * A write that the backend refused must not be shown as applied. This is the
 * worst-affected store: a config carries the working directory, the JVM args
 * and the RCON credentials, so a swallowed `SaveServerConfig` used to leave the
 * edit on screen looking saved and gone at the next start (HEALTH_LOG.md,
 * 2026-08-20).
 *
 * Every local `set` here already runs *after* the await, so there is nothing to
 * roll back: failing before it is the whole fix. `hasWailsBridge()` keeps the
 * browser-only `frontend-dev` preview working, where no write was ever going to
 * land anyway — see `lib/ipc.ts`.
 */
export const useServerConfigStore = create<ServerConfigStore>((set) => ({
  configs: [],
  activeId: '',
  error: null,

  clearError: () => set({ error: null }),

  loadConfigs: async () => {
    let configs: ServerConfig[] = []
    try {
      configs = await GetServerConfigs()
    } catch {
      /* Wails IPC unavailable */
    }

    let activeId = ''
    try {
      activeId = await GetActiveServerID()
    } catch {
      /* Wails IPC unavailable */
    }

    if (!activeId || !configs.find((c) => c.id === activeId)) {
      activeId = configs[0]?.id ?? ''
    }

    set({ configs, activeId })
  },

  saveConfig: async (cfg: ServerConfig) => {
    set({ error: null })
    try {
      await SaveServerConfig(cfg)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to, so keep the in-memory config. */
    }
    set((s) => {
      const idx = s.configs.findIndex((c) => c.id === cfg.id)
      const configs =
        idx >= 0 ? s.configs.map((c, i) => (i === idx ? cfg : c)) : [...s.configs, cfg]
      const activeId = s.activeId || cfg.id
      return { configs, activeId }
    })
  },

  deleteConfig: async (id: string) => {
    set({ error: null })
    try {
      await DeleteServerConfig(id)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to. */
    }
    set((s) => {
      const configs = s.configs.filter((c) => c.id !== id)
      const activeId = s.activeId === id ? (configs[0]?.id ?? '') : s.activeId
      return { configs, activeId }
    })
  },

  setActiveId: async (id: string) => {
    set({ error: null })
    try {
      await SetActiveServerID(id)
    } catch (e) {
      if (hasWailsBridge()) {
        set({ error: errMsg(e) })
        throw e
      }
      /* No bridge: nothing to persist to. */
    }
    set({ activeId: id })
  },
}))
