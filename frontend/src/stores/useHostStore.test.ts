import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as App from '../../wailsjs/go/main/App'
import { useHostStore } from './useHostStore'

vi.mock('../../wailsjs/go/main/App')

describe('useHostStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useHostStore.setState({ physicalMemoryMB: null })
  })

  it('reads the machine RAM once and keeps it', async () => {
    vi.mocked(App.GetPhysicalMemoryMB).mockResolvedValue(16384)
    await useHostStore.getState().loadPhysicalMemory()
    await useHostStore.getState().loadPhysicalMemory()
    expect(useHostStore.getState().physicalMemoryMB).toBe(16384)
    expect(App.GetPhysicalMemoryMB).toHaveBeenCalledTimes(1)
  })

  it('shares one call between concurrent loads', async () => {
    vi.mocked(App.GetPhysicalMemoryMB).mockResolvedValue(8192)
    await Promise.all([
      useHostStore.getState().loadPhysicalMemory(),
      useHostStore.getState().loadPhysicalMemory(),
    ])
    expect(App.GetPhysicalMemoryMB).toHaveBeenCalledTimes(1)
  })

  it('stays unknown when the read fails, and tries again next time', async () => {
    vi.mocked(App.GetPhysicalMemoryMB).mockRejectedValueOnce(new Error('no bridge'))
    await useHostStore.getState().loadPhysicalMemory()
    expect(useHostStore.getState().physicalMemoryMB).toBeNull()

    vi.mocked(App.GetPhysicalMemoryMB).mockResolvedValue(4096)
    await useHostStore.getState().loadPhysicalMemory()
    expect(useHostStore.getState().physicalMemoryMB).toBe(4096)
  })

  it('ignores a non-positive answer', async () => {
    vi.mocked(App.GetPhysicalMemoryMB).mockResolvedValue(0)
    await useHostStore.getState().loadPhysicalMemory()
    expect(useHostStore.getState().physicalMemoryMB).toBeNull()
  })
})
